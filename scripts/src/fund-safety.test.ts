import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";

test("financial ownership and status constraints reject unsafe future rows", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expectRejected = async (query: string, params: unknown[] = []) => {
      await client.query("SAVEPOINT expected_failure");
      await assert.rejects(client.query(query, params));
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    };
    const member = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES('SYN-TEST-OWNERSHIP','Synthetic safety member','01700000000','Test',1,100,CURRENT_DATE,'active')
       RETURNING id`,
    );
    const cycle = await client.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,daily_per_share,draw_frequency,draw_day,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),'Synthetic safety cycle',CURRENT_DATE,100,'WEEKLY','FRIDAY','COMPLETED','rollback test')
       RETURNING id`,
    );
    await client.query(
      "INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution) VALUES($1,$2,1,100)",
      [cycle.rows[0].id, member.rows[0].id],
    );

    await expectRejected(
        `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status)
         VALUES('SYN-NULL-CYCLE',$1,NULL,CURRENT_DATE,1,100,2,'TEST')`,
        [member.rows[0].id],
    );
    await expectRejected(
        `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status)
         VALUES('SYN-WRONG-CYCLE',$1,(SELECT id FROM fund_cycles WHERE cycle_number=1),CURRENT_DATE,1,100,2,'TEST')`,
        [member.rows[0].id],
    );
    await expectRejected(
        `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
         VALUES($1,999,CURRENT_DATE,$2,100,'UNSAFE','rollback test')`,
        [cycle.rows[0].id, member.rows[0].id],
    );

    const payment = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status)
       VALUES('SYN-REVERSAL-ORIGINAL',$1,$2,CURRENT_DATE,1,100,2,'TEST') RETURNING id`,
      [member.rows[0].id, cycle.rows[0].id],
    );
    await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,reversed_payment_id,correction_reason)
       VALUES('SYN-REVERSAL-1',$1,$2,CURRENT_DATE,1,100,2,'TEST','REVERSAL',$3,'test')`,
      [member.rows[0].id, cycle.rows[0].id, payment.rows[0].id],
    );
    await expectRejected(
        `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,status,reversed_payment_id,correction_reason)
         VALUES('SYN-REVERSAL-2',$1,$2,CURRENT_DATE,1,100,2,'TEST','REVERSAL',$3,'duplicate test')`,
        [member.rows[0].id, cycle.rows[0].id, payment.rows[0].id],
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
