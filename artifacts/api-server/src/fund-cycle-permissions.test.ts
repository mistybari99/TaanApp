import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { businessDateInDhaka } from "./routes/fund";
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
  let firstPaymentId = 0;
  let secondPaymentId = 0;
  let firstPayoutId = 0;

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
    const payments = await pool.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status)
       VALUES($1,$3,$4,CURRENT_DATE,1,100,$2,'SYNTHETIC','POSTED'),
             ($5,$3,$6,CURRENT_DATE,1,100,$2,'SYNTHETIC','POSTED')
       RETURNING id,cycle_id`,
      [`${prefix}-first-payment`, collectorId, memberId, firstCycleId, `${prefix}-second-payment`, secondCycleId],
    );
    firstPaymentId = Number(payments.rows.find((row) => Number(row.cycle_id) === firstCycleId)?.id);
    secondPaymentId = Number(payments.rows.find((row) => Number(row.cycle_id) === secondCycleId)?.id);
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

    const approvalGrant = await post("/api/permissions", ownerToken, {
      userId: collectorId,
      permission: "PAYOUT_APPROVAL",
      cycleId: firstCycleId,
      note: "Synthetic cycle-only payout approval",
    });
    assert.equal(approvalGrant.status, 201);
    const approvalGrantId = Number((await approvalGrant.json() as { id: number }).id);

    const payoutDate = new Date().toISOString().slice(0, 10);
    const inScopePayout = await post(`/api/draws/${firstDrawId}/disbursement`, collectorToken, {
      cycleId: firstCycleId,
      payerUserId: collectorId,
      amount: 100,
      payoutDate,
      reference: `${prefix}-first-payout`,
    });
    assert.equal(inScopePayout.status, 201);
    await pool.query("UPDATE fund_user_permissions SET expires_at=now()-interval '1 minute' WHERE id=$1", [approvalGrantId]);
    const expiredApproval = await post(`/api/draws/${firstDrawId}/disbursement`, collectorToken, {
      payerUserId: collectorId,
      amount: 100,
      payoutDate,
      reference: `${prefix}-expired-approval`,
    });
    assert.equal(expiredApproval.status, 403);
    await pool.query("UPDATE fund_user_permissions SET expires_at=NULL WHERE id=$1", [approvalGrantId]);
    const revokeApproval = await post(`/api/permissions/${approvalGrantId}/revoke`, ownerToken, {
      reason: "Synthetic payout approval grant revoked",
    });
    assert.equal(revokeApproval.status, 200);
    const revokedApproval = await post(`/api/draws/${firstDrawId}/disbursement`, collectorToken, {
      payerUserId: collectorId,
      amount: 100,
      payoutDate,
      reference: `${prefix}-revoked-approval`,
    });
    assert.equal(revokedApproval.status, 403);

    const crossCyclePayout = await post(`/api/draws/${secondDrawId}/disbursement`, collectorToken, {
      payerUserId: collectorId,
      amount: 100,
      payoutDate,
      reference: `${prefix}-second-payout`,
    });
    assert.equal(crossCyclePayout.status, 403);

    const spoofedCycle = await post(`/api/draws/${secondDrawId}/disbursement`, collectorToken, {
      cycleId: firstCycleId,
      payerUserId: collectorId,
      amount: 100,
      payoutDate,
      reference: `${prefix}-spoofed-payout`,
    });
    assert.equal(spoofedCycle.status, 400);
    assert.deepEqual(await spoofedCycle.json(), {
      error: "Request cycle does not match the financial record's cycle",
    });

    firstPayoutId = Number((await pool.query(
      "SELECT id FROM fund_draw_disbursements WHERE draw_id=$1 AND status='PAID'",
      [firstDrawId],
    )).rows[0]?.id);
    await pool.query(
      `INSERT INTO fund_draw_disbursements(draw_id,cycle_id,payer_user_id,winner_member_id,amount,payout_date,reference,status,created_by)
       VALUES($1,$2,$3,$4,100,$5,$6,'PAID',$7)`,
      [secondDrawId, secondCycleId, collectorId, memberId, payoutDate, `${prefix}-second-payout`, ownerId],
    );

    const payoutReversalGrant = await post("/api/permissions", ownerToken, {
      userId: collectorId,
      permission: "PAYOUT_REVERSAL",
      cycleId: firstCycleId,
      note: "Synthetic cycle-only payout reversal",
    });
    assert.equal(payoutReversalGrant.status, 201);
    const payoutReversalGrantId = Number((await payoutReversalGrant.json() as { id: number }).id);

    const inScopePayoutReversal = await post(`/api/draw-disbursements/${firstPayoutId}/reverse`, collectorToken, {
      reason: "Synthetic in-scope payout reversal",
    });
    assert.equal(inScopePayoutReversal.status, 200);
    await pool.query("UPDATE fund_user_permissions SET expires_at=now()-interval '1 minute' WHERE id=$1", [payoutReversalGrantId]);
    const expiredPayoutReversal = await post(`/api/draw-disbursements/${firstPayoutId}/reverse`, collectorToken, {
      reason: "Expired grant must remain denied",
    });
    assert.equal(expiredPayoutReversal.status, 403);
    await pool.query("UPDATE fund_user_permissions SET expires_at=NULL WHERE id=$1", [payoutReversalGrantId]);
    const revokePayoutReversal = await post(`/api/permissions/${payoutReversalGrantId}/revoke`, ownerToken, {
      reason: "Synthetic payout reversal grant revoked",
    });
    assert.equal(revokePayoutReversal.status, 200);
    const revokedPayoutReversal = await post(`/api/draw-disbursements/${firstPayoutId}/reverse`, collectorToken, {
      reason: "Revoked grant must remain denied",
    });
    assert.equal(revokedPayoutReversal.status, 403);

    const secondPayoutId = Number((await pool.query(
      "SELECT id FROM fund_draw_disbursements WHERE draw_id=$1 AND status='PAID'",
      [secondDrawId],
    )).rows[0]?.id);
    const crossCyclePayoutReversal = await post(`/api/draw-disbursements/${secondPayoutId}/reverse`, collectorToken, {
      reason: "Must remain denied",
    });
    assert.equal(crossCyclePayoutReversal.status, 403);

    await pool.query(
      `INSERT INTO fund_user_permissions(user_id,permission,cycle_id,expires_at,granted_by,note)
       VALUES($1,'DRAW_DATE_CORRECTION',$2,now()-interval '1 minute',$3,'Expired synthetic cycle grant')`,
      [collectorId, firstCycleId, ownerId],
    );
    const expiredCycleGrant = await post(`/api/draws/${firstDrawId}/move-date`, collectorToken, {
      drawDate: payoutDate,
      reason: "Expired grant must remain denied",
    });
    assert.equal(expiredCycleGrant.status, 403);

    const paymentReversalGrant = await post("/api/permissions", ownerToken, {
      userId: collectorId,
      permission: "PAYMENT_REVERSAL",
      cycleId: firstCycleId,
      note: "Synthetic cycle-only payment reversal",
    });
    assert.equal(paymentReversalGrant.status, 201);

    const inScopePaymentReversal = await post(`/api/payments/${firstPaymentId}/reverse`, collectorToken, {
      reason: "Synthetic in-scope payment reversal",
    });
    assert.equal(inScopePaymentReversal.status, 200);

    const crossCyclePaymentReversal = await post(`/api/payments/${secondPaymentId}/reverse`, collectorToken, {
      reason: "Must remain denied",
    });
    assert.equal(crossCyclePaymentReversal.status, 403);

    const paymentGrant = await paymentReversalGrant.json() as { id: number };
    await pool.query("UPDATE fund_user_permissions SET expires_at=now()-interval '1 minute' WHERE id=$1", [paymentGrant.id]);
    const expiredPaymentReversal = await post(`/api/payments/${firstPaymentId}/reverse`, collectorToken, {
      reason: "Expired grant must remain denied",
    });
    assert.equal(expiredPaymentReversal.status, 403);
    await pool.query("UPDATE fund_user_permissions SET expires_at=NULL WHERE id=$1", [paymentGrant.id]);
    const revokeResponse = await post(`/api/permissions/${paymentGrant.id}/revoke`, ownerToken, {
      reason: "Synthetic cycle grant revoked",
    });
    assert.equal(revokeResponse.status, 200);
    assert.equal((await revokeResponse.json() as { status: string }).status, "REVOKED");

    const revokedCycleGrant = await post(`/api/payments/${firstPaymentId}/reverse`, collectorToken, {
      reason: "Revoked grant must remain denied",
    });
    assert.equal(revokedCycleGrant.status, 403);

    const ownerOnlyChecks = await Promise.all([
      post(`/api/cycles/${firstCycleId}/tan/pause`, collectorToken, { reason: "Delegated staff must not pause TAN" }),
      post("/api/cycles", collectorToken, { name: "Delegated staff must not create cycles" }),
      post("/api/share-transfers", collectorToken, { cycleId: firstCycleId, fromMemberId: memberId, toMemberId: memberId, quantity: 1 }),
      post("/api/collectors", collectorToken, { name: "Delegated staff must not manage users" }),
    ]);
    assert.deepEqual(ownerOnlyChecks.map((response) => response.status), [403, 403, 403, 403]);
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
      await pool.query("DELETE FROM fund_draw_disbursements WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_draws WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_payments WHERE reversed_payment_id IN (SELECT id FROM fund_payments WHERE cycle_id=ANY($1::int[]))", [cycleIds]);
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycles WHERE id=ANY($1::int[])", [cycleIds]);
    }
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
  }
});

test("advance allocation and financial correction remain cycle-scoped after expiry or revocation", async () => {
  const ownerToken = `${prefix}-actions-owner-token`;
  const collectorToken = `${prefix}-actions-collector-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  let sourceMemberId = 0;
  let receiverMemberId = 0;
  let firstCycleId = 0;
  let secondCycleId = 0;
  let firstTransferId = 0;
  let secondTransferId = 0;
  let previousActiveCycleId = 0;

  try {
    const previousActive = await pool.query("UPDATE fund_cycles SET status='COMPLETED' WHERE status='ACTIVE' RETURNING id");
    previousActiveCycleId = Number(previousActive.rows[0]?.id ?? 0);
    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} actions owner`, `${prefix}-actions-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const collector = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} actions collector`, `${prefix}-actions-collector`],
    );
    collectorId = Number(collector.rows[0].id);
    const members = await pool.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES
         ($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active'),
         ($4,$5,$6,'synthetic',1,100,CURRENT_DATE,'active')
       RETURNING id,member_id`,
      [
        `${prefix}-actions-source`, `${prefix} actions source`, `017${String(process.pid).padStart(8, "0")}`,
        `${prefix}-actions-receiver`, `${prefix} actions receiver`, `016${String(process.pid).padStart(8, "0")}`,
      ],
    );
    sourceMemberId = Number(members.rows.find((row) => row.member_id === `${prefix}-actions-source`)?.id);
    receiverMemberId = Number(members.rows.find((row) => row.member_id === `${prefix}-actions-receiver`)?.id);
    const cycles = await pool.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,end_date,daily_per_share,status,notes)
       VALUES
         ((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,CURRENT_DATE,NULL,100,'ACTIVE',$3),
         ((SELECT COALESCE(MAX(cycle_number),0)+2 FROM fund_cycles),$2,CURRENT_DATE,CURRENT_DATE,CURRENT_DATE+1,100,'COMPLETED',$3)
       RETURNING id,name`,
      [`${prefix} actions active`, `${prefix} actions completed`, prefix],
    );
    firstCycleId = Number(cycles.rows.find((row) => row.name === `${prefix} actions active`)?.id);
    secondCycleId = Number(cycles.rows.find((row) => row.name === `${prefix} actions completed`)?.id);
    await pool.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES
         ($1,$2,1,100),($1,$3,1,100),
         ($4,$2,1,100),($4,$3,1,100)`,
      [firstCycleId, sourceMemberId, receiverMemberId, secondCycleId],
    );
    const transfers = await pool.query(
      `INSERT INTO fund_share_transfers
         (transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,notes,created_by)
       VALUES
         ($1,$3,$5,$6,1,100,CURRENT_DATE,'Synthetic active transfer',$2),
         ($4,$7,$5,$6,1,100,CURRENT_DATE,'Synthetic completed transfer',$2)
       RETURNING id,cycle_id`,
      [
        `${prefix}-actions-active-transfer`, ownerId, firstCycleId,
        `${prefix}-actions-completed-transfer`, sourceMemberId, receiverMemberId, secondCycleId,
      ],
    );
    firstTransferId = Number(transfers.rows.find((row) => Number(row.cycle_id) === firstCycleId)?.id);
    secondTransferId = Number(transfers.rows.find((row) => Number(row.cycle_id) === secondCycleId)?.id);
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
    const grant = async (permission: string) => {
      const response = await post("/api/permissions", ownerToken, {
        userId: collectorId,
        permission,
        cycleId: firstCycleId,
        note: `Synthetic cycle-only ${permission}`,
      });
      assert.equal(response.status, 201);
      return Number((await response.json() as { id: number }).id);
    };
    const setExpired = (id: number) => pool.query(
      "UPDATE fund_user_permissions SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [id],
    );
    const restoreExpiry = (id: number) => pool.query(
      "UPDATE fund_user_permissions SET expires_at=NULL WHERE id=$1",
      [id],
    );
    const revoke = async (id: number, reason: string) => {
      const response = await post(`/api/permissions/${id}/revoke`, ownerToken, { reason });
      assert.equal(response.status, 200);
    };

    const advanceGrantId = await grant("ADVANCE_ALLOCATION");
    const dueDate = businessDateInDhaka();
    const activeAdvance = await post("/api/due-entries", collectorToken, {
      cycleId: firstCycleId,
      memberId: sourceMemberId,
      amount: 25,
      dueDate,
      reason: "Synthetic delegated advance allocation",
    });
    assert.equal(activeAdvance.status, 201);
    const crossCycleAdvance = await post("/api/due-entries", collectorToken, {
      cycleId: secondCycleId,
      memberId: sourceMemberId,
      amount: 25,
      dueDate,
      reason: "Cross-cycle advance must remain denied",
    });
    assert.equal(crossCycleAdvance.status, 403);
    await setExpired(advanceGrantId);
    const expiredAdvance = await post("/api/due-entries", collectorToken, {
      cycleId: firstCycleId,
      memberId: sourceMemberId,
      amount: 25,
      dueDate,
      reason: "Expired advance grant must remain denied",
    });
    assert.equal(expiredAdvance.status, 403);
    await restoreExpiry(advanceGrantId);
    await revoke(advanceGrantId, "Synthetic advance grant revoked");
    const revokedAdvance = await post("/api/due-entries", collectorToken, {
      cycleId: firstCycleId,
      memberId: sourceMemberId,
      amount: 25,
      dueDate,
      reason: "Revoked advance grant must remain denied",
    });
    assert.equal(revokedAdvance.status, 403);

    const correctionGrantId = await grant("FINANCIAL_CORRECTION");
    const activeCorrection = await post(`/api/share-transfers/${firstTransferId}/settlement`, collectorToken, {
      amount: 50,
      notes: "Synthetic delegated financial correction",
    });
    assert.equal(activeCorrection.status, 201);
    const crossCycleCorrection = await post(`/api/share-transfers/${secondTransferId}/settlement`, collectorToken, {
      amount: 50,
      notes: "Cross-cycle correction must remain denied",
    });
    assert.equal(crossCycleCorrection.status, 403);
    await setExpired(correctionGrantId);
    const expiredCorrection = await post(`/api/share-transfers/${firstTransferId}/settlement`, collectorToken, {
      amount: 25,
      notes: "Expired correction grant must remain denied",
    });
    assert.equal(expiredCorrection.status, 403);
    await restoreExpiry(correctionGrantId);
    await revoke(correctionGrantId, "Synthetic correction grant revoked");
    const revokedCorrection = await post(`/api/share-transfers/${firstTransferId}/settlement`, collectorToken, {
      amount: 25,
      notes: "Revoked correction grant must remain denied",
    });
    assert.equal(revokedCorrection.status, 403);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_user_permissions WHERE user_id=ANY($1::int[]) OR granted_by=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (firstCycleId || secondCycleId) {
      const cycleIds = [firstCycleId, secondCycleId].filter(Boolean);
      await pool.query("DELETE FROM fund_transfer_settlements WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_share_transfers WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_due_entries WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_audit WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=ANY($1::int[])", [cycleIds]);
      await pool.query("DELETE FROM fund_cycles WHERE id=ANY($1::int[])", [cycleIds]);
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (sourceMemberId || receiverMemberId) {
      await pool.query("DELETE FROM fund_members WHERE id=ANY($1::int[])", [[sourceMemberId, receiverMemberId].filter(Boolean)]);
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (previousActiveCycleId) {
      await pool.query("UPDATE fund_cycles SET status='ACTIVE' WHERE id=$1", [previousActiveCycleId]);
    }
  }
});

test("deactivated collectors cannot use otherwise-active delegated financial grants", async () => {
  const ownerToken = `${prefix}-inactive-owner-token`;
  const collectorToken = `${prefix}-inactive-collector-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  let sourceMemberId = 0;
  let receiverMemberId = 0;
  let cycleId = 0;
  let paymentId = 0;
  let drawId = 0;
  let transferId = 0;
  let previousActiveCycleIds: number[] = [];

  try {
    const previousActive = await pool.query("UPDATE fund_cycles SET status='COMPLETED' WHERE status='ACTIVE' RETURNING id");
    previousActiveCycleIds = previousActive.rows.map((row) => Number(row.id));

    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} inactive owner`, `${prefix}-inactive-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const collector = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} inactive collector`, `${prefix}-inactive-collector`],
    );
    collectorId = Number(collector.rows[0].id);
    const members = await pool.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES
         ($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active'),
         ($4,$5,$6,'synthetic',1,100,CURRENT_DATE,'active')
       RETURNING id,member_id`,
      [
        `${prefix}-inactive-source`, `${prefix} inactive source`, `015${String(process.pid).padStart(8, "0")}`,
        `${prefix}-inactive-receiver`, `${prefix} inactive receiver`, `014${String(process.pid).padStart(8, "0")}`,
      ],
    );
    sourceMemberId = Number(members.rows.find((row) => row.member_id === `${prefix}-inactive-source`)?.id);
    receiverMemberId = Number(members.rows.find((row) => row.member_id === `${prefix}-inactive-receiver`)?.id);

    const cycle = await pool.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,daily_per_share,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,CURRENT_DATE,100,'ACTIVE',$2)
       RETURNING id`,
      [`${prefix} inactive cycle`, prefix],
    );
    cycleId = Number(cycle.rows[0].id);
    await pool.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100),($1,$3,1,100)`,
      [cycleId, sourceMemberId, receiverMemberId],
    );
    const payment = await pool.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status)
       VALUES($1,$2,$3,CURRENT_DATE,1,100,$4,'SYNTHETIC','POSTED')
       RETURNING id`,
      [`${prefix}-inactive-payment`, sourceMemberId, cycleId, collectorId],
    );
    paymentId = Number(payment.rows[0].id);
    const draw = await pool.query(
      `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
       VALUES($1,1,CURRENT_DATE,$2,100,'RECORDED',$3)
       RETURNING id`,
      [cycleId, sourceMemberId, prefix],
    );
    drawId = Number(draw.rows[0].id);
    const transfer = await pool.query(
      `INSERT INTO fund_share_transfers
         (transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,notes,created_by)
       VALUES($1,$2,$3,$4,1,100,CURRENT_DATE,'Synthetic inactive collector transfer',$5)
       RETURNING id`,
      [`${prefix}-inactive-transfer`, cycleId, sourceMemberId, receiverMemberId, ownerId],
    );
    transferId = Number(transfer.rows[0].id);
    await pool.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), ownerId, hashToken(collectorToken), collectorId],
    );
    await pool.query(
      `INSERT INTO fund_user_permissions(user_id,permission,cycle_id,granted_by,note)
       VALUES
         ($1,'PAYMENT_REVERSAL',$2,$3,'Active grant for deactivation regression'),
         ($1,'PAYOUT_APPROVAL',$2,$3,'Active grant for deactivation regression'),
         ($1,'ADVANCE_ALLOCATION',$2,$3,'Active grant for deactivation regression'),
         ($1,'FINANCIAL_CORRECTION',$2,$3,'Active grant for deactivation regression')`,
      [collectorId, cycleId, ownerId],
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${collectorToken}` },
      body: JSON.stringify(body),
    });

    await pool.query("UPDATE fund_users SET active=false WHERE id=$1", [collectorId]);
    const payoutDate = businessDateInDhaka();
    const deniedResponses = await Promise.all([
      post(`/api/payments/${paymentId}/reverse`, { reason: "Inactive collector must remain denied" }),
      post(`/api/draws/${drawId}/disbursement`, {
        payerUserId: collectorId,
        amount: 100,
        payoutDate,
        reference: `${prefix}-inactive-payout`,
      }),
      post("/api/due-entries", {
        cycleId,
        memberId: sourceMemberId,
        amount: 25,
        dueDate: payoutDate,
        reason: "Inactive collector must remain denied",
      }),
      post(`/api/share-transfers/${transferId}/settlement`, {
        amount: 50,
        notes: "Inactive collector must remain denied",
      }),
    ]);
    for (const response of deniedResponses) {
      assert.ok(response.status === 401 || response.status === 403);
    }

    const unchanged = await Promise.all([
      pool.query("SELECT status FROM fund_payments WHERE id=$1", [paymentId]),
      pool.query("SELECT COUNT(*)::int AS count FROM fund_payments WHERE reversed_payment_id=$1", [paymentId]),
      pool.query("SELECT COUNT(*)::int AS count FROM fund_draw_disbursements WHERE draw_id=$1", [drawId]),
      pool.query("SELECT COUNT(*)::int AS count FROM fund_due_entries WHERE cycle_id=$1 AND member_id=$2", [cycleId, sourceMemberId]),
      pool.query("SELECT COUNT(*)::int AS count FROM fund_transfer_settlements WHERE transfer_id=$1", [transferId]),
    ]);
    assert.equal(unchanged[0].rows[0].status, "POSTED");
    assert.deepEqual(unchanged.slice(1).map((result) => Number(result.rows[0].count)), [0, 0, 0, 0]);

    await pool.query("UPDATE fund_users SET active=true WHERE id=$1", [collectorId]);
    const restoredSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `irf_session=${collectorToken}` },
    });
    assert.equal(restoredSession.status, 200);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (collectorId) await pool.query("UPDATE fund_users SET active=true WHERE id=$1", [collectorId]);
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_user_permissions WHERE user_id=ANY($1::int[]) OR granted_by=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (cycleId) {
      await pool.query("DELETE FROM fund_transfer_settlements WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_share_transfers WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_due_entries WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_draw_disbursements WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_draws WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_payments WHERE reversed_payment_id IN (SELECT id FROM fund_payments WHERE cycle_id=$1)", [cycleId]);
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_audit WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [cycleId]);
      await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (sourceMemberId || receiverMemberId) {
      await pool.query("DELETE FROM fund_members WHERE id=ANY($1::int[])", [[sourceMemberId, receiverMemberId].filter(Boolean)]);
    }
    if (ownerId || collectorId) {
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId].filter(Boolean)]);
    }
    if (previousActiveCycleIds.length > 0) {
      await pool.query("UPDATE fund_cycles SET status='ACTIVE' WHERE id=ANY($1::int[])", [previousActiveCycleIds]);
    }
  }
});

test("delegated staff cannot administer audit records or business settings", async () => {
  const ownerToken = `${prefix}-admin-owner-token`;
  const collectorToken = `${prefix}-admin-collector-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;

  try {
    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} admin owner`, `${prefix}-admin-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const collector = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} admin collector`, `${prefix}-admin-collector`],
    );
    collectorId = Number(collector.rows[0].id);
    await pool.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), ownerId, hashToken(collectorToken), collectorId],
    );
    await pool.query(
      `INSERT INTO fund_user_permissions(user_id,permission,granted_by,note)
       VALUES($1,'FULL_ACCESS',$2,'Active operational grant for owner-only administration regression')`,
      [collectorId, ownerId],
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, token: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        cookie: `irf_session=${token}`,
      },
    });

    const settingsBefore = await pool.query("SELECT * FROM fund_settings WHERE id=1");
    const auditBefore = await pool.query("SELECT COUNT(*)::int AS count FROM fund_audit");
    const deniedAudit = await request("/api/audit", collectorToken);
    const deniedSettings = await request("/api/settings", collectorToken, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: `${prefix} unauthorized organization`,
        expectedMembers: 999999,
        defaultDailyPerShare: 999999,
      }),
    });

    assert.equal(deniedAudit.status, 403);
    assert.equal(deniedSettings.status, 403);
    assert.deepEqual((await pool.query("SELECT * FROM fund_settings WHERE id=1")).rows, settingsBefore.rows);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*)::int AS count FROM fund_audit")).rows[0].count),
      Number(auditBefore.rows[0].count),
    );

    const ownerAudit = await request("/api/audit", ownerToken);
    assert.equal(ownerAudit.status, 200);
    assert.ok(Array.isArray(await ownerAudit.json()));

    const currentSettings = settingsBefore.rows[0];
    const ownerSettings = await request("/api/settings", ownerToken, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: currentSettings.organization_name,
        expectedMembers: currentSettings.expected_members,
        defaultDailyPerShare: Number(currentSettings.default_daily_per_share),
      }),
    });
    assert.equal(ownerSettings.status, 200);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (ownerId || collectorId) {
      const userIds = [ownerId, collectorId].filter(Boolean);
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [userIds]);
      await pool.query("DELETE FROM fund_user_permissions WHERE user_id=ANY($1::int[]) OR granted_by=ANY($1::int[])", [userIds]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [userIds]);
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [userIds]);
    }
  }
});

test.after(async () => {
  await pool.end();
});