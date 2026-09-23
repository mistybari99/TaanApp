import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  GetMemberHistoryResponse,
  ListDrawsResponse,
} from "@workspace/api-zod";
import app from "./app";
import { businessDateInDhaka } from "./routes/fund";
import { pool } from "@workspace/db";

const prefix = `API-CONTRACT-${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const parseContract = (route: string, schema: { safeParse: (value: unknown) => any }, body: unknown) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: { path: Array<string | number>; message: string }) => `${issue.path.join(".") || "<response>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${route} response contract failed: ${issues}`);
  }
  return parsed.data;
};

test("fund member history and draw payout responses satisfy generated API contracts", async () => {
  const ownerToken = `${prefix}-owner-token`;
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let memberId = 0;
  let cycleId = 0;
  let drawId = 0;
  const businessDate = businessDateInDhaka();

  try {
    const owner = await pool.query(
      `INSERT INTO fund_users(name,username,password_hash,role)
       VALUES($1,$2,'synthetic','OWNER') RETURNING id`,
      [`${prefix} owner`, `${prefix}-owner`],
    );
    ownerId = Number(owner.rows[0].id);
    const member = await pool.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-member`, `${prefix} member`, `017${String(process.pid).padStart(8, "0")}`],
    );
    memberId = Number(member.rows[0].id);
    const cycle = await pool.query(
      `INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,daily_per_share,status,notes)
       VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE-7,CURRENT_DATE-1,100,'COMPLETED',$2)
       RETURNING id`,
      [`${prefix} cycle`, prefix],
    );
    cycleId = Number(cycle.rows[0].id);
    await pool.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1,$2,1,100)`,
      [cycleId, memberId],
    );
    await pool.query(
      `INSERT INTO fund_payments(
         receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,
         verification_status,status,previous_due_applied,current_period_applied,advance_credit
       ) VALUES($1,$2,$3,$5::date,1,100,$4,'VERIFIED','POSTED',0,100,0)`,
      [`${prefix}-receipt`, memberId, cycleId, ownerId, businessDate],
    );
    const draw = await pool.query(
      `INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
       VALUES($1,1,CURRENT_DATE-1,$2,100,'RECORDED',$3)
       RETURNING id`,
      [cycleId, memberId, prefix],
    );
    drawId = Number(draw.rows[0].id);
    await pool.query(
      `INSERT INTO fund_draw_disbursements(
         draw_id,cycle_id,payer_user_id,winner_member_id,amount,payout_date,reference,note,status,created_by
       ) VALUES($1,$2,$3,$4,100,CURRENT_DATE-1,$5,'Synthetic payout','PAID',$3)`,
      [drawId, cycleId, ownerId, memberId, `${prefix}-payout`],
    );
    await pool.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes')`,
      [hashToken(ownerToken), ownerId],
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string) => fetch(`${baseUrl}${path}`, {
      headers: { cookie: `irf_session=${ownerToken}` },
    });

    const historyResponse = await request(`/api/members/${memberId}/history`);
    assert.equal(historyResponse.status, 200, "GET /api/members/:id/history should succeed");
    const history = parseContract(
      "GET /api/members/:id/history",
      GetMemberHistoryResponse,
      await historyResponse.json(),
    ) as {
      member: { todayPaid: number; todayDue: number };
      payments: Array<{ memberId: string; memberName: string }>;
      draws: Array<{ payoutAttempts: Array<{ payerName: string }> }>;
    };
    assert.equal(history.member.todayPaid, 100);
    assert.equal(history.member.todayDue, 0);
    assert.equal(history.payments[0]?.memberId, `${prefix}-member`);
    assert.equal(history.payments[0]?.memberName, `${prefix} member`);
    assert.equal(history.draws[0]?.payoutAttempts[0]?.payerName, `${prefix} owner`);

    const drawsResponse = await request(`/api/draws?memberId=${memberId}`);
    assert.equal(drawsResponse.status, 200, "GET /api/draws should succeed");
    const draws = parseContract("GET /api/draws?memberId=:id", ListDrawsResponse, await drawsResponse.json()) as Array<{
      payoutAttempts: Array<{ payerName: string; amount: number; status: string }>;
    }>;
    assert.equal(draws[0]?.payoutAttempts[0]?.payerName, `${prefix} owner`);
    assert.equal(draws[0]?.payoutAttempts[0]?.amount, 100);
    assert.equal(draws[0]?.payoutAttempts[0]?.status, "PAID");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    if (drawId) await pool.query("DELETE FROM fund_draw_disbursements WHERE draw_id=$1", [drawId]);
    if (drawId) await pool.query("DELETE FROM fund_draws WHERE id=$1", [drawId]);
    if (memberId) await pool.query("DELETE FROM fund_payments WHERE member_id=$1", [memberId]);
    if (cycleId) await pool.query("DELETE FROM fund_cycle_members WHERE cycle_id=$1", [cycleId]);
    if (cycleId) await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    if (memberId) await pool.query("DELETE FROM fund_members WHERE id=$1", [memberId]);
    if (ownerId) await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
    if (ownerId) await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
  }
});

test.after(async () => {
  await pool.end();
});