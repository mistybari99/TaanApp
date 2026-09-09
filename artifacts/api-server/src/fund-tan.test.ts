import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { allocatePayment, businessDateInDhaka, calculateShareTransfer, collectionCalendarState, pausedTanPeriodResumeDates } from "./routes/fund";
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

test("payment allocation clears Previous Due, caps Current Collection, and records advance credit", () => {
  assert.deepEqual(allocatePayment(500, 300), { previousDueApplied: 300, currentPeriodApplied: 200, advanceCredit: 0 });
  assert.deepEqual(allocatePayment(100, 300), { previousDueApplied: 100, currentPeriodApplied: 0, advanceCredit: 0 });
  assert.deepEqual(allocatePayment(700, 300), { previousDueApplied: 300, currentPeriodApplied: 400, advanceCredit: 0 });
  assert.deepEqual(allocatePayment(500, 900), { previousDueApplied: 500, currentPeriodApplied: 0, advanceCredit: 0 });
  assert.deepEqual(allocatePayment(500, 0, 100), { previousDueApplied: 0, currentPeriodApplied: 100, advanceCredit: 400 });
  assert.deepEqual(allocatePayment(150, 100, 25), { previousDueApplied: 100, currentPeriodApplied: 25, advanceCredit: 25 });
});

test("collection calendar closes on Friday and opens the next period on Saturday", () => {
  assert.deepEqual(
    collectionCalendarState("2026-09-11", true, true, { periodStart: "2026-09-05", drawDate: "2026-09-11" }),
    { isFridayClosingDay: true, isSaturdayOpeningDay: false },
  );
  assert.deepEqual(
    collectionCalendarState("2026-09-12", true, true, { periodStart: "2026-09-12", drawDate: "2026-09-18" }),
    { isFridayClosingDay: false, isSaturdayOpeningDay: true },
  );
  assert.deepEqual(
    collectionCalendarState("2026-09-11", true, false, null),
    { isFridayClosingDay: true, isSaturdayOpeningDay: false },
  );
});

test("mid-period pause keeps the same period window and shifts only its resume date", () => {
  assert.deepEqual(
    pausedTanPeriodResumeDates("2026-09-05", "2026-09-11", 3),
    { periodStart: "2026-09-05", periodEnd: "2026-09-14", drawDate: "2026-09-14" },
  );
});

test("TAN pause and resume preserve payment period links and shift future periods", async () => {
  const token = `${prefix}-pause-owner-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let cycleId = 0;
  let memberId = 0;
  let tanConfigId = 0;
  let previousActiveCycleId = 0;
  try {
    const today = businessDateInDhaka();
    const tanStart = previousSaturday(today);
    await client.query("BEGIN");
    const previousActiveCycle = await client.query(
      "UPDATE fund_cycles SET status='COMPLETED' WHERE status='ACTIVE' RETURNING id",
    );
    previousActiveCycleId = previousActiveCycle.rows[0]?.id ?? 0;
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} pause owner`, `${prefix}-pause-owner`],
    );
    ownerId = owner.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(token), ownerId],
    );
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'test',1,100,$4,'active') RETURNING id`,
      [`${prefix}-PAUSE-M1`, `${prefix} pause member`, "01700000001", tanStart],
    );
    memberId = member.rows[0].id;
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,daily_per_share,status,tracking_start_date,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,$2,$3,100,'ACTIVE',$2,$4)
       RETURNING id`,
      [`${prefix} pause cycle`, tanStart, addDays(tanStart, 20), prefix],
    );
    cycleId = cycle.rows[0].id;
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100)`,
      [cycleId, memberId],
    );
    const tanConfig = await client.query(
      `INSERT INTO fund_tan_configs(cycle_id,tan_start_date,draws_per_week,total_shares,total_draw_dates,daily_per_share,
        expected_daily_collection,weekly_collection_unit,per_draw_winner_amount,locked_by)
       VALUES($1,$2,1,1,3,100,100,700,100,$3) RETURNING id`,
      [cycleId, tanStart, ownerId],
    );
    tanConfigId = tanConfig.rows[0].id;
    const periodIds: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const periodStart = addDays(tanStart, index * 7);
      const periodEnd = addDays(periodStart, 6);
      const period = await client.query(
        `INSERT INTO fund_tan_periods(tan_config_id,cycle_id,sequence_no,period_start,period_end,draw_date,expected_collection)
         VALUES($1,$2,$3,$4,$5,$6,700) RETURNING id`,
        [tanConfigId, cycleId, index + 1, periodStart, periodEnd, periodEnd],
      );
      periodIds.push(period.rows[0].id);
      await client.query(
        `INSERT INTO fund_tan_period_member_obligations(tan_period_id,cycle_id,member_id,shares_snapshot,required_amount)
         VALUES($1,$2,$3,1,700)`,
        [period.rows[0].id, cycleId, memberId],
      );
    }
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = async (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify(body),
    });

    const beforePausePayment = await request("/api/payments", {
      memberId,
      cycleId,
      collectionDate: today,
      amount: 100,
      verificationMethod: "OWNER_CONFIRMATION",
      idempotencyKey: `${prefix}-before-pause`,
    });
    assert.equal(beforePausePayment.status, 201);
    const beforePausePaymentRow = await client.query(
      "SELECT id,tan_period_id,status FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 ORDER BY id DESC LIMIT 1",
      [cycleId, memberId],
    );
    assert.deepEqual(beforePausePaymentRow.rows[0], {
      id: beforePausePaymentRow.rows[0].id,
      tan_period_id: periodIds[0],
      status: "POSTED",
    });
    const paymentId = beforePausePaymentRow.rows[0].id;
    const paymentCountBeforePause = Number((await client.query(
      "SELECT COUNT(*) AS count FROM fund_payments WHERE cycle_id=$1 AND member_id=$2",
      [cycleId, memberId],
    )).rows[0].count);

    const pause = await request(`/api/cycles/${cycleId}/tan/pause`, { reason: "Pause for continuity regression" });
    assert.equal(pause.status, 200);
    const pauseBody = await pause.json() as { pausePeriodId: number };
    assert.equal(pauseBody.pausePeriodId, periodIds[0]);

    const pausedPayment = await request("/api/payments", {
      memberId,
      cycleId,
      collectionDate: today,
      amount: 50,
      verificationMethod: "OWNER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-while-paused`,
    });
    assert.equal(pausedPayment.status, 409);
    assert.equal(
      Number((await client.query(
        "SELECT COUNT(*) AS count FROM fund_payments WHERE cycle_id=$1 AND member_id=$2",
        [cycleId, memberId],
      )).rows[0].count),
      paymentCountBeforePause,
    );

    // The API uses today's Dhaka business date for resume. Move the pause
    // marker back a full week to exercise elapsed time deterministically while
    // preserving Saturday/Friday schedule constraints.
    await client.query(
      "UPDATE fund_tan_configs SET pause_started_on=$2 WHERE id=$1",
      [tanConfigId, addDays(today, -7)],
    );
    const resume = await request(`/api/cycles/${cycleId}/tan/resume`, { reason: "Resume continuity regression" });
    assert.equal(resume.status, 200);
    const resumeBody = await resume.json() as {
      resumedPeriodId: number;
      resumedPeriodSequence: number;
      daysShifted: number;
    };
    assert.equal(resumeBody.resumedPeriodId, periodIds[0]);
    assert.equal(resumeBody.resumedPeriodSequence, 1);
    assert.equal(resumeBody.daysShifted, 7);

    const periodsAfterResume = await client.query(
      `SELECT id,sequence_no,period_start::text AS period_start,period_end::text AS period_end,draw_date::text AS draw_date
       FROM fund_tan_periods WHERE tan_config_id=$1 ORDER BY sequence_no`,
      [tanConfigId],
    );
    assert.deepEqual(periodsAfterResume.rows, [
      {
        id: periodIds[0],
        sequence_no: 1,
        period_start: tanStart,
        period_end: addDays(tanStart, 13),
        draw_date: addDays(tanStart, 13),
      },
      {
        id: periodIds[1],
        sequence_no: 2,
        period_start: addDays(tanStart, 14),
        period_end: addDays(tanStart, 20),
        draw_date: addDays(tanStart, 20),
      },
      {
        id: periodIds[2],
        sequence_no: 3,
        period_start: addDays(tanStart, 21),
        period_end: addDays(tanStart, 27),
        draw_date: addDays(tanStart, 27),
      },
    ]);
    const tanAfterResume = await client.query(
      "SELECT id,status,pause_period_id FROM fund_tan_configs WHERE id=$1",
      [tanConfigId],
    );
    assert.deepEqual(tanAfterResume.rows[0], { id: tanConfigId, status: "LOCKED", pause_period_id: null });
    const existingPayment = await client.query(
      "SELECT tan_period_id,status FROM fund_payments WHERE id=$1",
      [paymentId],
    );
    assert.deepEqual(existingPayment.rows[0], { tan_period_id: periodIds[0], status: "POSTED" });

    const afterResumePayment = await request("/api/payments", {
      memberId,
      cycleId,
      collectionDate: today,
      amount: 50,
      verificationMethod: "OWNER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-after-resume`,
    });
    assert.equal(afterResumePayment.status, 201);
    const afterResumePaymentRow = await client.query(
      "SELECT tan_period_id,status FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 ORDER BY id DESC LIMIT 1",
      [cycleId, memberId],
    );
    assert.deepEqual(afterResumePaymentRow.rows[0], { tan_period_id: periodIds[0], status: "POSTED" });

    const secondPause = await request(`/api/cycles/${cycleId}/tan/pause`, { reason: "Second pause continuity regression" });
    assert.equal(secondPause.status, 200);
    const secondPauseBody = await secondPause.json() as { pausePeriodId: number };
    assert.equal(secondPauseBody.pausePeriodId, periodIds[0]);
    const secondPausedPayment = await request("/api/payments", {
      memberId,
      cycleId,
      collectionDate: today,
      amount: 25,
      verificationMethod: "OWNER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-while-paused-again`,
    });
    assert.equal(secondPausedPayment.status, 409);
    await client.query(
      "UPDATE fund_tan_configs SET pause_started_on=$2 WHERE id=$1",
      [tanConfigId, addDays(today, -3)],
    );
    const secondResume = await request(`/api/cycles/${cycleId}/tan/resume`, { reason: "Second resume continuity regression" });
    assert.equal(secondResume.status, 200);
    const secondResumeBody = await secondResume.json() as {
      resumedPeriodId: number;
      resumedPeriodSequence: number;
      daysShifted: number;
    };
    assert.equal(secondResumeBody.resumedPeriodId, periodIds[0]);
    assert.equal(secondResumeBody.resumedPeriodSequence, 1);
    assert.equal(secondResumeBody.daysShifted, 3);

    const periodsAfterSecondResume = await client.query(
      `SELECT id,sequence_no,period_start::text AS period_start,period_end::text AS period_end,draw_date::text AS draw_date
       FROM fund_tan_periods WHERE tan_config_id=$1 ORDER BY sequence_no`,
      [tanConfigId],
    );
    assert.deepEqual(periodsAfterSecondResume.rows, [
      {
        id: periodIds[0],
        sequence_no: 1,
        period_start: tanStart,
        period_end: addDays(tanStart, 16),
        draw_date: addDays(tanStart, 16),
      },
      {
        id: periodIds[1],
        sequence_no: 2,
        period_start: addDays(tanStart, 17),
        period_end: addDays(tanStart, 23),
        draw_date: addDays(tanStart, 23),
      },
      {
        id: periodIds[2],
        sequence_no: 3,
        period_start: addDays(tanStart, 24),
        period_end: addDays(tanStart, 30),
        draw_date: addDays(tanStart, 30),
      },
    ]);
    const secondResumePayment = await request("/api/payments", {
      memberId,
      cycleId,
      collectionDate: today,
      amount: 25,
      verificationMethod: "OWNER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-after-resume-again`,
    });
    assert.equal(secondResumePayment.status, 201);
    const paymentPeriodLinks = await client.query(
      "SELECT tan_period_id,status FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 ORDER BY id",
      [cycleId, memberId],
    );
    assert.ok(paymentPeriodLinks.rows.every((payment) => payment.tan_period_id === periodIds[0] && payment.status === "POSTED"));

    const scheduleEvents = await client.query(
      `SELECT tan_period_id,event_type,effective_date::text AS effective_date,days_shifted,before_value,after_value
       FROM fund_tan_schedule_events WHERE tan_config_id=$1 ORDER BY id`,
      [tanConfigId],
    );
    assert.equal(scheduleEvents.rows.length, 4);
    assert.deepEqual(scheduleEvents.rows.map((event) => ({
      tan_period_id: event.tan_period_id,
      event_type: event.event_type,
      effective_date: event.effective_date,
      days_shifted: event.days_shifted,
    })), [
      { tan_period_id: periodIds[0], event_type: "PAUSED", effective_date: today, days_shifted: 0 },
      { tan_period_id: periodIds[0], event_type: "RESUMED", effective_date: today, days_shifted: 7 },
      { tan_period_id: periodIds[0], event_type: "PAUSED", effective_date: today, days_shifted: 0 },
      { tan_period_id: periodIds[0], event_type: "RESUMED", effective_date: today, days_shifted: 3 },
    ]);
    assert.equal(scheduleEvents.rows[0].before_value.periodId, periodIds[0]);
    assert.equal(scheduleEvents.rows[1].after_value.status, "LOCKED");
    assert.equal(scheduleEvents.rows[1].after_value.periodEnd, addDays(tanStart, 13));
    assert.equal(scheduleEvents.rows[3].after_value.periodEnd, addDays(tanStart, 16));

    const auditEvents = await client.query(
      `SELECT action,cycle_id,entity_type,entity_id,effective_date::text AS effective_date
       FROM fund_audit WHERE actor_id=$1 AND cycle_id=$2 AND action IN ('TAN_PAUSED','TAN_RESUMED')
       ORDER BY id`,
      [ownerId, cycleId],
    );
    assert.deepEqual(auditEvents.rows, [
      { action: "TAN_PAUSED", cycle_id: cycleId, entity_type: "tan_config", entity_id: String(tanConfigId), effective_date: today },
      { action: "TAN_RESUMED", cycle_id: cycleId, entity_type: "tan_config", entity_id: String(tanConfigId), effective_date: today },
      { action: "TAN_PAUSED", cycle_id: cycleId, entity_type: "tan_config", entity_id: String(tanConfigId), effective_date: today },
      { action: "TAN_RESUMED", cycle_id: cycleId, entity_type: "tan_config", entity_id: String(tanConfigId), effective_date: today },
    ]);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId) {
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_schedule_events WHERE tan_config_id=$1", [tanConfigId]);
      await pool.query("DELETE FROM fund_tan_period_member_obligations WHERE cycle_id=$1", [cycleId]);
      await pool.query("UPDATE fund_tan_configs SET pause_period_id=NULL WHERE id=$1", [tanConfigId]);
      await pool.query("DELETE FROM fund_tan_periods WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_configs WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    }
    if (previousActiveCycleId) {
      await pool.query("UPDATE fund_cycles SET status='ACTIVE' WHERE id=$1", [previousActiveCycleId]);
    }
    if (ownerId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=$1", [ownerId]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
      await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
    }
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
  }
});

test("share transfer math supports partial, full, repeated and multi-receiver transfers", () => {
  const partial = calculateShareTransfer(5, 3, 2, 800);
  assert.deepEqual(partial, {
    sourceSharesAfter: 3,
    receiverSharesAfter: 5,
    transferredValue: 320,
    totalSharesBefore: 8,
    totalSharesAfter: 8,
  });

  const full = calculateShareTransfer(2, 5, 2, 320);
  assert.equal(full.sourceSharesAfter, 0);
  assert.equal(full.receiverSharesAfter, 7);
  assert.equal(full.transferredValue, 320);
  assert.equal(full.totalSharesAfter, full.totalSharesBefore);

  const sourceToNewReceiver = calculateShareTransfer(3, 0, 1, 480);
  const receiverToSecondReceiver = calculateShareTransfer(5, 1, 1, 320);
  assert.equal(sourceToNewReceiver.transferredValue, 160);
  assert.equal(receiverToSecondReceiver.transferredValue, 64);
  assert.equal(sourceToNewReceiver.totalSharesAfter, 3);
  assert.equal(receiverToSecondReceiver.totalSharesAfter, 6);

  assert.throws(() => calculateShareTransfer(1, 0, 2, 100), /cannot exceed source shares/);
  assert.throws(() => calculateShareTransfer(0, 1, 1, 100), /positive shares/);
});

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
    for (const memberId of memberIds) {
      await client.query(
        `INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
         VALUES($1,$2,$3,27)`,
        [tanConfig.rows[0].id, cycleId, memberId],
      );
    }
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
      `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,tan_period_id,draw_slot,entitlement_id,entitlement_number)
       VALUES($1,1,$2,$3,2700,'RECORDED',$4,$5,1,
         (SELECT id FROM fund_tan_member_draw_entitlements WHERE tan_config_id=$6 AND member_id=$3),1)`,
      [cycleId, drawDate, memberIds[0], prefix, period.rows[0].id, tanConfig.rows[0].id],
    );
    await client.query(
      `UPDATE fund_tan_member_draw_entitlements
       SET consumed_entitlements=1,updated_at=now()
       WHERE tan_config_id=$1 AND member_id=$2`,
      [tanConfig.rows[0].id, memberIds[0]],
    );
    const memberResponse = await fetch(`${baseUrl}/api/cycles/${cycleId}/members`, {
      headers: { cookie: `irf_session=${token}` },
    });
    assert.equal(memberResponse.status, 200);
    const memberRows = await memberResponse.json() as Array<{
      memberId: number;
      drawEntitlementTotal: number;
      drawEntitlementUsed: number;
      drawEntitlementRemaining: number;
    }>;
    const firstMember = memberRows.find((row) => row.memberId === memberIds[0]);
    assert.deepEqual(
      {
        total: firstMember?.drawEntitlementTotal,
        used: firstMember?.drawEntitlementUsed,
        remaining: firstMember?.drawEntitlementRemaining,
      },
      { total: 27, used: 1, remaining: 26 },
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
      await pool.query("DELETE FROM fund_tan_member_draw_entitlements WHERE cycle_id=$1", [cycleId]);
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

test("TAN rollover carries closed-period debt and reversal restores it", async () => {
  const token = `${prefix}-due-owner-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let cycleId = 0;
  let memberId = 0;
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} due owner`, `${prefix}-due-owner`],
    );
    ownerId = owner.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(token), ownerId],
    );
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'test',7,700,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-DUE-M1`, `${prefix} due member`, `018${String(99).padStart(8, "0")}`],
    );
    memberId = member.rows[0].id;
    const currentStart = previousSaturday(isoToday());
    const tanStart = addDays(currentStart, -14);
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,daily_per_share,status,tracking_start_date,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,$2,100,'COMPLETED',$2,$3)
       RETURNING id`,
      [`${prefix} due cycle`, tanStart, prefix],
    );
    cycleId = cycle.rows[0].id;
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,7,700)`,
      [cycleId, memberId],
    );
    const config = await client.query(
      `INSERT INTO fund_tan_configs(cycle_id,tan_start_date,draws_per_week,total_shares,total_draw_dates,daily_per_share,
        expected_daily_collection,weekly_collection_unit,per_draw_winner_amount,locked_by)
       VALUES($1,$2,1,7,3,100,700,700,700,$3) RETURNING id`,
      [cycleId, tanStart, ownerId],
    );
    const periodIds: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const periodStart = addDays(tanStart, index * 7);
      const periodEnd = addDays(periodStart, 6);
      const period = await client.query(
        `INSERT INTO fund_tan_periods(tan_config_id,cycle_id,sequence_no,period_start,period_end,draw_date,expected_collection)
         VALUES($1,$2,$3,$4,$5,$6,700) RETURNING id`,
        [config.rows[0].id, cycleId, index + 1, periodStart, periodEnd, periodEnd],
      );
      periodIds.push(period.rows[0].id);
      await client.query(
        `INSERT INTO fund_tan_period_member_obligations(tan_period_id,cycle_id,member_id,shares_snapshot,required_amount)
         VALUES($1,$2,$3,7,700)`,
        [period.rows[0].id, cycleId, memberId],
      );
    }
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const readDue = async () => {
      const response = await fetch(`${baseUrl}/api/cycles/${cycleId}/members`, {
        headers: { cookie: `irf_session=${token}` },
      });
      assert.equal(response.status, 200);
      const rows = await response.json() as Array<{ previousDue: number; currentPeriodDue: number; totalDue: number }>;
      return rows[0];
    };

    const initial = await readDue();
    assert.equal(initial.previousDue, 1400);
    assert.equal(initial.currentPeriodDue, 700);
    assert.equal(initial.totalDue, 2100);

    const partial = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,previous_due_applied,current_period_applied,tan_period_id)
       VALUES($1,$2,$3,$4,7,500,$5,'TEST','POSTED',500,0,$6) RETURNING id`,
      [`${prefix}-P1`, memberId, cycleId, isoToday(), ownerId, periodIds[2]],
    );
    const afterPartial = await readDue();
    assert.equal(afterPartial.previousDue, 900);
    assert.equal(afterPartial.currentPeriodDue, 700);
    assert.equal(afterPartial.totalDue, 1600);

    const currentPayment = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,previous_due_applied,current_period_applied,tan_period_id)
       VALUES($1,$2,$3,$4,7,900,$5,'TEST','POSTED',900,0,$6) RETURNING id`,
      [`${prefix}-P2`, memberId, cycleId, isoToday(), ownerId, periodIds[2]],
    );
    const afterClear = await readDue();
    assert.equal(afterClear.previousDue, 0);
    assert.equal(afterClear.currentPeriodDue, 700);
    assert.equal(afterClear.totalDue, 700);

    await client.query("UPDATE fund_payments SET status='REVERSED',correction_reason='test reversal' WHERE id=$1", [currentPayment.rows[0].id]);
    await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,reversed_payment_id,previous_due_applied,current_period_applied)
       VALUES($1,$2,$3,$4,7,900,$5,'TEST REVERSAL','REVERSAL',$6,900,0)`,
      [`${prefix}-R2`, memberId, cycleId, isoToday(), ownerId, currentPayment.rows[0].id],
    );
    const afterReversal = await readDue();
    assert.equal(afterReversal.previousDue, 900);
    assert.equal(afterReversal.currentPeriodDue, 700);
    assert.equal(afterReversal.totalDue, 1600);
    assert.equal(new Date(`${addDays(currentStart, -1)}T00:00:00Z`).getUTCDay(), 5);
    assert.equal(new Date(`${currentStart}T00:00:00Z`).getUTCDay(), 6);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId) {
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_member_draw_entitlements WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_tan_period_member_obligations WHERE cycle_id=$1", [cycleId]);
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
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
  }
});

test.after(async () => {
  await pool.end();
});