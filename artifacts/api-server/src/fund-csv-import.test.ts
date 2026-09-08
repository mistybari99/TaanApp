import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-CSV-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
type ImportPreview = {
  valid: number;
  imported: number;
  errors: Array<{ row: number; message: string }>;
  previewToken: string;
  previewRows: Array<{
    mobileStatus: "provided" | "missing";
    existingMember: { memberId: string } | null;
  }>;
};

test("CSV import accepts missing mobile while preserving member and validation safeguards", async () => {
  const token = `${prefix}-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
  let missingMobileId = 0;
  let duplicateMobileId = 0;
  let ambiguousFirstId = 0;
  let ambiguousSecondId = 0;
  let cycleId = 0;
  let ownsCycle = false;
  let baseUrl = "";

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
    const missingMobile = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,NULL,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-MISSING`, `${prefix} missing mobile`],
    );
    missingMobileId = missingMobile.rows[0].id;
    const duplicateMobile = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,$3,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-DUPLICATE`, `${prefix} duplicate mobile`, `018${String(process.pid).padStart(8, "0")}`],
    );
    duplicateMobileId = duplicateMobile.rows[0].id;
    const ambiguousFirst = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,NULL,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-AMB-1`, `${prefix} ambiguous`],
    );
    ambiguousFirstId = ambiguousFirst.rows[0].id;
    const ambiguousSecond = await client.query(
      `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
       VALUES($1,$2,NULL,'synthetic',1,100,CURRENT_DATE,'active') RETURNING id`,
      [`${prefix}-AMB-2`, `${prefix} ambiguous`],
    );
    ambiguousSecondId = ambiguousSecond.rows[0].id;
    await client.query("COMMIT");

    let activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY cycle_number LIMIT 1");
    if (!activeCycle.rows[0]) {
      activeCycle = await pool.query(
        `INSERT INTO fund_cycles(cycle_number,name,start_date,status,notes)
         VALUES((SELECT COALESCE(MAX(cycle_number),0)+1 FROM fund_cycles),$1,CURRENT_DATE,'ACTIVE',$2)
         RETURNING id`,
        [`${prefix} import cycle`, prefix],
      );
      ownsCycle = true;
    }
    cycleId = Number(activeCycle.rows[0].id);

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const request = (body: unknown, path = "/api/members/import", method = "POST") =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", cookie: `irf_session=${token}` },
        body: JSON.stringify(body),
      });

    const newMemberRows = [{ name: `${prefix} new no mobile`, shares: 2 }];
    const newPreviewResponse = await request({ dryRun: true, cycleId, rows: newMemberRows });
    assert.equal(newPreviewResponse.status, 200);
    const newPreview = await newPreviewResponse.json() as ImportPreview;
    assert.deepEqual(newPreview.errors, []);
    assert.equal(newPreview.valid, 1);
    assert.equal(newPreview.previewRows[0].mobileStatus, "missing");
    assert.equal(newPreview.previewRows[0].existingMember, null);

    const reviewRequiredResponse = await request({
      dryRun: false,
      cycleId,
      rows: newMemberRows,
      previewToken: newPreview.previewToken,
    });
    assert.equal(reviewRequiredResponse.status, 409);
    assert.match((await reviewRequiredResponse.json() as { error: string }).error, /explicitly approve/);

    const newCommitResponse = await request({
      dryRun: false,
      cycleId,
      rows: newMemberRows,
      confirmImport: true,
      previewToken: newPreview.previewToken,
    });
    assert.equal(newCommitResponse.status, 200);
    assert.equal((await newCommitResponse.json() as { imported: number }).imported, 1);

    const raceRows = [
      { name: `${prefix} race one`, shares: 1 },
      { name: `${prefix} race two`, shares: 1 },
    ];
    const racePreviewResponse = await request({ dryRun: true, cycleId, rows: raceRows });
    assert.equal(racePreviewResponse.status, 200);
    const racePreview = await racePreviewResponse.json() as ImportPreview;
    assert.deepEqual(racePreview.errors, []);
    await pool.query(
      `INSERT INTO fund_due_entries(cycle_id,member_id,amount,due_date,reason,created_by)
       VALUES($1,$2,1,CURRENT_DATE,$3,$4)`,
      [cycleId, missingMobileId, `${prefix} import race`, ownerId],
    );
    const raceCommitResponse = await request({
      dryRun: false,
      cycleId,
      rows: raceRows,
      confirmImport: true,
      previewToken: racePreview.previewToken,
    });
    assert.equal(raceCommitResponse.status, 400);
    assert.equal((await raceCommitResponse.json() as { error: string }).error, "Import was cancelled; no rows were saved");
    const raceMembers = await pool.query(
      "SELECT COUNT(*)::int AS count FROM fund_members WHERE name = ANY($1::text[])",
      [[`${prefix} race one`, `${prefix} race two`]],
    );
    assert.equal(Number(raceMembers.rows[0].count), 0);

    const existingPreviewResponse = await request({
      dryRun: true,
      cycleId,
      rows: [{ name: `${prefix} missing mobile`, shares: 3 }],
    });
    assert.equal(existingPreviewResponse.status, 200);
    const existingPreview = await existingPreviewResponse.json() as ImportPreview;
    assert.deepEqual(existingPreview.errors, []);
    const existingMatch = existingPreview.previewRows[0].existingMember;
    assert.ok(existingMatch);
    assert.equal(existingMatch.memberId, `${prefix}-MISSING`);

    const editResponse = await request(
      { mobile: `017${String(process.pid).padStart(8, "0")}` },
      `/api/members/${missingMobileId}`,
      "PATCH",
    );
    assert.equal(editResponse.status, 200);
    assert.equal((await editResponse.json() as { mobile: string }).mobile, `017${String(process.pid).padStart(8, "0")}`);

    const manualWithoutMobileResponse = await request({
      memberId: `${prefix}-MANUAL`,
      name: `${prefix} manual without mobile`,
      shares: 1,
      dailyAmount: 100,
      joiningDate: new Date().toISOString(),
      status: "active",
    }, "/api/members");
    assert.equal(manualWithoutMobileResponse.status, 400);

    const duplicateMobileResponse = await request({
      dryRun: true,
      cycleId,
      rows: [{
        name: `${prefix} duplicate import`,
        shares: 1,
        mobile: `018${String(process.pid).padStart(8, "0")}`,
      }],
    });
    assert.equal(duplicateMobileResponse.status, 200);
    const duplicateMobilePreview = await duplicateMobileResponse.json() as ImportPreview;
    assert.ok(duplicateMobilePreview.errors.some((error) => error.message.includes("Mobile already belongs")));

    const ambiguousResponse = await request({
      dryRun: true,
      cycleId,
      rows: [{ name: `${prefix} ambiguous`, shares: 1 }],
    });
    assert.equal(ambiguousResponse.status, 200);
    const ambiguousPreview = await ambiguousResponse.json() as ImportPreview;
    assert.ok(ambiguousPreview.errors.some((error) => error.message.includes("Ambiguous member match")));
    assert.equal(ambiguousPreview.valid, 0);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.query(
      `DELETE FROM fund_cycle_member_share_history
       WHERE member_id IN (
         SELECT id FROM fund_members WHERE member_id LIKE $1 OR name LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query("DELETE FROM fund_due_entries WHERE created_by=$1 AND reason LIKE $2", [ownerId, `${prefix}%`]);
    await pool.query(
      `DELETE FROM fund_cycle_members
       WHERE member_id IN (
         SELECT id FROM fund_members WHERE member_id LIKE $1 OR name LIKE $1
       )`,
      [`${prefix}%`],
    );
    if (ownsCycle) await pool.query("DELETE FROM fund_cycles WHERE id=$1", [cycleId]);
    await pool.query(
      `DELETE FROM fund_audit WHERE actor_id=$1 OR detail LIKE $2`,
      [ownerId, `${prefix}%`],
    );
    await pool.query(
      `DELETE FROM fund_members WHERE member_id LIKE $1 OR name LIKE $1`,
      [`${prefix}%`],
    );
    await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
    await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
    void duplicateMobileId;
    void ambiguousFirstId;
    void ambiguousSecondId;
  }
});

test.after(async () => {
  await pool.end();
});