import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-TAN-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const previousSaturday = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 1) % 7));
};

test("TAN schedule preserves 108-share math and protects legacy financial writes", async () => {
  const token = `${prefix}-owner-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let cycleId = 0;
  const memberIds: number[] = [];
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
    for (let index = 0; index < 4; index += 1) {
      const member = await client.query(
        `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
         VALUES($1,$2,$3,'test',27,2700,CURRENT_DATE,'active') RETURNING id`,
        [`${prefix}-M${index + 1}`, `${prefix} member ${index + 1}`, `019${String(index + 1).padStart(8, "0")}`],
      );
      memberIds.push(member.rows[0].id);
    }
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,daily_per_share,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,$2,100,'COMPLETED',$3)
       RETURNING id`,
      [`${prefix} cycle`, previousSaturday(isoToday()), prefix],
    );
    cycleId = cycle.rows[0].id;
    for (const memberId of memberIds) {
      await client.query(
        `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
         VALUES($1,$2,27,2700)`,
        [cycleId, memberId],
      );
    }
    const startDate = addDays(previousSaturday(isoToday()), -28 * 7);
    const tanConfig = await client.query(
      `INSERT INTO fund_tan_configs(cycle_id,tan_start_date,draws_per_week,total_shares,total_draw_dates,daily_per_share,
        expected_daily_collection,weekly_collection_unit,per_draw_winner_amount,locked_by)
       VALUES($1,$2,4,108,27,100,10800,10800,2700,$3) RETURNING id`,
      [cycleId, startDate, ownerId],
    );
    for (let index = 0; index < 27; index += 1) {
      const periodStart = addDays(startDate, index * 7);
      const periodEnd = addDays(periodStart, 6);
      await client.query(
        `INSERT INTO fund_tan_periods(tan_config_id,cycle_id,sequence_no,period_start,period_end,draw_date,expected_collection)
         VALUES($1,$2,$3,$4,$5,$6,10800)`,
        [tanConfig.rows[0].id, cycleId, index + 1, periodStart, periodEnd, periodEnd],
      );
    }
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const scheduleResponse = await fetch(`${baseUrl}/api/cycles/${cycleId}/tan`, {
      headers: { cookie: `irf_session=${token}` },
    });
    assert.equal(scheduleResponse.status, 200);
    const schedule = await scheduleResponse.json() as {
      periods: Array<{ periodStart: string; periodEnd: string; drawDate: string; recordedDraws: number }>;
    };
    assert.equal(schedule.periods.length, 27);
    for (const period of schedule.periods) {
      assert.equal(new Date(`${period.periodStart}T00:00:00Z`).getUTCDay(), 6);
      assert.equal(new Date(`${period.periodEnd}T00:00:00Z`).getUTCDay(), 5);
      assert.equal(period.drawDate, period.periodEnd);
      assert.equal(period.recordedDraws, 0);
    }

    const shareEdit = await fetch(`${baseUrl}/api/cycles/${cycleId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify({ memberId: memberIds[0], shares: 26 }),
    });
    assert.equal(shareEdit.status, 409);

    const paymentOutsidePeriod = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify({
        cycleId,
        memberId: memberIds[0],
        collectionDate: isoToday(),
        amount: 2700,
        verificationMethod: "COLLECTOR_CONFIRMATION",
        confirmDuplicate: false,
      }),
    });
    assert.equal(paymentOutsidePeriod.status, 409);

    const transferOutsidePeriod = await fetch(`${baseUrl}/api/share-transfers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify({ cycleId, fromMemberId: memberIds[0], toMemberId: memberIds[1], quantity: 1, transferDate: isoToday() }),
    });
    assert.equal(transferOutsidePeriod.status, 409);

    const period = await client.query("SELECT id,draw_date FROM fund_tan_periods WHERE tan_config_id=(SELECT id FROM fund_tan_configs WHERE cycle_id=$1) ORDER BY sequence_no LIMIT 1", [cycleId]);
    const drawDate = period.rows[0].draw_date;
    await client.query(
      `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,tan_period_id,draw_slot)
       VALUES($1,1,$2,$3,2700,'RECORDED',$4,$5,1)`,
      [cycleId, drawDate, memberIds[0], prefix, period.rows[0].id],
    );
    await assert.rejects(
      client.query(
        `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,tan_period_id,draw_slot)
         VALUES($1,2,$2,$3,2700,'RECORDED',$4,$5,1)`,
        [cycleId, drawDate, memberIds[1], prefix, period.rows[0].id],
      ),
      (error: any) => error?.code === "23505",
    );
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId) {
      await pool.query("DELETE FROM fund_draws WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_periods WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_configs WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    }
    if (ownerId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=$1", [ownerId]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
      await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
    }
    if (memberIds.length) await pool.query("DELETE FROM fund_members WHERE id = ANY($1::int[])", [memberIds]);
  }
});

test.after(async () => {
  await pool.end();
});