import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import app from "./app";
import { businessDateInDhaka } from "./routes/fund";
import { pool } from "@workspace/db";

const prefix = `SYN-REG-${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const todayInDhaka = () => businessDateInDhaka();

test("Dhaka business date changes at the local midnight boundary, not UTC midnight", () => {
  assert.equal(businessDateInDhaka(new Date("2026-09-11T17:59:59.999Z")), "2026-09-11");
  assert.equal(businessDateInDhaka(new Date("2026-09-11T18:00:00.000Z")), "2026-09-12");
});

test("collector can record any member payment while PIN verification remains rejected", async () => {
  const ownerToken = `${prefix}-owner-token`;
  const collectorToken = `${prefix}-collector-token`;
  const otherCollectorToken = `${prefix}-other-collector-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  let otherCollectorId = 0;
  let memberId = 0;
  let pinMemberId = 0;
  let cycleId = 0;
  let trackingStartDate: string | null = null;
  let ownsCycle = false;
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    ownerId = owner.rows[0].id;
    const collector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} collector`, `${prefix}-collector`],
    );
    collectorId = collector.rows[0].id;
    const otherCollector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} other collector`, `${prefix}-other-collector`],
    );
    otherCollectorId = otherCollector.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),
             ($3,$4,now()+interval '10 minutes'),
             ($5,$6,now()+interval '10 minutes')`,
      [
        hashToken(ownerToken), ownerId,
        hashToken(collectorToken), collectorId,
        hashToken(otherCollectorToken), otherCollectorId,
      ],
    );
    let cycle = await client.query(
      "SELECT id,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE status='ACTIVE' ORDER BY id LIMIT 1",
    );
    if (!cycle.rows[0]) {
      cycle = await client.query(
        `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,status,notes)
         VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,CURRENT_DATE,'ACTIVE',$2)
         RETURNING id,tracking_start_date::text AS tracking_start_date`,
        [`${prefix} authorization cycle`, prefix],
      );
      ownsCycle = true;
    }
    cycleId = Number(cycle.rows[0].id);
    trackingStartDate = cycle.rows[0].tracking_start_date;
    if (!trackingStartDate) {
      await client.query("UPDATE fund_cycles SET tracking_start_date=$2 WHERE id=$1", [cycleId, todayInDhaka()]);
    }
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status,assigned_collector_id)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active',$4) RETURNING id`,
      [`${prefix}-ASSIGNED`, `${prefix} assigned`, `016${String(process.pid).padStart(8, "0")}`, otherCollectorId],
    );
    memberId = member.rows[0].id;
    const pinMember = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status,assigned_collector_id)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active',$4) RETURNING id`,
      [`${prefix}-PIN`, `${prefix} pin`, `017${String(process.pid).padStart(8, "0")}`, collectorId],
    );
    pinMemberId = pinMember.rows[0].id;
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100),($1,$3,1,100)`,
      [cycleId, memberId, pinMemberId],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const payment = (token: string, body: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
        body: JSON.stringify({ cycleId, collectionDate: todayInDhaka(), ...body }),
      });

    const allowed = await payment(collectorToken, {
      memberId,
      amount: 100,
      verificationMethod: "COLLECTOR_CONFIRMATION",
    });
    assert.equal(allowed.status, 201);

    const pinRejected = await payment(collectorToken, {
      memberId: pinMemberId,
      amount: 100,
      verificationMethod: "PIN",
      confirmDuplicate: true,
    });
    assert.equal(pinRejected.status, 400);
    assert.deepEqual(await pinRejected.json(), { error: "PIN verification is not configured; use collector confirmation" });

    const persisted = await pool.query(
      "SELECT COUNT(*)::int AS count FROM fund_payments WHERE cycle_id=$1 AND member_id=ANY($2::int[])",
      [cycleId, [memberId, pinMemberId]],
    );
    assert.equal(Number(persisted.rows[0].count), 1);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId && !trackingStartDate) {
      await pool.query("UPDATE fund_cycles SET tracking_start_date=NULL WHERE id=$1", [cycleId]);
    }
    if (cycleId) await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1 AND member_id IN ($2,$3)", [cycleId, memberId, pinMemberId]);
    if (cycleId) await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1 AND member_id IN ($2,$3)", [cycleId, memberId, pinMemberId]);
    if (memberId || pinMemberId) await pool.query("DELETE FROM fund_members WHERE id=ANY($1::int[])", [[memberId, pinMemberId].filter(Boolean)]);
    if (ownsCycle) await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    if (ownerId) {
      await pool.query("DELETE FROM fund_audit WHERE actor_id=ANY($1::int[])", [[ownerId, collectorId, otherCollectorId]]);
      await pool.query("DELETE FROM fund_sessions WHERE user_id=ANY($1::int[])", [[ownerId, collectorId, otherCollectorId]]);
      await pool.query("DELETE FROM fund_users WHERE id=ANY($1::int[])", [[ownerId, collectorId, otherCollectorId]]);
    }
  }
});

test("collector settlement cannot exceed posted unsettled collections", async () => {
  const token = `${prefix}-settlement-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let collectorId = 0;
  let memberId = 0;
  let cycleId = 0;
  let trackingStartDate: string | null = null;
  let ownsCycle = false;
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} settlement owner`, `${prefix}-settlement-owner`],
    );
    ownerId = owner.rows[0].id;
    const collector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
      [`${prefix} settlement collector`, `${prefix}-settlement-collector`],
    );
    collectorId = collector.rows[0].id;
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(token), collectorId],
    );
    let cycle = await client.query(
      "SELECT id,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE status='ACTIVE' ORDER BY id LIMIT 1",
    );
    if (!cycle.rows[0]) {
      cycle = await client.query(
        `INSERT INTO fund_cycles(cycle_number,name,start_date,tracking_start_date,status,notes)
         VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,CURRENT_DATE,'ACTIVE',$2)
         RETURNING id,tracking_start_date::text AS tracking_start_date`,
        [`${prefix} settlement cycle`, prefix],
      );
      ownsCycle = true;
    }
    cycleId = Number(cycle.rows[0].id);
    trackingStartDate = cycle.rows[0].tracking_start_date;
    if (!trackingStartDate) {
      await client.query("UPDATE fund_cycles SET tracking_start_date=$2 WHERE id=$1", [cycleId, todayInDhaka()]);
    }
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-SETTLEMENT-MEMBER`, `${prefix} settlement member`, `018${String(process.pid).padStart(8, "0")}`],
    );
    memberId = member.rows[0].id;
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100)`,
      [cycleId, memberId],
    );
    await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status)
       VALUES($1,$2,$3,$4,1,100,$5,'SYNTHETIC','POSTED')`,
      [`${prefix}-PAYMENT`, memberId, cycleId, todayInDhaka(), collectorId],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/settlements`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
      body: JSON.stringify({ amount: 100.01, reference: `${prefix}-OVER-CAP` }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Settlement amount cannot exceed the collector's unsettled posted collections",
      availableAmount: 100,
    });
    const persisted = await pool.query("SELECT COUNT(*)::int AS count FROM fund_settlements WHERE reference=$1", [`${prefix}-OVER-CAP`]);
    assert.equal(Number(persisted.rows[0].count), 0);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (cycleId && !trackingStartDate) await pool.query("UPDATE fund_cycles SET tracking_start_date=NULL WHERE id=$1", [cycleId]);
    if (cycleId) {
      await pool.query("DELETE FROM fund_settlements WHERE cycle_id=$1 AND reference LIKE $2", [cycleId, `${prefix}%`]);
      await pool.query("DELETE FROM fund_payments WHERE cycle_id=$1 AND receipt_id LIKE $2", [cycleId, `${prefix}%`]);
      await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2", [cycleId, memberId]);
    }
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    if (ownsCycle) await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    if (collectorId) {
      await pool.query("DELETE FROM fund_sessions WHERE user_id IN ($1,$2)", [ownerId, collectorId]);
      await pool.query("DELETE FROM fund_users WHERE id IN ($1,$2)", [ownerId, collectorId]);
    }
  }
});

test.after(async () => {
  await pool.end();
});