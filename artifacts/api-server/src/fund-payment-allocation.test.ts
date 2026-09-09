import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import app from "./app";
import { businessDateInDhaka } from "./routes/fund";
import { pool } from "@workspace/db";

const prefix = `SYN-PAY-ALLOC-${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("overpayment is split into previous due, current due, and visible advance credit", async () => {
  const token = `${prefix}-owner-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let memberId = 0;
  let cycleId = 0;
  let previousActiveCycleId = 0;
  const paidDate = businessDateInDhaka();
  try {
    await client.query("BEGIN");
    const previousActive = await client.query("UPDATE fund_cycles SET status='COMPLETED' WHERE status='ACTIVE' RETURNING id");
    previousActiveCycleId = Number(previousActive.rows[0]?.id ?? 0);
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
       VALUES($1,$2,$3,'synthetic',1,100,$4,'active') RETURNING id`,
      [`${prefix}-M1`, `${prefix} member`, `018${String(process.pid).padStart(8, "0")}`, paidDate],
    );
    memberId = member.rows[0].id;
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,daily_per_share,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,$2,$2,100,'ACTIVE',$3)
       RETURNING id`,
      [`${prefix} cycle`, paidDate, prefix],
    );
    cycleId = cycle.rows[0].id;
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100)`,
      [cycleId, memberId],
    );
    await client.query(
      `INSERT INTO fund_due_entries(cycle_id,member_id,amount,due_date,reason,created_by)
       VALUES($1,$2,50,$3,'Synthetic previous due',$4)`,
      [cycleId, memberId, paidDate, ownerId],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify({
        memberId,
        cycleId,
        collectionDate: paidDate,
        amount: 500,
        verificationMethod: "OWNER_CONFIRMATION",
        confirmDuplicate: false,
      }),
    });
    assert.equal(response.status, 201);
    const payment = await response.json() as {
      previousDueApplied: number;
      currentPeriodApplied: number;
      advanceCredit: number;
    };
    assert.equal(payment.previousDueApplied, 50);
    assert.equal(payment.currentPeriodApplied, 100);
    assert.equal(payment.advanceCredit, 350);

    const membersResponse = await fetch(`${baseUrl}/api/cycles/${cycleId}/members`, {
      headers: { cookie: `irf_session=${token}` },
    });
    assert.equal(membersResponse.status, 200);
    const members = await membersResponse.json() as Array<{
      previousDue: number;
      currentPeriodDue: number;
      todayDue: number;
      totalDue: number;
      advanceCredit: number;
    }>;
    assert.equal(members[0].previousDue, 0);
    assert.equal(members[0].currentPeriodDue, 0);
    assert.equal(members[0].todayDue, 0);
    assert.equal(members[0].totalDue, 0);
    assert.equal(members[0].advanceCredit, 350);
  } finally {
    if (server) {
      const runningServer = server;
      await new Promise<void>((resolve) => runningServer.close(() => resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId) {
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_due_entries WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_audit WHERE cycle_id=$1 OR actor_id=$2 OR member_id=$3", [cycleId, ownerId, memberId]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    }
    await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
    await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
    if (previousActiveCycleId) await pool.query("UPDATE fund_cycles SET status='ACTIVE' WHERE id=$1", [previousActiveCycleId]);
  }
});

test.after(async () => {
  await pool.end();
});