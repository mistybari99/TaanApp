import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `CASH-CUSTODY-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const failedPayoutTriggerName = `fund_test_payout_failure_${process.pid}`;
const failedPayoutFunctionName = `fund_test_payout_failure_fn_${process.pid}`;

type Fixture = {
  ownerId: number;
  collectorId: number;
  receiverId: number;
  memberId: number;
  cycleId: number;
  ownerToken: string;
  collectorToken: string;
  receiverToken: string;
};

async function createFixture(): Promise<Fixture | null> {
  const existingActiveCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
  if (existingActiveCycle.rows[0]) return null;
  const client = await pool.connect();
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
    const receiver = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','CASH_RECEIVER') RETURNING id`,
      [`${prefix} receiver`, `${prefix}-receiver`],
    );
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-member`, `${prefix} member`, `019${String(process.pid).padStart(8, "0")}`],
    );
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,daily_per_share,draw_frequency,draw_day,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE - interval '7 days',CURRENT_DATE - interval '7 days',100,'WEEKLY','FRIDAY','ACTIVE',$2)
       RETURNING id`,
      [`${prefix} cycle`, prefix],
    );
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100)`,
      [cycle.rows[0].id, member.rows[0].id],
    );
    const ownerToken = `${prefix}-owner-token`;
    const collectorToken = `${prefix}-collector-token`;
    const receiverToken = `${prefix}-receiver-token`;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes'),($5,$6,now()+interval '10 minutes')`,
      [
        hashToken(ownerToken), owner.rows[0].id,
        hashToken(collectorToken), collector.rows[0].id,
        hashToken(receiverToken), receiver.rows[0].id,
      ],
    );
    await client.query("COMMIT");
    return {
      ownerId: owner.rows[0].id,
      collectorId: collector.rows[0].id,
      receiverId: receiver.rows[0].id,
      memberId: member.rows[0].id,
      cycleId: cycle.rows[0].id,
      ownerToken,
      collectorToken,
      receiverToken,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(fixture: Fixture) {
  await pool.query("DELETE FROM fund_draw_disbursements WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_draws WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_cash_handovers WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_collector_weekly_targets WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_cycles WHERE id=$1", [fixture.cycleId]);
  await pool.query("DELETE FROM fund_members WHERE id=$1", [fixture.memberId]);
  await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[fixture.ownerId, fixture.collectorId, fixture.receiverId]]);
  // These are synthetic rows created by this test, so remove their audit
  // entries before removing the synthetic actors. Production history is never
  // deleted by the application.
  await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[fixture.ownerId, fixture.collectorId, fixture.receiverId]]);
  await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[fixture.ownerId, fixture.collectorId, fixture.receiverId]]);
}

const request = (baseUrl: string, path: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: `irf_session=${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type DrawExportFixture = {
  ownerId: number;
  memberId: number;
  ownerToken: string;
  memberCode: string;
  memberName: string;
  completedCycleId: number;
  completedCycleNumber: number;
  completedCycleName: string;
  completedDrawId: number;
  completedDrawDate: string;
  activeCycleId: number;
  activeCycleNumber: number;
  activeCycleName: string;
  activeDrawId: number;
  activeDrawDate: string;
  payoutDates: {
    before: string;
    boundary: string;
    after: string;
    noMatch: string;
  };
  payoutIds: Record<string, number>;
};

async function createDrawExportFixture(): Promise<DrawExportFixture> {
  const exportPrefix = `${prefix}-EXPORT`;
  const memberCode = `${exportPrefix}-member`;
  const memberName = `${exportPrefix} member`;
  const ownerToken = `${exportPrefix}-owner-token`;
  const owner = await pool.query(
    `INSERT INTO fund_users(name,username,password_hash,role)
     VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
    [`${exportPrefix} owner`, `${exportPrefix}-owner`],
  );
  const member = await pool.query(
    `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
     VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
    [memberCode, memberName, `017${String(process.pid).padStart(8, "0")}`],
  );
  const completedCycleName = `${exportPrefix} completed`;
  const completedCycle = await pool.query(
    `INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,tracking_start_date,daily_per_share,draw_frequency,draw_day,status,notes)
     VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE-interval '30 days',CURRENT_DATE-interval '20 days',CURRENT_DATE-interval '30 days',100,'WEEKLY','FRIDAY','COMPLETED',$2)
     RETURNING id,cycle_number`,
    [completedCycleName, exportPrefix],
  );
  const activeCycleName = `${exportPrefix} active`;
  const activeCycle = await pool.query(
    `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,daily_per_share,draw_frequency,draw_day,status,notes)
     VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE-interval '10 days',CURRENT_DATE-interval '10 days',100,'WEEKLY','FRIDAY','ACTIVE',$2)
     RETURNING id,cycle_number`,
    [activeCycleName, exportPrefix],
  );
  const completedCycleId = Number(completedCycle.rows[0].id);
  const activeCycleId = Number(activeCycle.rows[0].id);
  await pool.query(
    `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
     VALUES($1,$3,1,100),($2,$3,1,100)`,
    [completedCycleId, activeCycleId, member.rows[0].id],
  );
  const dates = await pool.query(
    `SELECT
       (CURRENT_DATE-interval '3 days')::date::text AS before,
       (CURRENT_DATE-interval '2 days')::date::text AS boundary,
       (CURRENT_DATE-interval '1 day')::date::text AS after,
       CURRENT_DATE::text AS "noMatch"`,
  );
  const payoutDates = dates.rows[0] as { before: string; boundary: string; after: string; noMatch: string };
  const draws = await pool.query(
    `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
     VALUES($1,1,CURRENT_DATE-interval '5 days',$3,100,'RECORDED',$4),
           ($2,1,CURRENT_DATE-interval '1 day',$3,200,'RECORDED',$4)
     RETURNING id,cycle_id,draw_date::date::text AS draw_date`,
    [completedCycleId, activeCycleId, member.rows[0].id, exportPrefix],
  );
  const completedDraw = draws.rows.find((row) => Number(row.cycle_id) === completedCycleId)!;
  const activeDraw = draws.rows.find((row) => Number(row.cycle_id) === activeCycleId)!;
  const completedDrawId = Number(completedDraw.id);
  const activeDrawId = Number(activeDraw.id);
  const payoutReferences = [
    `${exportPrefix}-payout-before`,
    `${exportPrefix}-payout-boundary`,
    `${exportPrefix}-payout-after`,
    `${exportPrefix}-active-payout`,
  ];
  const payouts = await pool.query(
    `INSERT INTO fund_draw_disbursements(draw_id,cycle_id,payer_user_id,winner_member_id,amount,payout_date,reference,status,created_by)
     VALUES
       ($1,$3,$5,$6,100,$7,$9,'REVERSED',$5),
       ($1,$3,$5,$6,100,$8,$10,'REVERSED',$5),
       ($1,$3,$5,$6,100,$11,$12,'PAID',$5),
       ($2,$4,$5,$6,200,$8,$13,'PAID',$5)
     RETURNING id,reference`,
    [
      completedDrawId,
      activeDrawId,
      completedCycleId,
      activeCycleId,
      owner.rows[0].id,
      member.rows[0].id,
      payoutDates.before,
      payoutDates.boundary,
      payoutReferences[0],
      payoutReferences[1],
      payoutDates.after,
      payoutReferences[2],
      payoutReferences[3],
    ],
  );
  await pool.query(
    `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
     VALUES($1,$2,now()+interval '10 minutes')`,
    [hashToken(ownerToken), owner.rows[0].id],
  );
  return {
    ownerId: Number(owner.rows[0].id),
    memberId: Number(member.rows[0].id),
    ownerToken,
    memberCode,
    memberName,
    completedCycleId,
    completedCycleNumber: Number(completedCycle.rows[0].cycle_number),
    completedCycleName,
    completedDrawId,
    completedDrawDate: completedDraw.draw_date,
    activeCycleId,
    activeCycleNumber: Number(activeCycle.rows[0].cycle_number),
    activeCycleName,
    activeDrawId,
    activeDrawDate: activeDraw.draw_date,
    payoutDates,
    payoutIds: Object.fromEntries(payouts.rows.map((row) => [row.reference, Number(row.id)])),
  };
}

async function cleanupDrawExportFixture(fixture: DrawExportFixture) {
  const cycleIds = [fixture.completedCycleId, fixture.activeCycleId];
  await pool.query("DELETE FROM fund_draw_disbursements WHERE cycle_id=ANY($1::int[])", [cycleIds]);
  await pool.query("DELETE FROM fund_draws WHERE cycle_id=ANY($1::int[])", [cycleIds]);
  await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=ANY($1::int[])", [cycleIds]);
  await pool.query("DELETE FROM fund_cycles WHERE id=ANY($1::int[])", [cycleIds]);
  await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [fixture.ownerId]);
  await pool.query("DELETE FROM fund_members WHERE id=$1", [fixture.memberId]);
  await pool.query("DELETE FROM fund_users WHERE id=$1", [fixture.ownerId]);
}

type DrawExportRow = Record<string, string>;

const parseDrawExport = (csv: string): DrawExportRow[] => {
  const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\n");
  const headers = lines.shift()?.split(",") ?? [];
  return lines.filter(Boolean).map((line) => {
    const values = [...line.matchAll(/"((?:""|[^"])*)"/g)]
      .map((match) => match[1].replaceAll('""', '"'));
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
};

test("draw payout export keeps cycle scope, inclusive date bounds, and ledger rows", async () => {
  const fixture = await createDrawExportFixture();
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const exportRows = async (query: string) => {
      const response = await request(baseUrl, `/api/reports/export?type=draws${query}`, fixture.ownerToken);
      assert.equal(response.status, 200);
      return parseDrawExport(await response.text());
    };
    const assertExportRows = (
      rows: DrawExportRow[],
      expected: Array<{
        reference: string;
        payoutDate: string;
        payoutAmount: number;
        payoutStatus: string;
        payoutId: number;
        drawId: number;
        drawDate: string;
        cycleId: number;
        cycleNumber: number;
        cycleName: string;
        winningAmount: number;
      }>,
    ) => {
      assert.deepEqual(rows.map((row) => row.Reference), expected.map((entry) => entry.reference));
      for (const [index, entry] of expected.entries()) {
        const row = rows[index];
        assert.equal(row["Draw ID"], String(entry.drawId));
        assert.equal(row["Cycle ID"], String(entry.cycleId));
        assert.equal(row["Cycle Number"], String(entry.cycleNumber));
        assert.equal(row["Cycle Name"], entry.cycleName);
        assert.equal(row["Draw Date"], entry.drawDate);
        assert.equal(row["Winner Member ID"], fixture.memberCode);
        assert.equal(row.Winner, fixture.memberName);
        assert.equal(row["Winning Amount"], String(entry.winningAmount));
        assert.equal(row["Draw Status"], "RECORDED");
        assert.equal(row["Payout Ledger ID"], String(entry.payoutId));
        assert.equal(row["Payout Status"], entry.payoutStatus);
        assert.equal(row["Payout Date"], entry.payoutDate);
        assert.equal(row["Payout Amount"], String(entry.payoutAmount));
        assert.equal(row.Reference, entry.reference);
      }
    };
    const expectedRows = [
      { reference: `${prefix}-EXPORT-payout-before`, payoutDate: fixture.payoutDates.before, payoutAmount: 100, payoutStatus: "REVERSED", payoutId: fixture.payoutIds[`${prefix}-EXPORT-payout-before`], drawId: fixture.completedDrawId, drawDate: fixture.completedDrawDate, cycleId: fixture.completedCycleId, cycleNumber: fixture.completedCycleNumber, cycleName: fixture.completedCycleName, winningAmount: 100 },
      { reference: `${prefix}-EXPORT-payout-boundary`, payoutDate: fixture.payoutDates.boundary, payoutAmount: 100, payoutStatus: "REVERSED", payoutId: fixture.payoutIds[`${prefix}-EXPORT-payout-boundary`], drawId: fixture.completedDrawId, drawDate: fixture.completedDrawDate, cycleId: fixture.completedCycleId, cycleNumber: fixture.completedCycleNumber, cycleName: fixture.completedCycleName, winningAmount: 100 },
      { reference: `${prefix}-EXPORT-payout-after`, payoutDate: fixture.payoutDates.after, payoutAmount: 100, payoutStatus: "PAID", payoutId: fixture.payoutIds[`${prefix}-EXPORT-payout-after`], drawId: fixture.completedDrawId, drawDate: fixture.completedDrawDate, cycleId: fixture.completedCycleId, cycleNumber: fixture.completedCycleNumber, cycleName: fixture.completedCycleName, winningAmount: 100 },
      { reference: `${prefix}-EXPORT-active-payout`, payoutDate: fixture.payoutDates.boundary, payoutAmount: 200, payoutStatus: "PAID", payoutId: fixture.payoutIds[`${prefix}-EXPORT-active-payout`], drawId: fixture.activeDrawId, drawDate: fixture.activeDrawDate, cycleId: fixture.activeCycleId, cycleNumber: fixture.activeCycleNumber, cycleName: fixture.activeCycleName, winningAmount: 200 },
    ];
    const expectedByReference = new Map(expectedRows.map((entry) => [entry.reference, entry]));
    const assertScopedRows = (rows: DrawExportRow[], references: string[]) => {
      assertExportRows(rows, references.map((reference) => {
        const entry = expectedByReference.get(reference);
        assert.ok(entry);
        return entry;
      }));
    };
    const completedRows = await exportRows(`&cycleId=${fixture.completedCycleId}`);
    assertScopedRows(completedRows, [
      `${prefix}-EXPORT-payout-before`,
      `${prefix}-EXPORT-payout-boundary`,
      `${prefix}-EXPORT-payout-after`,
    ]);
    const omittedCycleRows = await exportRows("");
    assertScopedRows(omittedCycleRows, [
      `${prefix}-EXPORT-active-payout`,
      `${prefix}-EXPORT-payout-before`,
      `${prefix}-EXPORT-payout-boundary`,
      `${prefix}-EXPORT-payout-after`,
    ]);
    assert.equal(omittedCycleRows.filter((row) => row["Draw ID"] === String(fixture.completedDrawId)).length, 3);
    assert.equal(omittedCycleRows.filter((row) => row["Draw ID"] === String(fixture.activeDrawId)).length, 1);
    const startBoundRows = await exportRows(`&startDate=${fixture.payoutDates.boundary}`);
    assertScopedRows(startBoundRows, [
      `${prefix}-EXPORT-active-payout`,
      `${prefix}-EXPORT-payout-boundary`,
      `${prefix}-EXPORT-payout-after`,
    ]);
    const endBoundRows = await exportRows(`&endDate=${fixture.payoutDates.boundary}`);
    assertScopedRows(endBoundRows, [
      `${prefix}-EXPORT-active-payout`,
      `${prefix}-EXPORT-payout-before`,
      `${prefix}-EXPORT-payout-boundary`,
    ]);
    const twoSidedRows = await exportRows(`&startDate=${fixture.payoutDates.boundary}&endDate=${fixture.payoutDates.boundary}`);
    assertScopedRows(twoSidedRows, [
      `${prefix}-EXPORT-active-payout`,
      `${prefix}-EXPORT-payout-boundary`,
    ]);
    const noMatchingRows = await exportRows(`&startDate=${fixture.payoutDates.noMatch}&endDate=${fixture.payoutDates.noMatch}`);
    assert.deepEqual(noMatchingRows, []);

    const reversedDates = await request(
      baseUrl,
      `/api/reports/export?type=draws&startDate=${fixture.payoutDates.after}&endDate=${fixture.payoutDates.before}`,
      fixture.ownerToken,
    );
    assert.equal(reversedDates.status, 400);
    assert.deepEqual(await reversedDates.json(), { error: "Start date cannot be after end date" });
    for (const invalidQuery of ["&startDate=not-a-date", "&endDate=not-a-date"]) {
      const invalidDate = await request(baseUrl, `/api/reports/export?type=draws${invalidQuery}`, fixture.ownerToken);
      assert.equal(invalidDate.status, 400);
      assert.deepEqual(await invalidDate.json(), { error: "Date filters must use YYYY-MM-DD" });
    }
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await cleanupDrawExportFixture(fixture);
  }
});

test("cash custody records direct Owner receipt and a two-step handover atomically", async () => {
  const fixture = await createFixture();
  if (!fixture) {
    assert.ok(true, "Skipped because the workspace already has an active cycle");
    return;
  }
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const targetResponse = await request(baseUrl, "/api/collector-targets", fixture.ownerToken, {
      collectorId: fixture.collectorId,
      targetAmount: 50000,
    });
    assert.equal(targetResponse.status, 200);
    const targetBody = await targetResponse.json() as { targetAmount: number; acceptedAmount: number; remainingAmount: number };
    assert.deepEqual(
      { target: targetBody.targetAmount, accepted: targetBody.acceptedAmount, remaining: targetBody.remainingAmount },
      { target: 50000, accepted: 0, remaining: 50000 },
    );
    const collectorTargetResponse = await request(baseUrl, "/api/collector-targets", fixture.collectorToken);
    assert.equal(collectorTargetResponse.status, 200);
    const collectorTargets = await collectorTargetResponse.json() as Array<{ targetAmount: number }>;
    assert.equal(collectorTargets[0]?.targetAmount, 50000);

    const directPayment = await request(baseUrl, "/api/payments", fixture.ownerToken, {
      memberId: fixture.memberId,
      cycleId: fixture.cycleId,
      amount: 100,
      verificationMethod: "OWNER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-owner-payment`,
    });
    assert.equal(directPayment.status, 201);
    const directBody = await directPayment.json() as { receiptSource: string; receiverName: string };
    assert.equal(directBody.receiptSource, "OWNER_DIRECT");
    assert.equal(directBody.receiverName, `${prefix} owner`);

    const receiverDirectPayment = await request(baseUrl, "/api/payments", fixture.receiverToken, {
      memberId: fixture.memberId,
      cycleId: fixture.cycleId,
      amount: 100,
      verificationMethod: "CASH_RECEIVER_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-receiver-payment`,
    });
    assert.equal(receiverDirectPayment.status, 201);
    const receiverDirectBody = await receiverDirectPayment.json() as { receiptSource: string; receiverName: string };
    assert.equal(receiverDirectBody.receiptSource, "CASH_RECEIVER_DIRECT");
    assert.equal(receiverDirectBody.receiverName, `${prefix} receiver`);
    const receiverDirectRow = await pool.query(
      "SELECT collector_id,receiver_id,receipt_source FROM fund_payments WHERE idempotency_key=$1",
      [`${prefix}-receiver-payment`],
    );
    assert.equal(receiverDirectRow.rows[0].collector_id, null);
    assert.equal(Number(receiverDirectRow.rows[0].receiver_id), fixture.receiverId);
    assert.equal(receiverDirectRow.rows[0].receipt_source, "CASH_RECEIVER_DIRECT");

    const collectionDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    const invalidDestination = await request(baseUrl, "/api/cash-handovers", fixture.collectorToken, {
      toUserId: fixture.collectorId,
      amount: 1,
      collectionDate,
      reference: `${prefix}-invalid-destination`,
      idempotencyKey: `${prefix}-invalid-destination`,
    });
    assert.equal(invalidDestination.status, 400);

    const collectorPayment = await request(baseUrl, "/api/payments", fixture.collectorToken, {
      memberId: fixture.memberId,
      cycleId: fixture.cycleId,
      amount: 100,
      verificationMethod: "COLLECTOR_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-collector-payment`,
    });
    assert.equal(collectorPayment.status, 201);

    const rejectedHandover = await request(baseUrl, "/api/cash-handovers", fixture.collectorToken, {
      toUserId: fixture.ownerId,
      amount: 100,
      collectionDate,
      reference: `${prefix}-rejected`,
      idempotencyKey: `${prefix}-rejected`,
    });
    assert.equal(rejectedHandover.status, 201);
    const rejectedBody = await rejectedHandover.json() as { id: number };
    const rejected = await request(baseUrl, `/api/cash-handovers/${rejectedBody.id}/reject`, fixture.ownerToken, {
      reason: "Synthetic count mismatch",
    });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json() as { status: string }).status, "REJECTED");

    const handoverPayload = {
      toUserId: fixture.receiverId,
      amount: 100,
      collectionDate,
      reference: `${prefix}-collector-to-receiver`,
      receiptCount: 1,
      idempotencyKey: `${prefix}-handover-1`,
    };
    const concurrentSubmissions = await Promise.all([
      request(baseUrl, "/api/cash-handovers", fixture.collectorToken, handoverPayload),
      request(baseUrl, "/api/cash-handovers", fixture.collectorToken, { ...handoverPayload, reference: `${prefix}-handover-concurrent`, idempotencyKey: `${prefix}-handover-concurrent` }),
    ]);
    assert.equal(concurrentSubmissions.filter((response) => response.status === 201).length, 1);
    assert.equal(concurrentSubmissions.filter((response) => response.status === 409).length, 1);
    const submitted = concurrentSubmissions.find((response) => response.status === 201)!;
    const submittedBody = await submitted.json() as { id: number; status: string };
    assert.equal(submittedBody.status, "SUBMITTED");

    const wrongRole = await request(baseUrl, `/api/cash-handovers/${submittedBody.id}/accept`, fixture.collectorToken, { countedAmount: 100 });
    assert.equal(wrongRole.status, 403);

    const accepted = await request(baseUrl, `/api/cash-handovers/${submittedBody.id}/accept`, fixture.receiverToken, { countedAmount: 100 });
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json() as { status: string; countedAmount: number; countedBy: number; receivedBy: number };
    assert.equal(acceptedBody.status, "ACCEPTED");
    assert.equal(acceptedBody.countedAmount, 100);
    assert.equal(acceptedBody.countedBy, fixture.receiverId);
    assert.equal(acceptedBody.receivedBy, fixture.receiverId);
    const progressResponse = await request(baseUrl, "/api/collector-targets", fixture.ownerToken);
    assert.equal(progressResponse.status, 200);
    const progressTargets = await progressResponse.json() as Array<{ acceptedAmount: number; remainingAmount: number; isAchieved: boolean }>;
    assert.deepEqual(
      { accepted: progressTargets[0]?.acceptedAmount, remaining: progressTargets[0]?.remainingAmount, achieved: progressTargets[0]?.isAchieved },
      { accepted: 100, remaining: 49900, achieved: false },
    );

    const finalHandover = await request(baseUrl, "/api/cash-handovers", fixture.receiverToken, {
      toUserId: fixture.ownerId,
      amount: 100,
      collectionDate: handoverPayload.collectionDate,
      reference: `${prefix}-receiver-to-owner`,
      receiptCount: 1,
      idempotencyKey: `${prefix}-handover-2`,
    });
    assert.equal(finalHandover.status, 201);
    const finalBody = await finalHandover.json() as { id: number };
    const finalAccepted = await request(baseUrl, `/api/cash-handovers/${finalBody.id}/accept`, fixture.ownerToken, { countedAmount: 100 });
    assert.equal(finalAccepted.status, 200);
    const finalAcceptedBody = await finalAccepted.json() as { status: string };
    assert.equal(finalAcceptedBody.status, "ACCEPTED");

    const drawDate = new Date();
    drawDate.setUTCDate(drawDate.getUTCDate() - ((drawDate.getUTCDay() + 2) % 7));
    const drawDateIso = drawDate.toISOString().slice(0, 10);
    const draw = await request(baseUrl, "/api/draws", fixture.ownerToken, {
      cycleId: fixture.cycleId,
      drawDate: drawDateIso,
      winnerMemberId: fixture.memberId,
      winningAmount: 50,
      idempotencyKey: `${prefix}-draw-1`,
    });
    assert.equal(draw.status, 201);
    const drawBody = await draw.json() as { id: number; payoutStatus: string | null };
    assert.equal(drawBody.payoutStatus, null);
    const movedDrawDate = new Date(`${drawDateIso}T00:00:00Z`);
    movedDrawDate.setUTCDate(movedDrawDate.getUTCDate() - 1);
    const movedDrawDateIso = movedDrawDate.toISOString().slice(0, 10);
    const moved = await request(baseUrl, `/api/draws/${drawBody.id}/move-date`, fixture.ownerToken, {
      drawDate: movedDrawDateIso,
      reason: "Synthetic manual draw-date correction",
    });
    assert.equal(moved.status, 200);
    const movedBody = await moved.json() as { id: number; drawNumber: number; drawDate: string; tanPeriodId: number | null };
    assert.equal(movedBody.id, drawBody.id);
    assert.equal(movedBody.drawDate, movedDrawDateIso);
    assert.ok(movedBody.drawNumber > 0);

    const insufficient = await request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, {
      payerUserId: fixture.collectorId,
      amount: 50,
      payoutDate: drawDateIso,
      reference: `${prefix}-insufficient`,
      idempotencyKey: `${prefix}-payout-insufficient`,
    });
    assert.equal(insufficient.status, 409);

    const payoutPayloads = [
      {
        payerUserId: fixture.ownerId,
        amount: 50,
        payoutDate: drawDateIso,
        reference: `${prefix}-payout-1`,
        idempotencyKey: `${prefix}-payout-1`,
      },
      {
        payerUserId: fixture.ownerId,
        amount: 50,
        payoutDate: drawDateIso,
        reference: `${prefix}-payout-concurrent`,
        idempotencyKey: `${prefix}-payout-concurrent`,
      },
    ];
    const concurrentPayouts = await Promise.all(
      payoutPayloads.map((payload) =>
        request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, payload),
      ),
    );
    assert.equal(concurrentPayouts.filter((response) => response.status === 201).length, 1);
    assert.equal(concurrentPayouts.filter((response) => response.status === 409).length, 1);
    const winnerIndex = concurrentPayouts.findIndex((response) => response.status === 201);
    const loserIndex = concurrentPayouts.findIndex((response) => response.status === 409);
    assert.notEqual(winnerIndex, -1);
    assert.notEqual(loserIndex, -1);
    const payoutBody = await concurrentPayouts[winnerIndex].json() as {
      payoutId: number;
      payoutStatus: string;
      payoutPayerId: number;
      payoutAmount: number;
    };
    assert.ok(payoutBody.payoutId);
    assert.equal(payoutBody.payoutStatus, "PAID");
    assert.equal(payoutBody.payoutPayerId, fixture.ownerId);
    assert.equal(payoutBody.payoutAmount, 50);
    const losingPayoutBody = await concurrentPayouts[loserIndex].json() as { error: string };
    assert.match(losingPayoutBody.error, /already been paid/);

    const disbursements = await pool.query(
      "SELECT id,status,amount,payer_user_id FROM fund_draw_disbursements WHERE draw_id=$1",
      [drawBody.id],
    );
    assert.equal(disbursements.rows.length, 1);
    assert.equal(Number(disbursements.rows[0].id), payoutBody.payoutId);
    assert.equal(disbursements.rows[0].status, "PAID");
    assert.equal(Number(disbursements.rows[0].amount), 50);
    assert.equal(Number(disbursements.rows[0].payer_user_id), fixture.ownerId);

    const payoutAudits = await pool.query(
      `SELECT action,entity_type,entity_id,related_transaction_id
         FROM fund_audit
        WHERE actor_id=$1 AND cycle_id=$2 AND action='DRAW_PAYOUT_RECORDED'`,
      [fixture.ownerId, fixture.cycleId],
    );
    assert.equal(payoutAudits.rows.length, 1);
    assert.equal(payoutAudits.rows[0].entity_type, "draw_disbursement");
    assert.equal(Number(payoutAudits.rows[0].entity_id), payoutBody.payoutId);
    assert.equal(payoutAudits.rows[0].related_transaction_id, String(payoutBody.payoutId));

    const balancesAfterPayout = await request(baseUrl, "/api/cash-custody/balances", fixture.ownerToken);
    assert.equal(balancesAfterPayout.status, 200);
    const balanceRows = await balancesAfterPayout.json() as Array<{ userId: number; availableAmount: number; drawPayouts: number }>;
    const ownerBalance = balanceRows.find((row) => row.userId === fixture.ownerId);
    assert.equal(ownerBalance?.availableAmount, 150);
    assert.equal(ownerBalance?.drawPayouts, 50);

    const duplicate = await request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, {
      ...payoutPayloads[loserIndex],
      idempotencyKey: `${prefix}-payout-duplicate`,
    });
    assert.equal(duplicate.status, 409);

    const replay = await request(
      baseUrl,
      `/api/draws/${drawBody.id}/disbursement`,
      fixture.ownerToken,
      payoutPayloads[winnerIndex],
    );
    assert.equal(replay.status, 200);

    const drawWithPayout = await request(baseUrl, "/api/draws", fixture.ownerToken);
    assert.equal(drawWithPayout.status, 200);
    const listedDraws = await drawWithPayout.json() as Array<{ id: number; payoutId: number; payoutStatus: string }>;
    const listed = listedDraws.find((row) => row.id === drawBody.id);
    assert.equal(listed?.payoutStatus, "PAID");
    assert.ok(listed?.payoutId);

    const actualPayoutId = listed?.payoutId as number;
    const reversal = await request(baseUrl, `/api/draw-disbursements/${actualPayoutId}/reverse`, fixture.ownerToken, {
      reason: "Synthetic reversal coverage",
    });
    assert.equal(reversal.status, 200);
    const reversalBody = await reversal.json() as { payoutStatus: string };
    assert.equal(reversalBody.payoutStatus, "REVERSED");

    const balancesAfterReversal = await request(baseUrl, "/api/cash-custody/balances", fixture.ownerToken);
    const restoredRows = await balancesAfterReversal.json() as Array<{ userId: number; availableAmount: number; drawPayouts: number }>;
    const restoredOwnerBalance = restoredRows.find((row) => row.userId === fixture.ownerId);

    assert.equal(restoredOwnerBalance?.availableAmount, 200);
    assert.equal(restoredOwnerBalance?.drawPayouts, 0);

    const sameKeyPayoutPayload = {
      payerUserId: fixture.ownerId,
      amount: 50,
      payoutDate: drawDateIso,
      reference: `${prefix}-payout-same-key`,
      idempotencyKey: `${prefix}-payout-same-key`,
    };
    const sameKeyPayouts = await Promise.all([
      request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, sameKeyPayoutPayload),
      request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, sameKeyPayoutPayload),
    ]);
    assert.equal(sameKeyPayouts.filter((response) => response.status === 201).length, 1);
    assert.equal(sameKeyPayouts.filter((response) => response.status === 200).length, 1);
    const sameKeyBodies = await Promise.all(sameKeyPayouts.map((response) => response.json() as Promise<{
      payoutId: number;
      payoutStatus: string;
      payoutReference: string;
    }>));
    assert.equal(sameKeyBodies[0].payoutId, sameKeyBodies[1].payoutId);
    assert.equal(sameKeyBodies[0].payoutStatus, "PAID");
    assert.equal(sameKeyBodies[1].payoutStatus, "PAID");
    const sameKeyRows = await pool.query(
      "SELECT id,status,reference FROM fund_draw_disbursements WHERE draw_id=$1 AND idempotency_key=$2",
      [drawBody.id, sameKeyPayoutPayload.idempotencyKey],
    );
    assert.deepEqual(sameKeyRows.rows, [{
      id: sameKeyBodies[0].payoutId,
      status: "PAID",
      reference: sameKeyPayoutPayload.reference,
    }]);
    const sameKeyAudits = await pool.query(
      `SELECT id
         FROM fund_audit
        WHERE actor_id=$1 AND cycle_id=$2 AND action='DRAW_PAYOUT_RECORDED'
          AND entity_type='draw_disbursement' AND entity_id=$3`,
      [fixture.ownerId, fixture.cycleId, String(sameKeyBodies[0].payoutId)],
    );
    assert.equal(sameKeyAudits.rows.length, 1);
    const balancesAfterSameKeyPayout = await request(baseUrl, "/api/cash-custody/balances", fixture.ownerToken);
    assert.equal(balancesAfterSameKeyPayout.status, 200);
    const sameKeyBalanceRows = await balancesAfterSameKeyPayout.json() as Array<{ userId: number; availableAmount: number; drawPayouts: number }>;
    const sameKeyOwnerBalance = sameKeyBalanceRows.find((row) => row.userId === fixture.ownerId);
    assert.equal(sameKeyOwnerBalance?.availableAmount, 150);
    assert.equal(sameKeyOwnerBalance?.drawPayouts, 50);
    const sameKeyReversal = await request(baseUrl, `/api/draw-disbursements/${sameKeyBodies[0].payoutId}/reverse`, fixture.ownerToken, {
      reason: "Synthetic same-key retry cleanup",
    });
    assert.equal(sameKeyReversal.status, 200);

    const failedReference = `${prefix}-payout-forced-failure`;
    const failedIdempotencyKey = `${prefix}-payout-forced-failure`;
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${failedPayoutFunctionName}() RETURNS trigger
      LANGUAGE plpgsql AS $failure$
      BEGIN
        IF NEW.reference = '${failedReference}' THEN
          RAISE EXCEPTION 'synthetic payout save failure';
        END IF;
        RETURN NEW;
      END;
      $failure$;
      DROP TRIGGER IF EXISTS ${failedPayoutTriggerName} ON fund_draw_disbursements;
      CREATE TRIGGER ${failedPayoutTriggerName}
      AFTER INSERT ON fund_draw_disbursements
      FOR EACH ROW EXECUTE FUNCTION ${failedPayoutFunctionName}();
    `);
    const failedPayout = await request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, {
      payerUserId: fixture.ownerId,
      amount: 50,
      payoutDate: drawDateIso,
      reference: failedReference,
      idempotencyKey: failedIdempotencyKey,
    });
    assert.equal(failedPayout.status, 409);
    await pool.query(`DROP TRIGGER IF EXISTS ${failedPayoutTriggerName} ON fund_draw_disbursements`);
    await pool.query(`DROP FUNCTION IF EXISTS ${failedPayoutFunctionName}()`);
    const failedPayoutRows = await pool.query(
      "SELECT id FROM fund_draw_disbursements WHERE draw_id=$1 AND reference=$2",
      [drawBody.id, failedReference],
    );
    assert.equal(failedPayoutRows.rows.length, 0);
    const failedPayoutRecordedAudits = await pool.query(
      `SELECT id
         FROM fund_audit
        WHERE actor_id=$1 AND cycle_id=$2 AND action='DRAW_PAYOUT_RECORDED'
          AND after_value->>'reference'=$3`,
      [fixture.ownerId, fixture.cycleId, failedReference],
    );
    assert.equal(failedPayoutRecordedAudits.rows.length, 0);
    const failedPayoutAudits = await pool.query(
      `SELECT action,entity_type,entity_id,cycle_id,related_transaction_id,after_value
         FROM fund_audit
        WHERE actor_id=$1 AND cycle_id=$2 AND action='DRAW_PAYOUT_SAVE_FAILED'
          AND related_transaction_id=$3`,
      [fixture.ownerId, fixture.cycleId, failedIdempotencyKey],
    );
    assert.equal(failedPayoutAudits.rows.length, 1);
    assert.equal(failedPayoutAudits.rows[0].entity_type, "draw");
    assert.equal(failedPayoutAudits.rows[0].entity_id, String(drawBody.id));
    assert.deepEqual(failedPayoutAudits.rows[0].after_value, {
      drawId: drawBody.id,
      payerUserId: fixture.ownerId,
      amount: 50,
      status: "FAILED",
      reference: failedReference,
    });

    const replacementPayout = await request(baseUrl, `/api/draws/${drawBody.id}/disbursement`, fixture.ownerToken, {
      payerUserId: fixture.ownerId,
      amount: 50,
      payoutDate: drawDateIso,
      reference: `${prefix}-payout-replacement`,
      idempotencyKey: failedIdempotencyKey,
    });
    assert.equal(replacementPayout.status, 201);
    const replacementPayoutBody = await replacementPayout.json() as { payoutId: number };
    const replacementPayoutRows = await pool.query(
      "SELECT id,status FROM fund_draw_disbursements WHERE draw_id=$1 AND reference=$2 AND idempotency_key=$3",
      [drawBody.id, `${prefix}-payout-replacement`, failedIdempotencyKey],
    );
    assert.deepEqual(replacementPayoutRows.rows, [{
      id: replacementPayoutBody.payoutId,
      status: "PAID",
    }]);
    const replacementPayoutAudits = await pool.query(
      `SELECT id,entity_type,entity_id,related_transaction_id
         FROM fund_audit
        WHERE actor_id=$1 AND cycle_id=$2 AND action='DRAW_PAYOUT_RECORDED'
          AND entity_type='draw_disbursement' AND entity_id=$3`,
      [fixture.ownerId, fixture.cycleId, String(replacementPayoutBody.payoutId)],
    );
    assert.equal(replacementPayoutAudits.rows.length, 1);
    assert.equal(replacementPayoutAudits.rows[0].entity_type, "draw_disbursement");
    assert.equal(replacementPayoutAudits.rows[0].entity_id, String(replacementPayoutBody.payoutId));
    assert.equal(replacementPayoutAudits.rows[0].related_transaction_id, String(replacementPayoutBody.payoutId));
    const memberHistoryResponse = await request(baseUrl, `/api/members/${fixture.memberId}/history`, fixture.ownerToken);
    assert.equal(memberHistoryResponse.status, 200);
    const memberHistory = await memberHistoryResponse.json() as {
      draws: Array<{
        id: number;
        payoutStatus: string | null;
        payoutHistory: Array<{ reference: string; status: string }>;
        payoutAttempts: Array<{
          id: number;
          payerUserId: number;
          payerName: string;
          amount: number;
          payoutDate: string;
          reference: string;
          status: string;
          createdAt: string;
          reversedAt: string | null;
          reversalReason: string | null;
        }>;
      }>;
    };
    const historicalDraw = memberHistory.draws.find((row) => row.id === drawBody.id);
    assert.equal(historicalDraw?.payoutStatus, "PAID");
    assert.deepEqual(
      historicalDraw?.payoutHistory.map((payout) => payout.status),
      ["REVERSED", "REVERSED", "PAID"],
    );
    assert.deepEqual(
      historicalDraw?.payoutHistory.map((payout) => payout.reference),
      [payoutPayloads[winnerIndex].reference, `${prefix}-payout-same-key`, `${prefix}-payout-replacement`],
    );
    assert.equal(historicalDraw?.payoutAttempts.length, 3);
    assert.equal(historicalDraw?.payoutAttempts[0].payerUserId, fixture.ownerId);
    assert.equal(historicalDraw?.payoutAttempts[0].payerName, `${prefix} owner`);
    assert.equal(historicalDraw?.payoutAttempts[0].amount, 50);
    assert.equal(historicalDraw?.payoutAttempts[0].payoutDate, drawDateIso);
    assert.equal(historicalDraw?.payoutAttempts[0].reference, payoutPayloads[winnerIndex].reference);
    assert.equal(historicalDraw?.payoutAttempts[0].status, "REVERSED");
    assert.ok(historicalDraw?.payoutAttempts[0].createdAt);
    assert.ok(historicalDraw?.payoutAttempts[0].reversedAt);
    assert.equal(historicalDraw?.payoutAttempts[0].reversalReason, "Synthetic reversal coverage");
    assert.deepEqual(
      historicalDraw?.payoutAttempts.map((payout) => payout.reference),
      [payoutPayloads[winnerIndex].reference, `${prefix}-payout-same-key`, `${prefix}-payout-replacement`],
    );

    const drawHistoryResponse = await request(baseUrl, "/api/draws", fixture.ownerToken);
    assert.equal(drawHistoryResponse.status, 200);
    const drawHistory = await drawHistoryResponse.json() as Array<{
      id: number;
      payoutStatus: string;
      payoutAttempts: Array<{
        id: number;
        payerUserId: number;
        payerName: string;
        amount: number;
        payoutDate: string;
        reference: string;
        status: string;
        createdAt: string;
        reversedAt: string | null;
        reversalReason: string | null;
      }>;
    }>;
    const correctedDraw = drawHistory.find((row) => row.id === drawBody.id);
    assert.equal(correctedDraw?.payoutStatus, "PAID");
    assert.equal(correctedDraw?.payoutAttempts.length, 3);
    assert.equal(correctedDraw?.payoutAttempts[0].id, actualPayoutId);
    assert.equal(correctedDraw?.payoutAttempts[0].payerUserId, fixture.ownerId);
    assert.equal(correctedDraw?.payoutAttempts[0].payerName, `${prefix} owner`);
    assert.equal(correctedDraw?.payoutAttempts[0].amount, 50);
    assert.equal(correctedDraw?.payoutAttempts[0].payoutDate, drawDateIso);
    assert.equal(correctedDraw?.payoutAttempts[0].reference, payoutPayloads[winnerIndex].reference);
    assert.equal(correctedDraw?.payoutAttempts[0].status, "REVERSED");
    assert.ok(correctedDraw?.payoutAttempts[0].createdAt);
    assert.ok(correctedDraw?.payoutAttempts[0].reversedAt);
    assert.equal(correctedDraw?.payoutAttempts[0].reversalReason, "Synthetic reversal coverage");
    assert.equal(correctedDraw?.payoutAttempts[1].reference, sameKeyPayoutPayload.reference);
    assert.equal(correctedDraw?.payoutAttempts[1].status, "REVERSED");
    assert.equal(correctedDraw?.payoutAttempts[1].reversalReason, "Synthetic same-key retry cleanup");
    assert.equal(correctedDraw?.payoutAttempts[2].reference, `${prefix}-payout-replacement`);
    assert.equal(correctedDraw?.payoutAttempts[2].status, "PAID");
    assert.ok(correctedDraw?.payoutAttempts[2].createdAt);

    const unpaidDrawResponse = await request(baseUrl, "/api/draws", fixture.ownerToken, {
      cycleId: fixture.cycleId,
      drawDate: drawDateIso,
      winnerMemberId: fixture.memberId,
      winningAmount: 75,
      idempotencyKey: `${prefix}-draw-unpaid`,
    });
    assert.equal(unpaidDrawResponse.status, 201);
    const unpaidDraw = await unpaidDrawResponse.json() as { id: number };
    const unpaidMemberHistoryResponse = await request(baseUrl, `/api/members/${fixture.memberId}/history`, fixture.ownerToken);
    assert.equal(unpaidMemberHistoryResponse.status, 200);
    const unpaidMemberHistory = await unpaidMemberHistoryResponse.json() as {
      draws: Array<{
        id: number;
        payoutStatus: string | null;
        payoutAttempts: Array<unknown>;
      }>;
    };
    const unpaidHistoricalDraw = unpaidMemberHistory.draws.find((row) => row.id === unpaidDraw.id);
    assert.equal(unpaidHistoricalDraw?.payoutStatus, null);
    assert.deepEqual(unpaidHistoricalDraw?.payoutAttempts, []);

    await pool.query("UPDATE fund_cycles SET status='COMPLETED',end_date=CURRENT_DATE WHERE id=$1", [fixture.cycleId]);
    const drawExport = await request(
      baseUrl,
      `/api/reports/export?type=draws&cycleId=${fixture.cycleId}&startDate=${drawDateIso}&endDate=${drawDateIso}`,
      fixture.ownerToken,
    );
    assert.equal(drawExport.status, 200);
    const drawExportCsv = await drawExport.text();
    assert.match(drawExportCsv, /Payout Ledger ID/);
    assert.match(drawExportCsv, /Cycle Number/);
    assert.match(drawExportCsv, new RegExp(`${prefix}-payout-replacement`));
    assert.equal(drawExportCsv.split("\n").filter((line) => line.includes(prefix)).length, 3);

    const allCycleDrawExport = await request(
      baseUrl,
      "/api/reports/export?type=draws",
      fixture.ownerToken,
    );
    assert.equal(allCycleDrawExport.status, 200);
    const allCycleDrawExportCsv = await allCycleDrawExport.text();
    assert.match(allCycleDrawExportCsv, new RegExp(`${prefix}-payout-replacement`));
    assert.equal(allCycleDrawExportCsv.split("\n").filter((line) => line.includes(prefix)).length, 4);

    const handoverReplay = await request(baseUrl, "/api/cash-handovers", fixture.collectorToken, handoverPayload);
    assert.equal(handoverReplay.status, 200);
    const handoverReplayBody = await handoverReplay.json() as { id: number };
    assert.equal(handoverReplayBody.id, submittedBody.id);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await pool.query(`DROP TRIGGER IF EXISTS ${failedPayoutTriggerName} ON fund_draw_disbursements`).catch(() => undefined);
    await pool.query(`DROP FUNCTION IF EXISTS ${failedPayoutFunctionName}()`).catch(() => undefined);
    await cleanupFixture(fixture);
  }
});

test.after(async () => {
  await pool.end();
});
