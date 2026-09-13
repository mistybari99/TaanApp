import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-DUE-PERM-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("Owner may reach Due Entry validation while Collector cannot create entries", async () => {
  const ownerToken = `${prefix}-owner-token`;
  const collectorToken = `${prefix}-collector-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let collectorId = 0;
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    const collector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} collector`, `${prefix}-collector`],
    );
    collectorId = collector.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), owner.rows[0].id, hashToken(collectorToken), collector.rows[0].id],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const ownerResponse = await fetch(`${baseUrl}/api/due-entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(ownerResponse.status, 400);

    const collectorResponse = await fetch(`${baseUrl}/api/due-entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${collectorToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(collectorResponse.status, 403);
    assert.deepEqual(await collectorResponse.json(), { error: "Delegated permission required: ADVANCE_ALLOCATION" });

    const grantResponse = await fetch(`${baseUrl}/api/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}` },
      body: JSON.stringify({
        userId: collectorId,
        permission: "ADVANCE_ALLOCATION",
        note: "Temporary due-entry coverage",
      }),
    });
    assert.equal(grantResponse.status, 201);
    const granted = await grantResponse.json() as { id: number; status: string };
    assert.ok(granted.id > 0);
    assert.equal(granted.status, "ACTIVE");

    await pool.query(
      `INSERT INTO fund_user_permissions(user_id,permission,expires_at,granted_by,note)
       VALUES($1,'PAYOUT_APPROVAL',now()-interval '1 minute',$2,'Expired synthetic grant')`,
      [collectorId, (await pool.query("SELECT id FROM fund_users WHERE username=$1", [`${prefix}-owner`])).rows[0].id],
    );
    const mineResponse = await fetch(`${baseUrl}/api/permissions/mine`, {
      headers: { cookie: `irf_session=${collectorToken}` },
    });
    assert.equal(mineResponse.status, 200);
    const mine = await mineResponse.json() as Array<{ permission: string; status: string }>;
    assert.equal(mine.find((permission) => permission.permission === "ADVANCE_ALLOCATION")?.status, "ACTIVE");
    assert.equal(mine.find((permission) => permission.permission === "PAYOUT_APPROVAL")?.status, "EXPIRED");

    const delegatedResponse = await fetch(`${baseUrl}/api/due-entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${collectorToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(delegatedResponse.status, 400);

    const revokeResponse = await fetch(`${baseUrl}/api/permissions/${granted.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}` },
      body: JSON.stringify({ reason: "Coverage ended" }),
    });
    assert.equal(revokeResponse.status, 200);
    assert.equal((await revokeResponse.json() as { status: string }).status, "REVOKED");

    const collectorViewResponse = await fetch(`${baseUrl}/api/members`, {
      headers: { cookie: `irf_session=${collectorToken}` },
    });
    assert.equal(collectorViewResponse.status, 200);
    assert.ok(Array.isArray(await collectorViewResponse.json()));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.query(
      `DELETE FROM fund_audit
       WHERE actor_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR entity_type='user_permission'
             AND entity_id IN (
               SELECT p.id::text FROM fund_user_permissions p
               WHERE p.user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
                  OR p.granted_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
                  OR p.revoked_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
             )`,
      [`${prefix}%`],
    );
    await pool.query(
      `DELETE FROM fund_user_permissions
       WHERE user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR granted_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR revoked_by IN (SELECT id FROM fund_users WHERE username LIKE $1)`,
      [`${prefix}%`],
    );
    await pool.query(
      `DELETE FROM fund_sessions
       WHERE user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)`,
      [`${prefix}%`],
    );
    await pool.query("DELETE FROM fund_users WHERE username LIKE $1", [`${prefix}%`]);
  }
});

test("Owner can renew and replace delegated permission without duplicate active grants", async () => {
  const ownerToken = `${prefix}-renew-owner-token`;
  const collectorToken = `${prefix}-renew-collector-token`;
  const cycleNumber = Number(String(Date.now()).slice(-8));
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let cycleIds: number[] = [];
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} renew owner`, `${prefix}-renew-owner`],
    );
    const collector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} renew collector`, `${prefix}-renew-collector`],
    );
    const firstCycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,status)
       VALUES($1,$2,CURRENT_DATE,'ACTIVE')
       RETURNING id`,
      [cycleNumber, `${prefix} renew cycle one`],
    );
    const secondCycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,status)
       VALUES($1,$2,CURRENT_DATE,'CLOSED')
       RETURNING id`,
      [cycleNumber + 1, `${prefix} renew cycle two`],
    );
    cycleIds = [firstCycle.rows[0].id, secondCycle.rows[0].id];
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), owner.rows[0].id, hashToken(collectorToken), collector.rows[0].id],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}`, ...init?.headers },
    });

    const grantResponse = await request("/api/permissions", {
      method: "POST",
      body: JSON.stringify({
        userId: (await pool.query("SELECT id FROM fund_users WHERE username=$1", [`${prefix}-renew-collector`])).rows[0].id,
        permission: "PAYOUT_APPROVAL",
        cycleId: cycleIds[0],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        note: "Initial coverage",
      }),
    });
    assert.equal(grantResponse.status, 201);
    const grant = await grantResponse.json() as { id: number };

    const renewalResponse = await request(`/api/permissions/${grant.id}/renew`, {
      method: "POST",
      body: JSON.stringify({
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        note: "Coverage extended",
        reason: "Collector coverage continues",
      }),
    });
    assert.equal(renewalResponse.status, 200);
    const renewed = await renewalResponse.json() as { id: number; cycleId: number; note: string };
    assert.equal(renewed.id, grant.id);
    assert.equal(renewed.cycleId, cycleIds[0]);
    assert.equal(renewed.note, "Coverage extended");

    const replacementResponse = await request(`/api/permissions/${grant.id}/renew`, {
      method: "POST",
      body: JSON.stringify({
        cycleId: cycleIds[1],
        expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        note: "Moved to the next cycle",
        reason: "New cycle coverage",
      }),
    });
    assert.equal(replacementResponse.status, 200);
    const replacement = await replacementResponse.json() as { id: number; cycleId: number; status: string };
    assert.notEqual(replacement.id, grant.id);
    assert.equal(replacement.cycleId, cycleIds[1]);
    assert.equal(replacement.status, "ACTIVE");

    const secondReplacementResponse = await request(`/api/permissions/${replacement.id}/renew`, {
      method: "POST",
      body: JSON.stringify({
        cycleId: cycleIds[0],
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        note: "Returned for the original cycle",
        reason: "Coverage moved back after the intermediate cycle",
      }),
    });
    assert.equal(secondReplacementResponse.status, 200);
    const secondReplacement = await secondReplacementResponse.json() as { id: number; cycleId: number; status: string };
    assert.notEqual(secondReplacement.id, replacement.id);
    assert.notEqual(secondReplacement.id, grant.id);
    assert.equal(secondReplacement.cycleId, cycleIds[0]);
    assert.equal(secondReplacement.status, "ACTIVE");

    const history = await (await request("/api/permissions")).json() as Array<{ id: number; status: string; cycleId: number | null }>;
    assert.equal(history.find((permission) => permission.id === grant.id)?.status, "REVOKED");
    assert.equal(history.find((permission) => permission.id === replacement.id)?.status, "REVOKED");
    assert.equal(history.find((permission) => permission.id === secondReplacement.id)?.status, "ACTIVE");
    assert.equal(history.filter((permission) => [grant.id, replacement.id, secondReplacement.id].includes(permission.id)).length, 3);
    const activeCount = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM fund_user_permissions
        WHERE user_id=(SELECT id FROM fund_users WHERE username=$1)
          AND permission='PAYOUT_APPROVAL'
          AND revoked_at IS NULL`,
      [`${prefix}-renew-collector`],
    );
    assert.equal(activeCount.rows[0].count, 1);
    const auditResponse = await request(`/api/permissions/${secondReplacement.id}/audit`);
    assert.equal(auditResponse.status, 200);
    const auditTrail = await auditResponse.json() as Array<{ action: string; entityId: string }>;
    assert.equal(auditTrail.length, 4);
    assert.deepEqual(
      auditTrail.map((entry) => entry.action).sort(),
      ["PERMISSION_GRANTED", "PERMISSION_RENEWED", "PERMISSION_REPLACED", "PERMISSION_REPLACED"].sort(),
    );
    assert.deepEqual(
      [...new Set(auditTrail.map((entry) => entry.entityId))].sort(),
      [String(grant.id), String(replacement.id), String(secondReplacement.id)].sort(),
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.query(
      `DELETE FROM fund_audit
       WHERE actor_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR entity_type='user_permission'
             AND entity_id IN (
               SELECT p.id::text FROM fund_user_permissions p
               WHERE p.user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
                  OR p.granted_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
                  OR p.revoked_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
             )`,
      [`${prefix}-renew%`],
    );
    await pool.query(
      `DELETE FROM fund_user_permissions
       WHERE user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR granted_by IN (SELECT id FROM fund_users WHERE username LIKE $1)
          OR revoked_by IN (SELECT id FROM fund_users WHERE username LIKE $1)`,
      [`${prefix}-renew%`],
    );
    await pool.query("DELETE FROM fund_sessions WHERE user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)", [`${prefix}-renew%`]);
    await pool.query("DELETE FROM fund_cycles WHERE id = ANY($1::int[])", [cycleIds]);
    await pool.query("DELETE FROM fund_users WHERE username LIKE $1", [`${prefix}-renew%`]);
  }
});

test.after(async () => {
  await pool.end();
});