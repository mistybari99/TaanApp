import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-AUDIT-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("audit API returns structured before/after fields without breaking legacy rows", async () => {
  const token = `${prefix}-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let memberId = 0;
  let cycleId = 0;
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    ownerId = owner.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(token), ownerId],
    );
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',6,600,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-MEMBER`, `${prefix} member`, `018${String(process.pid).padStart(8, "0")}`],
    );
    memberId = member.rows[0].id;
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,'COMPLETED',$2)
       RETURNING id`,
      [`${prefix} cycle`, prefix],
    );
    cycleId = cycle.rows[0].id;
    await client.query(
      `INSERT INTO fund_audit(actor_id,action,detail,entity_type,entity_id,member_id,cycle_id,related_transaction_id,reason,effective_date,before_value,after_value)
       VALUES($1,'SYNTHETIC_STRUCTURED','structured regression','member',$2,$3,$4,$5,$6,CURRENT_DATE,$7::jsonb,$8::jsonb)`,
      [
        ownerId,
        String(memberId),
        memberId,
        cycleId,
        `${prefix}-TX`,
        "synthetic reason",
        JSON.stringify({ shares: 6 }),
        JSON.stringify({ shares: 4 }),
      ],
    );
    await client.query(
      `INSERT INTO fund_audit(actor_id,action,detail)
       VALUES($1,'SYNTHETIC_LEGACY','legacy regression row')`,
      [ownerId],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/audit`, {
      headers: { cookie: `irf_session=${token}` },
    });
    assert.equal(response.status, 200);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const structured = rows.find((row) => row.action === "SYNTHETIC_STRUCTURED");
    const legacy = rows.find((row) => row.action === "SYNTHETIC_LEGACY");
    assert.ok(structured);
    assert.equal(structured.memberId, `${prefix}-MEMBER`);
    assert.equal(structured.cycleId, cycleId);
    assert.equal(structured.relatedTransactionId, `${prefix}-TX`);
    assert.equal(structured.reason, "synthetic reason");
    assert.deepEqual(structured.beforeValue, { shares: 6 });
    assert.deepEqual(structured.afterValue, { shares: 4 });
    assert.ok(legacy);
    assert.equal(legacy.beforeValue, null);
    assert.equal(legacy.afterValue, null);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.query("DELETE FROM fund_audit WHERE actor_id=$1", [ownerId]);
    await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
    if (cycleId) await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    if (ownerId) await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
  }
});

test.after(async () => {
  await pool.end();
});