import test from "node:test";
import assert from "node:assert/strict";
import {
  declaredFundRoutes,
  ROUTE_ACCESS_INVENTORY,
  routeKey,
} from "./fund-route-policy";

test("fund routes match the explicit authorization policy inventory", () => {
  const inventoryKeys = ROUTE_ACCESS_INVENTORY.map(({ method, path }) => routeKey(method, path));
  const declaredKeys = declaredFundRoutes.map(({ method, path }) => routeKey(method, path));

  assert.equal(new Set(inventoryKeys).size, inventoryKeys.length, "route policy inventory contains duplicate entries");
  assert.deepEqual(
    [...inventoryKeys].sort(),
    [...declaredKeys].sort(),
    "every fund route must be classified in ROUTE_ACCESS_INVENTORY exactly once",
  );

  for (const entry of ROUTE_ACCESS_INVENTORY) {
    const declaration = declaredFundRoutes.find((candidate) => routeKey(candidate.method, candidate.path) === routeKey(entry.method, entry.path));
    assert.ok(declaration, `missing route declaration for ${routeKey(entry.method, entry.path)}`);
    const middleware = declaration.middlewareSource;
    const hasAuth = /\brequireAuth\b/.test(middleware);
    const hasOwnerOnly = /\bownerOnly\b/.test(middleware);
    const delegatedPermission = middleware.match(/\bdelegatedPermission\(["']([A-Z_]+)["']\)/)?.[1];

    if (entry.policy === "public") {
      assert.equal(hasAuth, false, `${routeKey(entry.method, entry.path)} must remain public`);
      assert.equal(hasOwnerOnly, false, `${routeKey(entry.method, entry.path)} cannot use Owner-only middleware`);
      assert.equal(delegatedPermission, undefined, `${routeKey(entry.method, entry.path)} cannot use delegated permission middleware`);
    } else if (entry.policy === "authenticated") {
      assert.equal(hasAuth, true, `${routeKey(entry.method, entry.path)} must require authentication`);
      assert.equal(hasOwnerOnly, false, `${routeKey(entry.method, entry.path)} must not become an administration route`);
      assert.equal(delegatedPermission, undefined, `${routeKey(entry.method, entry.path)} must not use delegated permission middleware`);
    } else if (entry.policy === "administration") {
      assert.equal(hasAuth, true, `${routeKey(entry.method, entry.path)} must require authentication`);
      assert.equal(hasOwnerOnly, true, `${routeKey(entry.method, entry.path)} must use Owner-only authorization`);
      assert.equal(delegatedPermission, undefined, `${routeKey(entry.method, entry.path)} must not use delegated operational access`);
    } else {
      assert.equal(hasAuth, true, `${routeKey(entry.method, entry.path)} must require authentication`);
      assert.equal(hasOwnerOnly, false, `${routeKey(entry.method, entry.path)} must use delegated access instead of administration access`);
      assert.equal(delegatedPermission, entry.permission, `${routeKey(entry.method, entry.path)} must use delegated permission ${entry.permission}`);
    }
  }
});