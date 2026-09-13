import { readFileSync } from "node:fs";

export type RoutePolicy = "public" | "authenticated" | "administration" | "delegated";
export type RouteInventoryEntry = {
  method: string;
  path: string;
  policy: RoutePolicy;
  permission?: string;
};

const route = (method: string, path: string, policy: RoutePolicy, permission?: string): RouteInventoryEntry => ({
  method,
  path,
  policy,
  ...(permission ? { permission } : {}),
});

// Keep this inventory complete: a new route must be classified before it can pass
// the authorization contract below. Delegated operational routes are intentionally
// listed separately from Owner-only administration routes.
export const ROUTE_ACCESS_INVENTORY: RouteInventoryEntry[] = [
  route("POST", "/auth/login", "public"),
  route("GET", "/onboarding/status", "public"),
  route("POST", "/onboarding/initialize", "public"),

  route("POST", "/members", "administration"),
  route("POST", "/members/import", "administration"),
  route("PATCH", "/members/:id", "administration"),
  route("POST", "/cycles", "administration"),
  route("PATCH", "/cycles/:id", "administration"),
  route("POST", "/cycles/:id/tan/pause", "administration"),
  route("POST", "/cycles/:id/tan/resume", "administration"),
  route("POST", "/cycles/:id/tan/lock", "administration"),
  route("POST", "/cycles/:id/members", "administration"),
  route("GET", "/share-transfers/preview", "administration"),
  route("POST", "/share-transfers", "administration"),
  route("POST", "/draws", "administration"),
  route("POST", "/collector-targets", "administration"),
  route("GET", "/collectors", "administration"),
  route("POST", "/collectors", "administration"),
  route("PATCH", "/collectors/:id", "administration"),
  route("GET", "/cash-receivers", "administration"),
  route("POST", "/cash-receivers", "administration"),
  route("PATCH", "/cash-receivers/:id", "administration"),
  route("GET", "/permissions", "administration"),
  route("POST", "/permissions", "administration"),
  route("POST", "/permissions/:id/renew", "administration"),
  route("GET", "/permissions/:id/audit", "administration"),
  route("POST", "/permissions/:id/revoke", "administration"),
  route("GET", "/audit", "administration"),
  route("PATCH", "/settings", "administration"),
  route("GET", "/reports/export/preview", "administration"),
  route("GET", "/reports/export", "administration"),

  route("POST", "/due-entries/batch", "delegated", "ADVANCE_ALLOCATION"),
  route("POST", "/due-entries", "delegated", "ADVANCE_ALLOCATION"),
  route("POST", "/share-transfers/:id/settlement", "delegated", "FINANCIAL_CORRECTION"),
  route("POST", "/draws/:id/move-date", "delegated", "DRAW_DATE_CORRECTION"),
  route("POST", "/draws/:id/disbursement", "delegated", "PAYOUT_APPROVAL"),
  route("POST", "/draw-disbursements/:id/reverse", "delegated", "PAYOUT_REVERSAL"),
  route("POST", "/payments/:id/reverse", "delegated", "PAYMENT_REVERSAL"),

  route("POST", "/auth/logout", "authenticated"),
  route("GET", "/auth/me", "authenticated"),
  route("GET", "/members", "authenticated"),
  route("GET", "/members/:id/history", "authenticated"),
  route("GET", "/cycles", "authenticated"),
  route("GET", "/cycles/:id/tan", "authenticated"),
  route("GET", "/cycles/:id/members", "authenticated"),
  route("GET", "/share-transfers", "authenticated"),
  route("GET", "/draws", "authenticated"),
  route("GET", "/payments", "authenticated"),
  route("POST", "/payments", "authenticated"),
  route("GET", "/settlements", "authenticated"),
  route("POST", "/settlements", "authenticated"),
  route("GET", "/cash-handovers", "authenticated"),
  route("GET", "/cash-handover-recipients", "authenticated"),
  route("GET", "/cash-custody/balances", "authenticated"),
  route("GET", "/collector-targets", "authenticated"),
  route("POST", "/cash-handovers", "authenticated"),
  route("POST", "/cash-handovers/:id/accept", "authenticated"),
  route("POST", "/cash-handovers/:id/reject", "authenticated"),
  route("GET", "/permissions/mine", "authenticated"),
  route("GET", "/settings", "authenticated"),
  route("GET", "/dashboard", "authenticated"),
];

export const ADMINISTRATION_ROUTE_INVENTORY = ROUTE_ACCESS_INVENTORY.filter(
  ({ policy }) => policy === "administration",
);

export const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

const fundRouteSource = readFileSync(new URL("./routes/fund.ts", import.meta.url), "utf8");
export const declaredFundRoutes = fundRouteSource.split("\n").flatMap((line) => {
  const match = line.match(/^\s*router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']\s*,(.*)$/);
  return match ? [{ method: match[1].toUpperCase(), path: match[2], middlewareSource: match[3] }] : [];
});