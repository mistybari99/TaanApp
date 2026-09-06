import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

type Client = any;

type Fixtures = {
  prefix: string;
  ownerId: number;
  collectorId: number;
  cycleId: number;
  sourceId: number;
  receiverId: number;
  drawMemberId: number;
  originalPaymentId: number;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function lock(client: Client, scope: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scope]);
}

async function rollback(client: Client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The transaction may already have committed or rolled back.
  }
}

async function createFixtures(): Promise<Fixtures> {
  const prefix = `SYN-CONC-${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'test-hash','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    const collector = await client.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'test-hash','COLLECTOR') RETURNING id`,
      [`${prefix} collector`, `${prefix}-collector`],
    );
    const memberIds: number[] = [];
    for (const [suffix, shares] of [["SOURCE", 3], ["RECEIVER", 0], ["DRAW", 2]] as const) {
      const member = await client.query(
        `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
         VALUES($1,$2,$3,'synthetic', $4, $5, CURRENT_DATE, 'active') RETURNING id`,
        [`${prefix}-${suffix}`, `${prefix} ${suffix}`, `019${String(memberIds.length + 1).padStart(8, "0")}`, shares, Math.max(0, shares) * 100],
      );
      memberIds.push(member.rows[0].id);
    }
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,daily_per_share,draw_frequency,draw_day,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,100,'WEEKLY','FRIDAY','COMPLETED','${prefix}')
       RETURNING id`,
      [`${prefix} cycle`],
    );
    for (const [memberId, shares] of [[memberIds[0], 3], [memberIds[1], 0], [memberIds[2], 2]]) {
      await client.query(
        `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
         VALUES($1,$2,$3,$3 * 100)`,
        [cycle.rows[0].id, memberId, shares],
      );
    }
    const originalPayment = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,idempotency_key)
       VALUES($1,$2,$3,CURRENT_DATE,3,300,$4,'SYNTHETIC','POSTED',$5) RETURNING id`,
      [`${prefix}-ORIGINAL-PAYMENT`, memberIds[2], cycle.rows[0].id, collector.rows[0].id, `${prefix}-original-key`],
    );
    await client.query("COMMIT");
    return {
      prefix,
      ownerId: owner.rows[0].id,
      collectorId: collector.rows[0].id,
      cycleId: cycle.rows[0].id,
      sourceId: memberIds[0],
      receiverId: memberIds[1],
      drawMemberId: memberIds[2],
      originalPaymentId: originalPayment.rows[0].id,
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures(fixtures: Fixtures) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM fund_transfer_settlements
       WHERE transfer_id IN (SELECT id FROM fund_share_transfers WHERE transfer_id LIKE $1)`,
      [`${fixtures.prefix}%`],
    );
    await client.query("DELETE FROM fund_share_transfers WHERE transfer_id LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("DELETE FROM fund_settlements WHERE reference LIKE $1", [`${fixtures.prefix}%`]);
    await client.query(
      `DELETE FROM fund_payments
       WHERE receipt_id LIKE $1 OR member_id IN (
         SELECT id FROM fund_members WHERE member_id LIKE $2
       )`,
      [`${fixtures.prefix}%`, `${fixtures.prefix}%`],
    );
    await client.query("DELETE FROM fund_draws WHERE notes LIKE $1", [`${fixtures.prefix}%`]);
    await client.query(
      "DELETE FROM fund_cycle_members WHERE cycle_id IN (SELECT id FROM fund_cycles WHERE notes LIKE $1)",
      [`${fixtures.prefix}%`],
    );
    await client.query("DELETE FROM fund_cycles WHERE notes LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("DELETE FROM fund_members WHERE member_id LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("DELETE FROM fund_users WHERE username LIKE $1", [`${fixtures.prefix}%`]);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function runSameKeyReplay(
  scope: string,
  firstWork: (client: Client) => Promise<number>,
  secondWork: (client: Client) => Promise<number>,
) {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("BEGIN");
    await lock(first, scope);
    await second.query("BEGIN");
    const blockedLock = lock(second, scope);
    await sleep(20);
    const firstId = await firstWork(first);
    await first.query("COMMIT");
    await blockedLock;
    const secondId = await secondWork(second);
    await second.query("COMMIT");
    return { firstId, secondId };
  } catch (error) {
    await rollback(first);
    await rollback(second);
    throw error;
  } finally {
    first.release();
    second.release();
  }
}

test("concurrent payment retry, reversal retry, and collector settlement replay exactly once", async () => {
  const fixtures = await createFixtures();
  try {
    const paymentKey = `${fixtures.prefix}-PAYMENT`;
    const payment = await runSameKeyReplay(
      `payment:${fixtures.collectorId}:${paymentKey}`,
      async (client) => {
        const result = await client.query(
          `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,idempotency_key)
           VALUES($1,$2,$3,CURRENT_DATE,3,100,$4,'SYNTHETIC','POSTED',$5) RETURNING id`,
          [`${paymentKey}-receipt`, fixtures.sourceId, fixtures.cycleId, fixtures.collectorId, paymentKey],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query(
          "SELECT id FROM fund_payments WHERE collector_id=$1 AND idempotency_key=$2",
          [fixtures.collectorId, paymentKey],
        );
        return result.rows[0].id;
      },
    );
    assert.equal(payment.firstId, payment.secondId);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*) AS count FROM fund_payments WHERE id=$1", [payment.firstId])).rows[0].count),
      1,
    );

    const reversal = await runSameKeyReplay(
      `reversal:${fixtures.originalPaymentId}`,
      async (client) => {
        await client.query("UPDATE fund_payments SET status='REVERSED',correction_reason='synthetic concurrent reversal' WHERE id=$1", [fixtures.originalPaymentId]);
        const result = await client.query(
          `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,reversed_payment_id,correction_reason)
           SELECT $1,member_id,cycle_id,collection_date,shares,amount,collector_id,'OWNER REVERSAL','REVERSAL',id,'synthetic concurrent reversal'
           FROM fund_payments WHERE id=$2 RETURNING id`,
          [`${fixtures.prefix}-REVERSAL`, fixtures.originalPaymentId],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query("SELECT id FROM fund_payments WHERE reversed_payment_id=$1", [fixtures.originalPaymentId]);
        return result.rows[0].id;
      },
    );
    assert.equal(reversal.firstId, reversal.secondId);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*) AS count FROM fund_payments WHERE reversed_payment_id=$1", [fixtures.originalPaymentId])).rows[0].count),
      1,
    );

    const settlementKey = `${fixtures.prefix}-SETTLEMENT`;
    const settlement = await runSameKeyReplay(
      `settlement:${fixtures.collectorId}:${settlementKey}`,
      async (client) => {
        const result = await client.query(
          `INSERT INTO fund_settlements(collector_id,cycle_id,amount,reference,note,idempotency_key)
           VALUES($1,$2,300,$3,'synthetic',$4) RETURNING id`,
          [fixtures.collectorId, fixtures.cycleId, `${settlementKey}-reference`, settlementKey],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query(
          "SELECT id FROM fund_settlements WHERE collector_id=$1 AND idempotency_key=$2",
          [fixtures.collectorId, settlementKey],
        );
        return result.rows[0].id;
      },
    );
    assert.equal(settlement.firstId, settlement.secondId);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*) AS count FROM fund_settlements WHERE id=$1", [settlement.firstId])).rows[0].count),
      1,
    );
  } finally {
    await cleanupFixtures(fixtures);
  }
});

test("concurrent transfers serialize source shares and idempotent transfer retries replay", async () => {
  const fixtures = await createFixtures();
  try {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await lock(first, `share-transfer-cycle:${fixtures.cycleId}`);
      await second.query("BEGIN");
      const blockedLock = lock(second, `share-transfer-cycle:${fixtures.cycleId}`);
      await sleep(20);
      await first.query("UPDATE fund_cycle_members SET shares=shares-2,daily_contribution=(shares-2)*100 WHERE cycle_id=$1 AND member_id=$2", [fixtures.cycleId, fixtures.sourceId]);
      await first.query(
        `INSERT INTO fund_share_transfers(transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,created_by,idempotency_key)
         VALUES($1,$2,$3,$4,2,200,CURRENT_DATE,$5,$6)`,
        [`${fixtures.prefix}-TRANSFER-RACE-1`, fixtures.cycleId, fixtures.sourceId, fixtures.receiverId, fixtures.ownerId, `${fixtures.prefix}-TRANSFER-RACE-1`],
      );
      await first.query("COMMIT");
      await blockedLock;
      const remaining = Number((await second.query("SELECT shares FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2 FOR UPDATE", [fixtures.cycleId, fixtures.sourceId])).rows[0].shares);
      assert.equal(remaining, 1);
      assert.equal(remaining < 2, true);
      await second.query("COMMIT");
    } catch (error) {
      await rollback(first);
      await rollback(second);
      throw error;
    } finally {
      first.release();
      second.release();
    }

    const transferKey = `${fixtures.prefix}-TRANSFER-REPLAY`;
    const transfer = await runSameKeyReplay(
      `share-transfer:${fixtures.ownerId}:${transferKey}`,
      async (client) => {
        const result = await client.query(
          `INSERT INTO fund_share_transfers(transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,created_by,idempotency_key)
           VALUES($1,$2,$3,$4,1,100,CURRENT_DATE,$5,$6) RETURNING id`,
          [`${transferKey}-id`, fixtures.cycleId, fixtures.sourceId, fixtures.receiverId, fixtures.ownerId, transferKey],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query("SELECT id FROM fund_share_transfers WHERE created_by=$1 AND idempotency_key=$2", [fixtures.ownerId, transferKey]);
        return result.rows[0].id;
      },
    );
    assert.equal(transfer.firstId, transfer.secondId);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*) AS count FROM fund_share_transfers WHERE id=$1", [transfer.firstId])).rows[0].count),
      1,
    );
  } finally {
    await cleanupFixtures(fixtures);
  }
});

test("concurrent transfer settlement retry and draw creation remain unique and sequential", async () => {
  const fixtures = await createFixtures();
  try {
    const transfer = await pool.query(
      `INSERT INTO fund_share_transfers(transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,created_by,idempotency_key)
       VALUES($1,$2,$3,$4,1,100,CURRENT_DATE,$5,$6) RETURNING id`,
      [`${fixtures.prefix}-SETTLEMENT-TRANSFER`, fixtures.cycleId, fixtures.sourceId, fixtures.receiverId, fixtures.ownerId, `${fixtures.prefix}-SETTLEMENT-TRANSFER`],
    );
    const settlementKey = `${fixtures.prefix}-TRANSFER-SETTLEMENT`;
    const settlement = await runSameKeyReplay(
      `transfer-settlement:${fixtures.ownerId}:${settlementKey}`,
      async (client) => {
        const result = await client.query(
          `INSERT INTO fund_transfer_settlements(transfer_id,cycle_id,amount,status,approved_by,approved_at,notes,idempotency_key)
           VALUES($1,$2,100,'APPROVED',$3,now(),'synthetic',$4) RETURNING id`,
          [transfer.rows[0].id, fixtures.cycleId, fixtures.ownerId, settlementKey],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query(
          "SELECT id FROM fund_transfer_settlements WHERE approved_by=$1 AND idempotency_key=$2",
          [fixtures.ownerId, settlementKey],
        );
        return result.rows[0].id;
      },
    );
    assert.equal(settlement.firstId, settlement.secondId);
    assert.equal(
      Number((await pool.query("SELECT COUNT(*) AS count FROM fund_transfer_settlements WHERE transfer_id=$1", [transfer.rows[0].id])).rows[0].count),
      1,
    );

    const sameDrawKey = `${fixtures.prefix}-DRAW-REPLAY`;
    const draw = await runSameKeyReplay(
      `draw:${fixtures.cycleId}:${sameDrawKey}`,
      async (client) => {
        const next = await client.query("SELECT COALESCE(MAX(draw_number),0)+1 AS number FROM fund_draws WHERE cycle_id=$1", [fixtures.cycleId]);
        const result = await client.query(
          `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,idempotency_key)
           VALUES($1,$2,'2026-09-04',$3,300,'RECORDED',$4,$5) RETURNING id`,
          [fixtures.cycleId, Number(next.rows[0].number), fixtures.drawMemberId, fixtures.prefix, sameDrawKey],
        );
        return result.rows[0].id;
      },
      async (client) => {
        const result = await client.query("SELECT id FROM fund_draws WHERE cycle_id=$1 AND idempotency_key=$2", [fixtures.cycleId, sameDrawKey]);
        return result.rows[0].id;
      },
    );
    assert.equal(draw.firstId, draw.secondId);

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await lock(first, `draw-cycle:${fixtures.cycleId}`);
      await second.query("BEGIN");
      const blockedLock = lock(second, `draw-cycle:${fixtures.cycleId}`);
      await sleep(20);
      const firstNext = await first.query("SELECT COALESCE(MAX(draw_number),0)+1 AS number FROM fund_draws WHERE cycle_id=$1", [fixtures.cycleId]);
      await first.query(
        `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,idempotency_key)
         VALUES($1,$2,'2026-09-11',$3,300,'RECORDED',$4,$5)`,
        [fixtures.cycleId, Number(firstNext.rows[0].number), fixtures.drawMemberId, fixtures.prefix, `${fixtures.prefix}-DRAW-RACE-1`],
      );
      await first.query("COMMIT");
      await blockedLock;
      const secondNext = await second.query("SELECT COALESCE(MAX(draw_number),0)+1 AS number FROM fund_draws WHERE cycle_id=$1", [fixtures.cycleId]);
      await second.query(
        `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,idempotency_key)
         VALUES($1,$2,'2026-09-18',$3,300,'RECORDED',$4,$5)`,
        [fixtures.cycleId, Number(secondNext.rows[0].number), fixtures.drawMemberId, fixtures.prefix, `${fixtures.prefix}-DRAW-RACE-2`],
      );
      await second.query("COMMIT");
    } catch (error) {
      await rollback(first);
      await rollback(second);
      throw error;
    } finally {
      first.release();
      second.release();
    }
    const drawNumbers = await pool.query("SELECT draw_number FROM fund_draws WHERE notes=$1 ORDER BY draw_number", [fixtures.prefix]);
    assert.deepEqual(drawNumbers.rows.map((row) => Number(row.draw_number)), [1, 2, 3]);
  } finally {
    await cleanupFixtures(fixtures);
  }
});

test("financial ownership, status, reversal, and final cleanup constraints reject unsafe rows", async () => {
  const fixtures = await createFixtures();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const expectRejected = async (query: string, params: unknown[] = []) => {
        await client.query("SAVEPOINT expected_failure");
        await assert.rejects(client.query(query, params));
        await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      };
      await expectRejected(
        `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status)
         VALUES($1,$2,NULL,CURRENT_DATE,1,100,$3,'SYNTHETIC')`,
        [`${fixtures.prefix}-NULL-CYCLE`, fixtures.sourceId, fixtures.collectorId],
      );
      await expectRejected(
        `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
         VALUES($1,999,'2026-09-04',$2,100,'UNSAFE',$3)`,
        [fixtures.cycleId, fixtures.drawMemberId, fixtures.prefix],
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } finally {
    await cleanupFixtures(fixtures);
  }
});

test.after(async () => {
  await pool.end();
});