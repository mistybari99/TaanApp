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

test("permission audit history follows repeated scope replacements without including unrelated grants", async () => {
  const ownerToken = `${prefix}-lineage-owner-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  const cycleIds: number[] = [];
  const permissionIds: number[] = [];
  let unrelatedPermissionId = 0;

  try {
    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} lineage owner`, `${prefix}-lineage-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const collector = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} lineage collector`, `${prefix}-lineage-collector`],
    );
    collectorId = Number(collector.rows[0].id);
    const cycles = await pool.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,status,notes)
       VALUES
         ((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,'COMPLETED',$4),
         ((SELECT COALESCE(MAX(cycle_number),0)+2 FROM fund_cycles),$2,CURRENT_DATE,'COMPLETED',$4),
         ((SELECT COALESCE(MAX(cycle_number),0)+3 FROM fund_cycles),$3,CURRENT_DATE,'COMPLETED',$4)
       RETURNING id,name`,
      [`${prefix} lineage first`, `${prefix} lineage second`, `${prefix} lineage third`, prefix],
    );
    cycleIds.push(
      Number(cycles.rows.find((row) => row.name === `${prefix} lineage first`)?.id),
      Number(cycles.rows.find((row) => row.name === `${prefix} lineage second`)?.id),
      Number(cycles.rows.find((row) => row.name === `${prefix} lineage third`)?.id),
    );
    await pool.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(ownerToken), ownerId],
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}` },
      body: JSON.stringify(body),
    });
    const get = (path: string) => fetch(`${baseUrl}${path}`, {
      headers: { cookie: `irf_session=${ownerToken}` },
    });
    const missingGrantReason = await post("/api/permissions", {
      userId: collectorId,
      permission: "PAYOUT_APPROVAL",
      cycleId: cycleIds[0],
      reason: "   ",
      note: "Missing reason regression",
    });
    assert.equal(missingGrantReason.status, 400);
    const grant = await post("/api/permissions", {
      userId: collectorId,
      permission: "PAYOUT_APPROVAL",
      cycleId: cycleIds[0],
      reason: "Initial payout coverage",
      note: "Initial payout approval",
    });
    assert.equal(grant.status, 201);
    const initialId = Number((await grant.json() as { id: number }).id);
    permissionIds.push(initialId);

    const missingRenewalReason = await post(`/api/permissions/${initialId}/renew`, {
      expiresAt: "2030-01-01T00:00:00.000Z",
      note: "Missing reason regression",
      reason: "   ",
    });
    assert.equal(missingRenewalReason.status, 400);
    const unrelated = await post("/api/permissions", {
      userId: collectorId,
      permission: "FINANCIAL_CORRECTION",
      cycleId: cycleIds[0],
      reason: "Correction coverage needed",
      note: "Unrelated correction grant",
    });
    assert.equal(unrelated.status, 201);
    unrelatedPermissionId = Number((await unrelated.json() as { id: number }).id);

    const renewal = await post(`/api/permissions/${initialId}/renew`, {
      expiresAt: "2030-01-01T00:00:00.000Z",
      note: "Renewed payout approval",
      reason: "Coverage extended",
    });
    assert.equal(renewal.status, 200);
    assert.equal(Number((await renewal.json() as { id: number }).id), initialId);

    const replacementOne = await post(`/api/permissions/${initialId}/renew`, {
      cycleId: cycleIds[1],
      expiresAt: "2030-02-01T00:00:00.000Z",
      note: "Second-cycle payout approval",
      reason: "Cycle scope changed",
    });
    assert.equal(replacementOne.status, 200);
    const replacementOneId = Number((await replacementOne.json() as { id: number }).id);
    permissionIds.push(replacementOneId);

    const replacementTwo = await post(`/api/permissions/${replacementOneId}/renew`, {
      cycleId: cycleIds[2],
      expiresAt: "2030-03-01T00:00:00.000Z",
      note: "Third-cycle payout approval",
      reason: "Cycle scope changed again",
    });
    assert.equal(replacementTwo.status, 200);
    const finalId = Number((await replacementTwo.json() as { id: number }).id);
    permissionIds.push(finalId);

    const missingRevokeReason = await post(`/api/permissions/${finalId}/revoke`, { reason: "   " });
    assert.equal(missingRevokeReason.status, 400);
    const revoke = await post(`/api/permissions/${finalId}/revoke`, {
      reason: "Coverage ended",
    });
    assert.equal(revoke.status, 200);

    const expectedActions = [
      "PERMISSION_REVOKED",
      "PERMISSION_REPLACED",
      "PERMISSION_REPLACED",
      "PERMISSION_RENEWED",
      "PERMISSION_GRANTED",
    ];
    for (const permissionId of [initialId, replacementOneId, finalId]) {
      const historyResponse = await get(`/api/permissions/${permissionId}/audit`);
      assert.equal(historyResponse.status, 200);
      const history = await historyResponse.json() as Array<{
        action: string;
        entityId: string;
        createdAt: string;
        reason: string;
        beforeValue: Record<string, unknown> | null;
        afterValue: Record<string, unknown> | null;
      }>;
      assert.deepEqual(history.map((row) => row.action), expectedActions);
      assert.deepEqual(new Set(history.map((row) => Number(row.entityId))), new Set(permissionIds));
      assert.ok(history.every((row, index) => index === 0 || new Date(history[index - 1].createdAt) >= new Date(row.createdAt)));
      assert.ok(history.some((row) => row.reason === "Coverage extended" && row.beforeValue?.id === initialId));
      assert.ok(history.some((row) => row.reason === "Cycle scope changed again" && row.afterValue?.replacedPermissionId === replacementOneId));
      assert.ok(history.every((row) => row.entityId !== String(unrelatedPermissionId)));
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
      await pool.query("DELETE FROM fund_user_permissions WHERE user_id=ANY($1::int[])", [[collectorId].filter(Boolean)]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (cycleIds.length) {
      await pool.query("DELETE FROM fund_cycles WHERE id=ANY($1::int[])", [cycleIds]);
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
  }
});

test.after(async () => {
  await pool.end();
});