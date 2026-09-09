import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";

test("legacy TAN weekday constraints are removed while period identity constraints remain", async () => {
  const constraints = await pool.query(
    `SELECT conname,pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid='fund_tan_periods'::regclass
        AND conname IN ('fund_tan_periods_start_saturday_check','fund_tan_periods_end_friday_check')
      ORDER BY conname`,
  );
  assert.deepEqual(constraints.rows, []);

  const retained = await pool.query(
    `SELECT conname,pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid='fund_tan_periods'::regclass
        AND conname='fund_tan_periods_period_end_check'`,
  );
  assert.equal(retained.rows.length, 1);
  assert.match(retained.rows[0].definition, /period_end/);
  assert.match(retained.rows[0].definition, /period_start/);

  const drawDateIdentity = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid='fund_tan_periods'::regclass
        AND pg_get_constraintdef(oid) LIKE '%draw_date%period_end%'`,
  );
  assert.ok(drawDateIdentity.rows.length > 0);
});

test.after(async () => {
  await pool.end();
});