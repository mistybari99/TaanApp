import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";

const prefix = `SYN-DUE-PERM-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

test("Owner may reach Due Entry validation while Collector cannot create entries", async () => {
  const ownerToken = `${prefix}-owner-token`;
  const collectorToken = `${prefix}-collector-token`;
  const client = await pool.connect();
  let server: ReturnType<typeof app.listen> | undefined;
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
    await client.query(
      `INSERT INTO fund_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '10 minutes'),($3,$4,now()+interval '10 minutes')`,
      [hashToken(ownerToken), owner.rows[0].id, hashToken(collectorToken), collector.rows[0].id],
    );
    await client.query("COMMIT");

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const ownerResponse = await fetch(`${baseUrl}/api/due-entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(ownerResponse.status, 400);

    const collectorResponse = await fetch(`${baseUrl}/api/due-entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `irf_session=${collectorToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(collectorResponse.status, 403);
    assert.deepEqual(await collectorResponse.json(), { error: "Owner access required" });

    const collectorViewResponse = await fetch(`${baseUrl}/api/members`, {
      headers: { cookie: `irf_session=${collectorToken}` },
    });
    assert.equal(collectorViewResponse.status, 200);
    assert.ok(Array.isArray(await collectorViewResponse.json()));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.query(
      `DELETE FROM fund_sessions
       WHERE user_id IN (SELECT id FROM fund_users WHERE username LIKE $1)`,
      [`${prefix}%`],
    );
    await pool.query("DELETE FROM fund_users WHERE username LIKE $1", [`${prefix}%`]);
  }
});

test.after(async () => {
  await pool.end();
});