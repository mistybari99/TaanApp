import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-MEMBER-ID-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("member IDs are sequential, duplicate-safe, and preserve Bangla names across search/import/export", async () => {
  const token = `${prefix}-owner-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
  let ownerId = 0;
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
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = (path: string, body?: unknown, method = "GET") =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          cookie: `irf_session=${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const firstResponse = await request("/api/members", {
      name: "শাহানা খাতুন",
      mobile: `016${String(process.pid).padStart(8, "0")}`,
      businessName: "শাহানা বস্ত্রালয়",
      address: "ঢাকা",
      shares: 1,
      dailyAmount: 100,
      joiningDate: new Date().toISOString().slice(0, 10),
      status: "active",
    }, "POST");
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json() as { id: number; memberId: string; name: string };
    memberIds.push(first.id);
    assert.match(first.memberId, /^IRF-\d{3,}$/);
    assert.equal(first.name, "শাহানা খাতুন");

    const secondResponse = await request("/api/members", {
      name: "মোছা. নাসরিন",
      mobile: `017${String(process.pid).padStart(8, "0")}`,
      shares: 1,
      dailyAmount: 100,
      joiningDate: new Date().toISOString().slice(0, 10),
      status: "active",
    }, "POST");
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json() as { id: number; memberId: string };
    memberIds.push(second.id);
    assert.equal(Number(second.memberId.slice(4)), Number(first.memberId.slice(4)) + 1);

    for (const search of ["শাহানা খাতুন", first.memberId, `016${String(process.pid).padStart(8, "0")}`]) {
      const searchResponse = await request(`/api/members?search=${encodeURIComponent(search)}`);
      assert.equal(searchResponse.status, 200);
      const results = await searchResponse.json() as Array<{ id: number; name: string; memberId: string }>;
      assert.ok(results.some((member) => member.id === first.id && member.name === "শাহানা খাতুন"));
    }

    const duplicateFilePreviewResponse = await request("/api/members/import", {
      dryRun: true,
      cycleId: (await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY cycle_number LIMIT 1")).rows[0].id,
      rows: [
        { memberId: first.memberId, name: "শাহানা খাতুন", shares: 1 },
        { memberId: first.memberId, name: "শাহানা খাতুন", shares: 1 },
      ],
    }, "POST");
    assert.equal(duplicateFilePreviewResponse.status, 200);
    const duplicatePreview = await duplicateFilePreviewResponse.json() as { errors: Array<{ message: string }> };
    assert.ok(duplicatePreview.errors.some((error) => error.message.includes("Duplicate member ID")));

    const activeCycleId = (await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY cycle_number LIMIT 1")).rows[0].id;
    const importPreviewResponse = await request("/api/members/import", {
      dryRun: true,
      cycleId: activeCycleId,
      rows: [{ memberId: first.memberId, name: "শাহানা খাতুন", businessName: "শাহানা বস্ত্রালয়", shares: 1 }],
    }, "POST");
    assert.equal(importPreviewResponse.status, 200);
    const importPreview = await importPreviewResponse.json() as { errors: unknown[]; previewToken: string };
    assert.deepEqual(importPreview.errors, []);
    const importCommitResponse = await request("/api/members/import", {
      dryRun: false,
      cycleId: activeCycleId,
      confirmImport: true,
      previewToken: importPreview.previewToken,
      rows: [{ memberId: first.memberId, name: "শাহানা খাতুন", businessName: "শাহানা বস্ত্রালয়", shares: 1 }],
    }, "POST");
    assert.equal(importCommitResponse.status, 200);

    const reloaded = await request(`/api/members?search=${encodeURIComponent(first.memberId)}`);
    const reloadedMembers = await reloaded.json() as Array<{ name: string; businessName: string }>;
    assert.equal(reloadedMembers[0]?.name, "শাহানা খাতুন");
    assert.equal(reloadedMembers[0]?.businessName, "শাহানা বস্ত্রালয়");

    const dashboardResponse = await request("/api/dashboard");
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json() as {
      dueMembers: Array<{ id: number; memberId: string; name: string }>;
    };
    const dashboardMember = dashboard.dueMembers.find((member) => member.id === first.id);
    assert.equal(dashboardMember?.memberId, first.memberId);
    assert.equal(dashboardMember?.name, "শাহানা খাতুন");

    const exportResponse = await request("/api/reports/export?type=members");
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.text();
    assert.match(exported, /শাহানা খাতুন/);
    assert.match(exported, /শাহানা বস্ত্রালয়/);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (memberIds.length) {
      await pool.query("DELETE FROM fund_cycle_member_share_history WHERE member_id = ANY($1::int[])", [memberIds]);
      await pool.query("DELETE FROM fund_cycle_members WHERE member_id = ANY($1::int[])", [memberIds]);
      await pool.query("DELETE FROM fund_audit WHERE member_id = ANY($1::int[])", [memberIds]);
      await pool.query("DELETE FROM fund_members WHERE id = ANY($1::int[])", [memberIds]);
    }
    await pool.query("DELETE FROM fund_audit WHERE actor_id=$1", [ownerId]);
    await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [ownerId]);
    await pool.query("DELETE FROM fund_users WHERE id=$1", [ownerId]);
  }
});

test.after(async () => {
  await pool.end();
});