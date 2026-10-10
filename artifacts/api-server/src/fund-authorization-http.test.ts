import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import app from "./app";
import { pool } from "@workspace/db";
import { ROUTE_ACCESS_INVENTORY } from "./fund-route-policy";

const prefix = `AUTHZ-HTTP-${process.pid}-${Date.now()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "1");

async function startServer() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

const send = (baseUrl: string, method: string, path: string, token?: string) =>
  fetch(`${baseUrl}/api${concrete(path)}`, {
    method,
    headers: {
      ...(token ? { cookie: `irf_session=${token}` } : {}),
      "content-type": "application/json",
    },
    body: method === "GET" ? undefined : "{}",
  });

test("Owner-only routes reject collectors (403) and anonymous callers (401) over real HTTP", async () => {
  const collectorToken = `${prefix}-collector`;
  const user = await pool.query(
    `INSERT INTO fund_users(name,username,password_hash,role)
     VALUES($1,$2,'synthetic','COLLECTOR') RETURNING id`,
    [`${prefix} collector`, `${prefix}-collector`],
  );
  const userId = user.rows[0].id as number;
  await pool.query(
    `INSERT INTO fund_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')`,
    [hashToken(collectorToken), userId],
  );
  const { server, baseUrl } = await startServer();
  try {
    const adminRoutes = ROUTE_ACCESS_INVENTORY.filter((entry) => entry.policy === "administration");
    assert.ok(adminRoutes.length > 0);
    for (const entry of adminRoutes) {
      const label = `${entry.method} ${entry.path}`;
      const asCollector = await send(baseUrl, entry.method, entry.path, collectorToken);
      assert.equal(asCollector.status, 403, `${label} must reject a Collector`);
      const anonymous = await send(baseUrl, entry.method, entry.path);
      assert.equal(anonymous.status, 401, `${label} must reject an anonymous caller`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await pool.query("DELETE FROM fund_sessions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM fund_audit WHERE actor_id=$1", [userId]);
    await pool.query("DELETE FROM fund_users WHERE id=$1", [userId]);
  }
});

test("every non-public route rejects anonymous callers with 401 over real HTTP", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const protectedRoutes = ROUTE_ACCESS_INVENTORY.filter((entry) => entry.policy !== "public");
    assert.ok(protectedRoutes.length > 0);
    for (const entry of protectedRoutes) {
      const response = await send(baseUrl, entry.method, entry.path);
      assert.equal(response.status, 401, `${entry.method} ${entry.path} must require sign-in`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test.after(async () => {
  await pool.end();
});
