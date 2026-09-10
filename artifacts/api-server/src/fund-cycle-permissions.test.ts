import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `CYCLE-PERM-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("cycle-scoped delegated access cannot be used on another cycle", async () => {
  const ownerToken = `${prefix}-owner-token`;
  const collectorToken = `${prefix}-collector-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  let memberId = 0;
  let firstCycleId = 0;
  let secondCycleId = 0;
  let firstDrawId = 0;
  let secondDrawId = 0;

  try {
    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const collector = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} collector`, `${prefix}-collector`],
    );
    collectorId = Number(collector.rows[0].id);
    const member = await pool.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-member`, `${prefix} member`, `018${String(process.pid).padStart(8, "0")}`],
    );
    memberId = Number(member.rows[0].id);
    const cycles = await pool.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,daily_per_share,draw_frequency,draw_day,status,notes)
       VALUES
         ((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE-interval '30 days',CURRENT_DATE-interval '20 days',100,'WEEKLY','FRIDAY','COMPLETED',$3),
         ((SELECT COALESCE(MAX(cycle_number),0)+2 FROM fund_cycles),$2,CURRENT_DATE-interval '19 days',CURRENT_DATE-interval '9 days',100,'WEEKLY','FRIDAY','COMPLETED',$3)
       RETURNING id,name`,
      [`${prefix} first`, `${prefix} second`, prefix],
    );
    firstCycleId = Number(cycles.rows.find((row) => row.name === `${prefix} first`)?.id);
    secondCycleId = Number(cycles.rows.find((row) => row.name === `${prefix} second`)?.id);
    await pool.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$3,1,100),($2,$3,1,100)`,
      [firstCycleId, secondCycleId, memberId],
    );
    const draws = await pool.query(
      `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
       VALUES($1,1,CURRENT_DATE-interval '25 days',$3,100,'RECORDED',$4),
             ($2,1,CURRENT_DATE-interval '14 days',$3,100,'RECORDED',$4)
       RETURNING id,cycle_id`,
      [firstCycleId, secondCycleId, memberId, prefix],
    );
    firstDrawId = Number(draws.rows.find((row) => Number(row.cycle_id) === firstCycleId)?.id);
    secondDrawId = Number(draws.rows.find((row) => Number(row.cycle_id) === secondCycleId)?.id);
    await pool.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), ownerId, hashToken(collectorToken), collectorId],
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const post = (path: string, token: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify(body),
    });

    const grant = await post("/api/permissions", ownerToken, {
      userId: collectorId,
      permission: "DRAW_DATE_CORRECTION",
      cycleId: firstCycleId,
      note: "Synthetic cycle-only coverage",
    });
    assert.equal(grant.status, 201);

    const crossCycle = await post(`/api/draws/${secondDrawId}/move-date`, collectorToken, {
      drawDate: new Date().toISOString().slice(0, 10),
      reason: "Must remain denied",
    });
    assert.equal(crossCycle.status, 403);

    const spoofedCycle = await post(`/api/draws/${secondDrawId}/move-date`, collectorToken, {
      cycleId: firstCycleId,
      drawDate: new Date().toISOString().slice(0, 10),
      reason: "Must remain denied",
    });
    assert.equal(spoofedCycle.status, 400);
    assert.deepEqual(await spoofedCycle.json(), {
      error: "Request cycle does not match the financial record's cycle",
    });

    const inScope = await post(`/api/draws/${firstDrawId}/move-date`, collectorToken, {
      cycleId: firstCycleId,
      drawDate: new Date().toISOString().slice(0, 10),
      reason: "Synthetic in-scope correction",
    });
    assert.equal(inScope.status, 200);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
      await pool.query("DELETE FROM fund_user_permissions WHERE user_id=$1 OR granted_by=$2", [collectorId, ownerId]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (firstCycleId || secondCycleId) {
      const cycleIds = [firstCycleId, secondCycleId].filter(Boolean);
      await pool.query("DELETE FROM fund_draws WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycles WHERE id=ANY($1::int[])", [cycleIds]);
    }
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
  }
});

test.after(async () => {
  await pool.end();
});