import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `CASH-CUSTODY-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,CURRENT_DATE,100,'WEEKLY','FRIDAY','ACTIVE',$2)
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
  await pool.query("DELETE FROM fund_cash_handovers WHERE cycle_id=$1", [fixture.cycleId]);
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

    const collectorPayment = await request(baseUrl, "/api/payments", fixture.collectorToken, {
      memberId: fixture.memberId,
      cycleId: fixture.cycleId,
      amount: 100,
      verificationMethod: "COLLECTOR_CONFIRMATION",
      confirmDuplicate: true,
      idempotencyKey: `${prefix}-collector-payment`,
    });
    assert.equal(collectorPayment.status, 201);

    const handoverPayload = {
      toUserId: fixture.receiverId,
      amount: 100,
      collectionDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date()),
      reference: `${prefix}-collector-to-receiver`,
      receiptCount: 1,
      idempotencyKey: `${prefix}-handover-1`,
    };
    const submitted = await request(baseUrl, "/api/cash-handovers", fixture.collectorToken, handoverPayload);
    assert.equal(submitted.status, 201);
    const submittedBody = await submitted.json() as { id: number; status: string };
    assert.equal(submittedBody.status, "SUBMITTED");

    const wrongRole = await request(baseUrl, `/api/cash-handovers/${submittedBody.id}/accept`, fixture.collectorToken, { countedAmount: 100 });
    assert.equal(wrongRole.status, 403);

    const accepted = await request(baseUrl, `/api/cash-handovers/${submittedBody.id}/accept`, fixture.receiverToken, { countedAmount: 100 });
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json() as { status: string };
    assert.equal(acceptedBody.status, "ACCEPTED");

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

    const replay = await request(baseUrl, "/api/cash-handovers", fixture.collectorToken, handoverPayload);
    assert.equal(replay.status, 200);
    const replayBody = await replay.json() as { id: number };
    assert.equal(replayBody.id, submittedBody.id);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    await cleanupFixture(fixture);
  }
});

test.after(async () => {
  await pool.end();
});