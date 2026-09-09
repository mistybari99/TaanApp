import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const router = Router();
const COOKIE = "irf_session";
type FundRole = "OWNER" | "COLLECTOR" | "CASH_RECEIVER";
type AuthUser = { id: number; name: string; username: string; role: FundRole };
type AuthedRequest = Request & { user?: AuthUser };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const passwordMatches = (password: string, stored: string) => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
};
const cookies = (req: Request) => Object.fromEntries((req.headers.cookie ?? "").split(";").filter(Boolean).map((v) => v.trim().split("=")));
const money = (value: unknown) => Number(value ?? 0);
const isIsoDate = (value: unknown): value is string => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
export const businessDateInDhaka = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const todayIso = () => businessDateInDhaka();
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const allocatePayment = (amount: number, previousDue: number) => {
  const safeAmount = Math.max(0, roundMoney(amount));
  const safePreviousDue = Math.max(0, roundMoney(previousDue));
  const previousDueApplied = roundMoney(Math.min(safeAmount, safePreviousDue));
  return {
    previousDueApplied,
    currentPeriodApplied: roundMoney(safeAmount - previousDueApplied),
  };
};
export const calculateShareTransfer = (sourceShares: number, receiverShares: number, quantity: number, accumulatedValue: number) => {
  if (!Number.isInteger(sourceShares) || sourceShares < 1) throw new Error("Source member must have positive shares");
  if (!Number.isInteger(receiverShares) || receiverShares < 0) throw new Error("Receiver shares cannot be negative");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > sourceShares) throw new Error("Transfer quantity cannot exceed source shares");
  const safeValue = Math.max(0, roundMoney(accumulatedValue));
  return {
    sourceSharesAfter: sourceShares - quantity,
    receiverSharesAfter: receiverShares + quantity,
    transferredValue: roundMoney(safeValue * quantity / sourceShares),
    totalSharesBefore: sourceShares + receiverShares,
    totalSharesAfter: sourceShares - quantity + receiverShares + quantity,
  };
};
const idempotency = (value: unknown) => {
  const key = String(value ?? "").trim();
  return key || null;
};
const sameMoney = (left: unknown, right: unknown) => Math.abs(money(left) - money(right)) < 0.005;
type Queryable = { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type AuditFields = {
  memberId?: number | null;
  cycleId?: number | null;
  relatedTransactionId?: number | string | null;
  reason?: string | null;
  effectiveDate?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
};
const auditJson = (value: unknown) => value === undefined ? null : JSON.stringify(value);
const auditOn = async (
  queryable: Queryable,
  actorId: number,
  action: string,
  detail: string,
  entityType?: string,
  entityId?: string,
  fields: AuditFields = {},
) =>
  queryable.query(
    `INSERT INTO fund_audit(actor_id,action,detail,entity_type,entity_id,member_id,cycle_id,related_transaction_id,reason,effective_date,before_value,after_value)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
    [
      actorId,
      action,
      detail,
      entityType ?? null,
      entityId ?? null,
      fields.memberId ?? null,
      fields.cycleId ?? null,
      fields.relatedTransactionId == null ? null : String(fields.relatedTransactionId),
      fields.reason ?? null,
      fields.effectiveDate ?? null,
      auditJson(fields.beforeValue),
      auditJson(fields.afterValue),
    ],
  );
const audit = async (actorId: number, action: string, detail: string, entityType?: string, entityId?: string, fields?: AuditFields) =>
  auditOn(pool, actorId, action, detail, entityType, entityId, fields);
const transactionLock = async (client: Queryable, scope: string) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scope]);
};
const nextPublicMemberId = async (client: Queryable) => {
  await transactionLock(client, "fund-member-public-id-sequence");
  const result = await client.query(
    `SELECT COALESCE(MAX(substring(public_member_id FROM 5)::int),0)+1 AS next_id
       FROM fund_members
      WHERE public_member_id ~ '^IRF-[0-9]+$'`,
  );
  return `IRF-${String(Number(result.rows[0]?.next_id ?? 1)).padStart(3, "0")}`;
};
const isFriday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5;
const isSaturday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const saturdayWeekBounds = (date: string) => {
  const daysSinceSaturday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7;
  const periodStart = addDays(date, -daysSinceSaturday);
  return { periodStart, periodEnd: addDays(periodStart, 6) };
};
const validStatus = (value: unknown, allowed: readonly string[]) => allowed.includes(String(value ?? ""));
const cashCustodyRoles: readonly FundRole[] = ["OWNER", "COLLECTOR", "CASH_RECEIVER"];
const isCashCustodyRole = (value: unknown): value is FundRole => cashCustodyRoles.includes(value as FundRole);

type TanPeriodRow = {
  tanConfigId: number;
  tanStartDate: string;
  drawsPerWeek: number;
  totalShares: number;
  totalDrawDates: number;
  dailyPerShare: number;
  expectedDailyCollection: number;
  weeklyCollectionUnit: number;
  perDrawWinnerAmount: number;
  tanStatus: "LOCKED" | "COMPLETED";
  periodId: number;
  sequenceNo: number;
  periodStart: string;
  periodEnd: string;
  drawDate: string;
  expectedCollection: number;
  periodStatus: "OPEN" | "COMPLETED";
};

const tanPeriodForDate = async (queryable: Queryable, cycleId: number, date: string, forUpdate = false) => {
  const result = await queryable.query(
    `SELECT cfg.id AS "tanConfigId",cfg.tan_start_date::text AS "tanStartDate",cfg.draws_per_week AS "drawsPerWeek",
      cfg.total_shares AS "totalShares",cfg.total_draw_dates AS "totalDrawDates",
      cfg.daily_per_share::float AS "dailyPerShare",cfg.expected_daily_collection::float AS "expectedDailyCollection",
      cfg.weekly_collection_unit::float AS "weeklyCollectionUnit",cfg.per_draw_winner_amount::float AS "perDrawWinnerAmount",
      cfg.status AS "tanStatus",p.id AS "periodId",p.sequence_no AS "sequenceNo",
      p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd",p.draw_date::text AS "drawDate",
      p.expected_collection::float AS "expectedCollection",p.status AS "periodStatus"
     FROM fund_tan_configs cfg
     JOIN fund_tan_periods p ON p.tan_config_id=cfg.id
     WHERE cfg.cycle_id=$1 AND $2::date BETWEEN p.period_start AND p.period_end
     ORDER BY cfg.id DESC,p.sequence_no
     LIMIT 1
     ${forUpdate ? "FOR UPDATE OF p" : ""}`,
    [cycleId, date],
  );
  return (result.rows[0] as TanPeriodRow | undefined) ?? null;
};

const tanConfigForCycle = async (queryable: Queryable, cycleId: number, forUpdate = false) => {
  const result = await queryable.query(
    `SELECT cfg.id AS "tanConfigId",cfg.cycle_id AS "cycleId",cfg.tan_start_date::text AS "tanStartDate",
      cfg.draws_per_week AS "drawsPerWeek",cfg.total_shares AS "totalShares",cfg.total_draw_dates AS "totalDrawDates",
      cfg.daily_per_share::float AS "dailyPerShare",cfg.expected_daily_collection::float AS "expectedDailyCollection",
      cfg.weekly_collection_unit::float AS "weeklyCollectionUnit",cfg.per_draw_winner_amount::float AS "perDrawWinnerAmount",
      cfg.status AS "tanStatus",cfg.locked_at AS "lockedAt",cfg.completed_at AS "completedAt"
     FROM fund_tan_configs cfg WHERE cfg.cycle_id=$1
     ORDER BY cfg.id DESC LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [cycleId],
  );
  return result.rows[0] ?? null;
};

const tanPeriodIsLive = (period: TanPeriodRow | null, date = todayIso()) =>
  Boolean(period && period.periodStatus !== "COMPLETED" && date >= period.periodStart && date <= period.periodEnd);

export const collectionCalendarState = (
  date: string,
  hasActiveCycle: boolean,
  hasTan: boolean,
  period: Pick<TanPeriodRow, "periodStart" | "drawDate"> | null,
) => ({
  isFridayClosingDay: Boolean(hasActiveCycle && isFriday(date) && (!hasTan || period?.drawDate === date)),
  isSaturdayOpeningDay: Boolean(hasActiveCycle && isSaturday(date) && (!hasTan || period?.periodStart === date)),
});

const tanPreviousPeriodsComplete = async (queryable: Queryable, period: TanPeriodRow) => {
  const result = await queryable.query(
    "SELECT COUNT(*)::int AS count FROM fund_tan_periods WHERE tan_config_id=$1 AND sequence_no < $2 AND status <> 'COMPLETED'",
    [period.tanConfigId, period.sequenceNo],
  );
  return Number(result.rows[0]?.count ?? 0) === 0;
};

const tanDueForMembers = async (queryable: Queryable, cycleId: number, period: TanPeriodRow | null) => {
  const boundary = period?.periodStart ?? todayIso();
  const periodId = period?.periodId ?? 0;
  const result = await queryable.query(
    `SELECT cm.member_id AS "memberId",
      GREATEST(
        COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=$1 AND de.member_id=cm.member_id),0)
        + COALESCE((SELECT SUM(o.required_amount) FROM fund_tan_period_member_obligations o
          JOIN fund_tan_periods p ON p.id=o.tan_period_id
          WHERE o.cycle_id=$1 AND o.member_id=cm.member_id AND p.period_end < $2::date),0)
        - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp
          WHERE pp.cycle_id=$1 AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0
      )::float AS "previousDue",
      GREATEST(
        COALESCE((SELECT o.required_amount FROM fund_tan_period_member_obligations o
          WHERE o.tan_period_id=$3 AND o.member_id=cm.member_id),0)
        - COALESCE((SELECT SUM(pp.current_period_applied) FROM fund_payments pp
          WHERE pp.tan_period_id=$3 AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0
      )::float AS "currentPeriodDue"
     FROM fund_cycle_members cm
     WHERE cm.cycle_id=$1`,
    [cycleId, boundary, periodId],
  );
  return new Map(result.rows.map((row) => [Number(row.memberId), row]));
};

const tanDashboardMemberRows = async (
  queryable: Queryable,
  cycleId: number,
  period: TanPeriodRow | null,
  dueByMember: Map<number, any>,
  collectorId?: number,
) => {
  const params: unknown[] = [cycleId];
  const access = collectorId
    ? ` AND (m.assigned_collector_id=$${params.push(collectorId)} OR m.assigned_collector_id IS NULL)`
    : "";
  const result = await queryable.query(
    `SELECT m.id,COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name,m.mobile,m.address,m.business_name AS "businessName",cm.shares,
      cm.daily_contribution::float AS "dailyAmount",m.joining_date::text AS "joiningDate",m.status
     FROM fund_members m
     JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=$1
     WHERE m.status='active'${access}
     ORDER BY m.member_id`,
    params,
  );
  return result.rows.map((member) => {
    const due = dueByMember.get(Number(member.id));
    const previousDue = money(due?.previousDue);
    const currentPeriodDue = period ? money(due?.currentPeriodDue) : 0;
    return { ...member, previousDue, currentPeriodDue, todayDue: currentPeriodDue, totalDue: previousDue + currentPeriodDue };
  });
};

const transferSelect = `
  SELECT t.id,t.transfer_id AS "transferId",t.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",c.name AS "cycleName",
    t.transfer_date::text AS "transferDate",
    t.from_member_id AS "fromMemberId",COALESCE(fm.public_member_id,fm.member_id) AS "fromMemberCode",fm.name AS "fromMemberName",
    t.to_member_id AS "toMemberId",COALESCE(tm.public_member_id,tm.member_id) AS "toMemberCode",tm.name AS "toMemberName",
    t.share_quantity AS shares,t.accumulated_value::float AS "accumulatedValue",t.notes,t.override_winner AS "overrideWinner",
    t.created_by AS "createdBy",cu.name AS "createdByName",t.created_at AS "createdAt",
    s.id AS "settlementId",s.amount::float AS "settlementAmount",s.status AS "settlementStatus",
    s.approved_by AS "settlementApprovedBy",au.name AS "settlementApprovedByName",
    s.approved_at AS "settlementApprovedAt",s.notes AS "settlementNotes"
  FROM fund_share_transfers t
    JOIN fund_cycles c ON c.id=t.cycle_id
    JOIN fund_members fm ON fm.id=t.from_member_id
    JOIN fund_members tm ON tm.id=t.to_member_id
    JOIN fund_users cu ON cu.id=t.created_by
    LEFT JOIN fund_transfer_settlements s ON s.transfer_id=t.id
    LEFT JOIN fund_users au ON au.id=s.approved_by
`;
const collectorTransferSelect = `
  SELECT t.id,t.transfer_id AS "transferId",t.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",c.name AS "cycleName",
    t.transfer_date::text AS "transferDate",
    COALESCE(fm.public_member_id,fm.member_id) AS "fromMemberCode",fm.name AS "fromMemberName",
    COALESCE(tm.public_member_id,tm.member_id) AS "toMemberCode",tm.name AS "toMemberName",
    t.share_quantity AS shares,
    CASE WHEN t.override_winner THEN 'OWNER_OVERRIDE' ELSE 'TRANSFER_RECORDED' END AS status
  FROM fund_share_transfers t
    JOIN fund_cycles c ON c.id=t.cycle_id
    JOIN fund_members fm ON fm.id=t.from_member_id
    JOIN fund_members tm ON tm.id=t.to_member_id
`;
const cashHandoverSelect = `
  SELECT h.id,h.cycle_id AS "cycleId",
    h.from_user_id AS "fromUserId",fu.name AS "fromUserName",fu.role AS "fromRole",
    h.to_user_id AS "toUserId",tu.name AS "toUserName",tu.role AS "toRole",
    h.amount::float,h.collection_date::text AS "collectionDate",
    h.receipt_start AS "receiptStart",h.receipt_end AS "receiptEnd",h.receipt_count AS "receiptCount",
    h.reference,h.note,h.status,h.submitted_by AS "submittedBy",
    h.accepted_by AS "acceptedBy",au.name AS "acceptedByName",h.accepted_at AS "acceptedAt",
    h.counted_by AS "countedBy",cu.name AS "countedByName",h.counted_amount::float AS "countedAmount",
    h.received_by AS "receivedBy",ru2.name AS "receivedByName",
    h.rejected_by AS "rejectedBy",ru.name AS "rejectedByName",h.rejected_at AS "rejectedAt",
    h.rejection_reason AS "rejectionReason",h.created_at AS "createdAt"
  FROM fund_cash_handovers h
    JOIN fund_users fu ON fu.id=h.from_user_id
    JOIN fund_users tu ON tu.id=h.to_user_id
    LEFT JOIN fund_users au ON au.id=h.accepted_by
    LEFT JOIN fund_users cu ON cu.id=h.counted_by
    LEFT JOIN fund_users ru2 ON ru2.id=h.received_by
    LEFT JOIN fund_users ru ON ru.id=h.rejected_by
`;
const drawSelect = `
  SELECT d.id,d.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",c.name AS "cycleName",
    d.draw_number AS "drawNumber",d.draw_date::text AS "drawDate",m.id AS "winnerMemberId",
    COALESCE(m.public_member_id,m.member_id) AS "winnerMemberCode",m.name AS "winnerName",
    d.winning_amount::float AS "winningAmount",d.status,d.notes,d.created_at AS "createdAt",
    d.tan_period_id AS "tanPeriodId",d.draw_slot AS "drawSlot",
    d.entitlement_id AS "entitlementId",d.entitlement_number AS "entitlementNumber",
    pd.id AS "payoutId",pd.payer_user_id AS "payoutPayerId",pu.name AS "payoutPayerName",
    pd.amount::float AS "payoutAmount",pd.payout_date::text AS "payoutDate",pd.reference AS "payoutReference",
    pd.note AS "payoutNote",pd.status AS "payoutStatus",pd.created_at AS "payoutCreatedAt",
    pd.reversed_at AS "payoutReversedAt",pd.reversal_reason AS "payoutReversalReason"
  FROM fund_draws d
    JOIN fund_cycles c ON c.id=d.cycle_id
    JOIN fund_members m ON m.id=d.winner_member_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM fund_draw_disbursements
      WHERE draw_id=d.id
      ORDER BY created_at DESC,id DESC
      LIMIT 1
    ) pd ON true
    LEFT JOIN fund_users pu ON pu.id=pd.payer_user_id
`;

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = cookies(req)[COOKIE];
  if (!token) return res.status(401).json({ error: "Sign in required" });
  const result = await pool.query(
    `SELECT u.id,u.name,u.username,u.role FROM fund_sessions s JOIN fund_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Session expired" });
  req.user = result.rows[0] as AuthUser;
  return next();
}
const ownerOnly = (req: AuthedRequest, res: Response, next: NextFunction) =>
  req.user?.role === "OWNER" ? next() : res.status(403).json({ error: "Owner access required" });

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const result = await pool.query("SELECT id,name,username,role,password_hash FROM fund_users WHERE username=$1 AND active=true", [username]);
  const row = result.rows[0];
  if (!row || !password || !passwordMatches(password, row.password_hash)) return res.status(401).json({ error: "Invalid username or password" });
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO fund_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hashToken(token), row.id]);
  await audit(row.id, "LOGIN", "Signed in");
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return res.json({ id: row.id, name: row.name, username: row.username, role: row.role });
});
router.post("/auth/logout", requireAuth, async (req: AuthedRequest, res) => {
  const token = cookies(req)[COOKIE];
  if (token) await pool.query("DELETE FROM fund_sessions WHERE token_hash=$1", [hashToken(token)]);
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
  res.status(204).end();
});
router.get("/auth/me", requireAuth, (req: AuthedRequest, res) => res.json({ ...req.user, active: true }));

router.get("/onboarding/status", async (_req, res) => {
  const result = await pool.query("SELECT EXISTS(SELECT 1 FROM fund_users WHERE role='OWNER' AND active=true) initialized,(SELECT demo_mode FROM fund_settings WHERE id=1) AS demo_mode");
  res.json({ initialized: result.rows[0].initialized, demoMode: result.rows[0].demo_mode ?? true });
});
router.post("/onboarding/initialize", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE fund_users IN EXCLUSIVE MODE");
    const existing = await client.query("SELECT 1 FROM fund_users WHERE role='OWNER' LIMIT 1");
    if (existing.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Fund is already initialized" }); }
    const b = req.body;
    if (!b.organizationName || !b.ownerName || String(b.password ?? "").length < 8) {
      await client.query("ROLLBACK"); return res.status(400).json({ error: "Complete all setup fields; password needs 8 characters" });
    }
    const created = await client.query("INSERT INTO fund_users(name,username,password_hash,role) VALUES($1,$2,$3,'OWNER') RETURNING id,name,username,role,active", [b.ownerName,b.username,hashPassword(b.password)]);
    await client.query("UPDATE fund_settings SET organization_name=$1,demo_mode=false WHERE id=1", [b.organizationName]);
    await client.query("INSERT INTO fund_audit(actor_id,action,detail) VALUES($1,'FUND_INITIALIZED','First owner completed secure setup')", [created.rows[0].id]);
    await client.query("COMMIT");
    return res.status(201).json(created.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Failed to initialize fund");
    return res.status(400).json({ error: "Could not initialize; username may already exist" });
  } finally { client.release(); }
});

router.get("/members", requireAuth, async (req: AuthedRequest, res) => {
  const search = `%${String(req.query.search ?? "")}%`;
  const businessDate = todayIso();
  const params: unknown[] = [search, businessDate];
  let allowed = "";
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); allowed = " AND (m.assigned_collector_id=$3 OR m.assigned_collector_id IS NULL)"; }
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
  const activeCycleId = Number(activeCycle.rows[0]?.id ?? 0);
  const activeTan = activeCycleId ? await tanConfigForCycle(pool, activeCycleId) : null;
  const activeTanPeriod = activeCycleId ? await tanPeriodForDate(pool, activeCycleId, todayIso()) : null;
  const tanDue = activeTan ? await tanDueForMembers(pool, activeCycleId, activeTanPeriod) : new Map<number, any>();
  const rows = await pool.query(
    `SELECT m.id,COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name,m.mobile,m.address,m.business_name AS "businessName",m.shares,m.daily_amount::float AS "dailyAmount",
       m.joining_date::text AS "joiningDate",m.created_at AS "createdAt",m.notes,m.status,
       c.tracking_start_date::text AS "trackingStartDate",
       COALESCE(cm.daily_contribution,0)::float AS "currentDailyAmount",
       COALESCE(SUM(p.amount) FILTER(WHERE p.collection_date=$2::date AND p.status='POSTED'),0)::float AS "todayPaid",
       GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=c.id AND de.member_id=m.id),0)
         - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=c.id AND pp.member_id=m.id AND pp.status='POSTED'),0),0)::float AS "previousDue"
     FROM fund_members m
       LEFT JOIN fund_cycles c ON c.status='ACTIVE'
       LEFT JOIN fund_cycle_members cm ON cm.cycle_id=c.id AND cm.member_id=m.id
       LEFT JOIN fund_payments p ON p.member_id=m.id AND p.cycle_id=c.id
     WHERE (m.name ILIKE $1 OR m.public_member_id ILIKE $1 OR m.member_id ILIKE $1 OR m.mobile ILIKE $1)${allowed}
      GROUP BY m.id,cm.id,c.id,c.tracking_start_date ORDER BY m.member_id`,
    params,
  );
  res.json(rows.rows.map((m) => {
    const trackingReady = Boolean(m.currentDailyAmount) && Boolean(m.trackingStartDate) && todayIso() >= String(m.trackingStartDate);
    const tanMemberDue = activeTan ? tanDue.get(Number(m.id)) : null;
    const previousDue = activeTan ? money(tanMemberDue?.previousDue) : money(m.previousDue);
    const currentPeriodDue = activeTan ? money(tanMemberDue?.currentPeriodDue) : 0;
    const todayDue = activeTan ? currentPeriodDue : trackingReady ? Math.max(0, money(m.currentDailyAmount) - money(m.todayPaid)) : 0;
    return { ...m, previousDue, currentPeriodDue, todayDue, totalDue: todayDue + previousDue };
  }));
});
router.post("/members", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  const mobile = String(b.mobile ?? "").trim();
  if (!String(b.name ?? "").trim() || !mobile) {
    return res.status(400).json({ error: "Name and mobile are required; Member ID is generated by the system" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicateMobile = await client.query("SELECT 1 FROM fund_members WHERE mobile=$1 LIMIT 1", [mobile]);
    if (duplicateMobile.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Mobile already belongs to another member" });
    }
    const publicMemberId = await nextPublicMemberId(client);
    const r = await client.query(
      `INSERT INTO fund_members(member_id,public_member_id,name,mobile,business_name,address,nid,shares,daily_amount,joining_date,status,notes)
        VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,COALESCE(public_member_id,member_id) AS "memberId",name,mobile,business_name AS "businessName",address,nid,shares,daily_amount::float AS "dailyAmount",joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status`,
      [publicMemberId,b.name,mobile,b.businessName ?? "",b.address ?? "",b.nid ?? null,b.shares,b.dailyAmount,b.joiningDate,b.status === "inactive" ? "inactive" : "active",b.notes ?? ""],
    );
    await auditOn(client, req.user!.id, "MEMBER_CREATED", `Created ${publicMemberId}`, "member", String(r.rows[0].id));
    await client.query("COMMIT");
    return res.status(201).json({ ...r.rows[0], todayPaid: 0, todayDue: money(b.dailyAmount) });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Member creation failed");
    return res.status(409).json({ error: "Member could not be created" });
  } finally {
    client.release();
  }
});
router.post("/members/import", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const rows: Array<Record<string, unknown>> = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
  const cycleId = req.body.cycleId ? Number(req.body.cycleId) : null;
  if (!cycleId) return res.status(400).json({ error: "Select an active cycle before importing members" });
  const settings = await pool.query("SELECT default_daily_per_share::float AS amount FROM fund_settings WHERE id=1");
  const defaultDaily = money(settings.rows[0]?.amount) || 100;
  const normalized = rows.map((row) => ({
    ...row,
    memberId: String(row.memberId ?? "").trim(),
    name: String(row.name ?? "").trim(),
    mobile: String(row.mobile ?? "").trim(),
    businessName: String(row.businessName ?? "").trim(),
    address: String(row.address ?? ""),
    nid: String(row.nid ?? "").trim(),
    notes: String(row.notes ?? ""),
    shares: Number(row.shares),
    dailyAmount: row.dailyAmount === "" || row.dailyAmount == null ? Number(row.shares) * defaultDaily : Number(row.dailyAmount),
    joiningDate: String(row.joiningDate ?? "").trim() || todayIso(),
    status: row.status === "inactive" ? "inactive" : "active",
  }));
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();
  const seenMobiles = new Map<string, number>();
  const previewRows: Array<{
    row: number;
    name: string;
    businessName: string;
    shares: number;
    mobile: string;
    mobileStatus: "provided" | "missing";
    existingMember: { id: number; memberId: string; name: string } | null;
  }> = normalized.map((row, index) => ({
    row: index + 2,
    name: row.name,
    businessName: row.businessName,
    shares: Number(row.shares),
    mobile: row.mobile,
    mobileStatus: row.mobile ? "provided" : "missing",
    existingMember: null,
  }));
  const existingMembers = await pool.query(
    `SELECT id,COALESCE(public_member_id,member_id) AS "memberId",member_id AS "legacyMemberId",name,mobile,business_name AS "businessName"
       FROM fund_members
      ORDER BY id`,
  );
  const membersById = new Map(existingMembers.rows.flatMap((member) => [
    [String(member.memberId), member],
    [String(member.legacyMemberId), member],
  ]));
  const existingMobileOwners = new Map(
    existingMembers.rows
      .filter((member) => String(member.mobile ?? "").trim())
      .map((member) => [String(member.mobile).trim(), member]),
  );
  normalized.forEach((row, index) => {
    const id = row.memberId;
    if (!row.name) errors.push({ row: index + 2, message: "Name is required" });
    if (id && seen.has(id)) errors.push({ row: index + 2, message: `Duplicate member ID in file: ${id}` });
    if (id) seen.add(id);
    if (row.mobile) {
      const firstRow = seenMobiles.get(row.mobile);
      if (firstRow) errors.push({ row: index + 2, message: `Duplicate mobile in file; already used on row ${firstRow}` });
      else seenMobiles.set(row.mobile, index + 2);
    }
    if (!Number.isInteger(Number(row.shares)) || Number(row.shares) < 1) errors.push({ row: index + 2, message: "Shares must be a positive whole number" });
    if (!Number.isFinite(Number(row.dailyAmount)) || Number(row.dailyAmount) <= 0) errors.push({ row: index + 2, message: "Daily amount must be positive" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.joiningDate ?? ""))) errors.push({ row: index + 2, message: "Joining date must be YYYY-MM-DD" });
  });
  const cycle = cycleId
    ? await pool.query("SELECT id,status,daily_per_share::float AS daily_per_share,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE id=$1", [cycleId])
    : { rows: [] as any[] };
  if (cycleId && !cycle.rows[0]) errors.push({ row: 1, message: "Selected cycle was not found" });
  else if (cycleId && cycle.rows[0].status !== "ACTIVE") errors.push({ row: 1, message: "Members can only be imported into an active cycle" });
  else if (cycleId) {
    const tan = await tanConfigForCycle(pool, cycleId);
    if (tan) errors.push({ row: 1, message: "TAN is locked; member import cannot change the locked share total" });
  }
  normalized.forEach((row, index) => {
    const rowNumber = index + 2;
    let match = row.memberId ? membersById.get(row.memberId) : undefined;
    if (!row.memberId) {
      const sameName = existingMembers.rows.filter((member) => String(member.name).trim().toLocaleLowerCase() === row.name.toLocaleLowerCase());
      const candidates = row.mobile
        ? sameName.filter((member) => String(member.mobile ?? "").trim() === row.mobile)
        : sameName;
      if (candidates.length > 1) {
        errors.push({ row: rowNumber, message: `Ambiguous member match for ${row.name}; include a member ID or unique mobile` });
      } else {
        match = candidates[0];
      }
    }
    if (match) {
      previewRows[index].existingMember = {
        id: Number(match.id),
        memberId: String(match.memberId),
        name: String(match.name),
      };
    }
    if (row.mobile) {
      const mobileOwner = existingMobileOwners.get(row.mobile);
      if (mobileOwner && Number(mobileOwner.id) !== Number(match?.id)) {
        errors.push({ row: rowNumber, message: `Mobile already belongs to another member: ${mobileOwner.memberId}` });
      }
    }
  });
  const invalidRows = new Set(errors.map((error) => error.row));
  const validRows = normalized.filter((_row, index) => !invalidRows.has(index + 2));
  const cyclePerShare = money(cycle.rows[0]?.daily_per_share) || defaultDaily;
  const totalShares = validRows.reduce((sum, row) => sum + Number(row.shares), 0);
  const expectedDailyCollection = totalShares * cyclePerShare;
  const previewToken = createHash("sha256").update(JSON.stringify({ cycleId, rows: normalized })).digest("hex");
  const preview = {
    valid: validRows.length,
    imported: 0,
    errors,
    memberCount: validRows.length,
    totalShares,
    expectedDailyCollection,
    previewToken,
    previewRows,
  };
  if (errors.length || req.body.dryRun) return res.json(preview);
  if (req.body.confirmImport !== true || req.body.previewToken !== previewToken) {
    return res.status(409).json({ error: "Review the current preview and explicitly approve it before committing", ...preview });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (cycleId) {
      const lockedCycle = await client.query(
        `SELECT id,status,daily_per_share::float AS daily_per_share,tracking_start_date::text AS tracking_start_date
           FROM fund_cycles WHERE id=$1 FOR UPDATE`,
        [cycleId],
      );
      if (!lockedCycle.rows[0] || lockedCycle.rows[0].status !== "ACTIVE") {
        throw new Error("The selected cycle is no longer active");
      }
      const tan = await tanConfigForCycle(client, cycleId, true);
      const activity = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM fund_payments WHERE cycle_id=$1) AS payments,
           (SELECT COUNT(*) FROM fund_due_entries WHERE cycle_id=$1) AS dues,
           (SELECT COUNT(*) FROM fund_share_transfers WHERE cycle_id=$1) AS transfers,
           (SELECT COUNT(*) FROM fund_draws WHERE cycle_id=$1) AS draws`,
        [cycleId],
      );
      if (tan || Object.values(activity.rows[0] ?? {}).some((value) => Number(value) > 0)) {
        throw new Error("The selected cycle already has locked or financial activity");
      }
    }
    let imported = 0;
    for (const row of normalized) {
      let memberId = row.memberId;
      let memberDbId: number;
      if (memberId) {
        const existing = await client.query("SELECT id FROM fund_members WHERE public_member_id=$1 OR member_id=$1 FOR UPDATE", [memberId]);
        if (existing.rows[0]) {
          memberDbId = existing.rows[0].id;
          await client.query(
            `UPDATE fund_members SET name=$2,mobile=COALESCE(NULLIF($3,''),mobile),business_name=$4,address=$5,nid=COALESCE(NULLIF($6,''),nid),
              shares=$7,daily_amount=$8,joining_date=$9,status=$10,notes=$11 WHERE id=$1`,
            [memberDbId, row.name, row.mobile, row.businessName, row.address, row.nid, row.shares, row.dailyAmount, row.joiningDate, row.status, row.notes],
          );
        }
        else {
          memberId = await nextPublicMemberId(client);
          const created = await client.query(`INSERT INTO fund_members(member_id,public_member_id,name,mobile,business_name,address,nid,shares,daily_amount,joining_date,status,notes) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [memberId,row.name,row.mobile || null,row.businessName,row.address,row.nid || null,row.shares,row.dailyAmount,row.joiningDate,row.status,row.notes]);
          memberDbId = created.rows[0].id;
        }
      } else {
        const existing = await client.query(
          `SELECT id FROM fund_members
             WHERE LOWER(TRIM(name))=LOWER(TRIM($1))
               AND (NULLIF($2,'') IS NULL OR mobile=$2)
             ORDER BY id
             FOR UPDATE`,
          [row.name,row.mobile],
        );
        if (existing.rows.length > 1) {
          throw new Error(`Ambiguous member match for ${row.name}; include a memberId or unique mobile`);
        }
        if (existing.rows[0]) {
          memberDbId = existing.rows[0].id;
          await client.query(
            `UPDATE fund_members SET name=$2,mobile=COALESCE(NULLIF($3,''),mobile),business_name=$4,address=$5,nid=COALESCE(NULLIF($6,''),nid),
              shares=$7,daily_amount=$8,joining_date=$9,status=$10,notes=$11 WHERE id=$1`,
            [memberDbId, row.name, row.mobile, row.businessName, row.address, row.nid, row.shares, row.dailyAmount, row.joiningDate, row.status, row.notes],
          );
        }
        else {
          memberId = await nextPublicMemberId(client);
          const created = await client.query(`INSERT INTO fund_members(member_id,public_member_id,name,mobile,business_name,address,nid,shares,daily_amount,joining_date,status,notes) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [memberId,row.name,row.mobile || null,row.businessName,row.address,row.nid || null,row.shares,row.dailyAmount,row.joiningDate,row.status,row.notes]);
          memberDbId = created.rows[0].id;
        }
      }
      if (cycleId) {
        const priorCycleMember = await client.query(
          "SELECT shares FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2 FOR UPDATE",
          [cycleId, memberDbId],
        );
        const priorShares = Number(priorCycleMember.rows[0]?.shares ?? 0);
        await client.query(`INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution) VALUES($1,$2,$3,$4)
          ON CONFLICT(cycle_id,member_id) DO UPDATE SET shares=EXCLUDED.shares,daily_contribution=EXCLUDED.daily_contribution`,
          [cycleId,memberDbId,row.shares,row.shares * cyclePerShare]);
        if (priorShares !== Number(row.shares)) {
          await client.query(
            `INSERT INTO fund_cycle_member_share_history(cycle_id,member_id,previous_shares,new_shares,effective_date,reason,changed_by)
             VALUES($1,$2,$3,$4,$5,'CSV member import',$6)`,
            [cycleId, memberDbId, priorShares, Number(row.shares), todayIso(), req.user!.id],
          );
        }
      }
      imported += 1;
    }
    await client.query("INSERT INTO fund_audit(actor_id,action,detail,entity_type) VALUES($1,'MEMBERS_IMPORTED',$2,'member_import')", [req.user!.id, `${imported} members imported${cycleId ? ` into cycle ${cycleId}` : ""}`]);
    await client.query("COMMIT");
    return res.json({ ...preview, valid: normalized.length, imported });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Member import failed");
    return res.status(400).json({ error: "Import was cancelled; no rows were saved" });
  } finally { client.release(); }
});
router.patch("/members/:id", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id,COALESCE(public_member_id,member_id) AS \"memberId\",status FROM fund_members WHERE id=$1 FOR UPDATE", [id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Member not found" });
    }
    const mobile = b.mobile == null ? null : String(b.mobile).trim();
    if (mobile) {
      const duplicateMobile = await client.query("SELECT 1 FROM fund_members WHERE mobile=$1 AND id<>$2 LIMIT 1", [mobile, id]);
      if (duplicateMobile.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Mobile already belongs to another member" });
      }
    }
    const result = await client.query(
      `UPDATE fund_members SET name=COALESCE($2,name),mobile=COALESCE($3,mobile),business_name=COALESCE($4,business_name),address=COALESCE($5,address),nid=COALESCE($6,nid),
        status=COALESCE($7,status),notes=COALESCE($8,notes) WHERE id=$1
        RETURNING id,COALESCE(public_member_id,member_id) AS "memberId",name,mobile,business_name AS "businessName",address,nid,shares,daily_amount::float AS "dailyAmount",
        joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status`,
      [id,b.name ?? null,mobile,b.businessName ?? null,b.address ?? null,b.nid ?? null,b.status ?? null,b.notes ?? null],
    );
    const statusChanged = String(current.rows[0].status) !== String(result.rows[0].status);
    await auditOn(
      client,
      req.user!.id,
      statusChanged ? "MEMBER_STATUS_CHANGED" : "MEMBER_UPDATED",
      `Updated ${result.rows[0].memberId}`,
      "member",
      String(id),
      statusChanged
        ? {
            memberId: id,
            reason: String(b.reason ?? "Member status update").trim(),
            beforeValue: { status: current.rows[0].status },
            afterValue: { status: result.rows[0].status },
          }
        : { memberId: id },
    );
    await client.query("COMMIT");
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Member update failed");
    return res.status(409).json({ error: "Member could not be updated" });
  } finally {
    client.release();
  }
});
router.get("/members/:id/history", requireAuth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (req.user?.role === "COLLECTOR") {
    const access = await pool.query("SELECT 1 FROM fund_members WHERE id=$1 AND (assigned_collector_id=$2 OR assigned_collector_id IS NULL)", [id, req.user.id]);
    if (!access.rowCount) return res.status(403).json({ error: "Collector is not assigned to this member" });
  }
   const member = await pool.query(`SELECT id,COALESCE(public_member_id,member_id) AS "memberId",name,mobile,business_name AS "businessName",address,nid,shares,daily_amount::float AS "dailyAmount",
    joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status FROM fund_members WHERE id=$1`, [id]);
  if (!member.rows[0]) return res.status(404).json({ error: "Member not found" });
  const [cycles, payments, draws, transfers] = await Promise.all([
    pool.query(`SELECT c.id AS "cycleId",c.cycle_number AS "cycleNumber",c.name,c.start_date::text AS "startDate",c.end_date::text AS "endDate",
      c.status,cm.shares,cm.daily_contribution::float AS "dailyContribution",
      COALESCE((
        SELECT e.allocated_entitlements
        FROM fund_tan_member_draw_entitlements e
        JOIN fund_tan_configs cfg ON cfg.id=e.tan_config_id
        WHERE e.cycle_id=c.id AND e.member_id=cm.member_id
        ORDER BY cfg.id DESC LIMIT 1
      ),cm.shares)::int AS "drawEntitlementTotal",
      COALESCE((
        SELECT e.consumed_entitlements
        FROM fund_tan_member_draw_entitlements e
        JOIN fund_tan_configs cfg ON cfg.id=e.tan_config_id
        WHERE e.cycle_id=c.id AND e.member_id=cm.member_id
        ORDER BY cfg.id DESC LIMIT 1
      ),(
        SELECT COUNT(*) FROM fund_draws d
        WHERE d.cycle_id=c.id AND d.winner_member_id=cm.member_id AND d.status <> 'VOID'
      ))::int AS "drawEntitlementUsed",
     COALESCE(SUM(p.amount) FILTER(WHERE p.status='POSTED'),0)::float AS "totalCollected",
     GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=c.id AND de.member_id=cm.member_id),0)
       - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=c.id AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0)::float AS "previousDue"
      FROM fund_cycle_members cm JOIN fund_cycles c ON c.id=cm.cycle_id
      LEFT JOIN fund_payments p ON p.cycle_id=c.id AND p.member_id=cm.member_id
      WHERE cm.member_id=$1 GROUP BY c.id,cm.id ORDER BY c.start_date DESC`, [id]),
     pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.cycle_id AS "cycleId",p.amount::float,p.collection_date::text AS "collectionDate",
       p.shares,p.verification_status AS "verificationStatus",p.status,p.created_at AS "createdAt",u.name AS "collectorName",ru.name AS "receiverName",
       p.receipt_source AS "receiptSource"
       FROM fund_payments p LEFT JOIN fund_users u ON u.id=p.collector_id
       LEFT JOIN fund_users ru ON ru.id=COALESCE(p.receiver_id,p.collector_id)
       WHERE p.member_id=$1 ORDER BY p.created_at DESC LIMIT 500`, [id]),
      pool.query(`SELECT d.id,d.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",d.draw_number AS "drawNumber",
       d.draw_date::text AS "drawDate",d.winning_amount::float AS "winningAmount",d.status,d.notes,
       d.entitlement_number AS "entitlementNumber"
       FROM fund_draws d JOIN fund_cycles c ON c.id=d.cycle_id WHERE d.winner_member_id=$1 ORDER BY d.draw_date DESC`, [id]),
     req.user?.role === "OWNER"
       ? pool.query(`${transferSelect} WHERE t.from_member_id=$1 OR t.to_member_id=$1 ORDER BY t.transfer_date DESC,t.created_at DESC`, [id])
       : pool.query(`${collectorTransferSelect} WHERE (t.from_member_id=$1 OR t.to_member_id=$1) AND (fm.assigned_collector_id=$2 OR fm.assigned_collector_id IS NULL OR tm.assigned_collector_id=$2 OR tm.assigned_collector_id IS NULL) ORDER BY t.transfer_date DESC,t.created_at DESC`, [id, req.user!.id]),
  ]);
  return res.json({ member: member.rows[0], cycles: cycles.rows, payments: payments.rows, draws: draws.rows, transfers: transfers.rows });
});

router.get("/cycles", requireAuth, async (_req, res) => {
  const result = await pool.query(`SELECT c.id,c.cycle_number AS "cycleNumber",c.name,c.start_date::text AS "startDate",
    c.end_date::text AS "endDate",c.tracking_start_date::text AS "trackingStartDate",c.daily_per_share::float AS "dailyPerShare",c.draw_frequency AS "drawFrequency",
    c.draw_day AS "drawDay",c.status,c.notes,c.created_at AS "createdAt",COUNT(cm.id)::int AS "memberCount"
    FROM fund_cycles c LEFT JOIN fund_cycle_members cm ON cm.cycle_id=c.id
    GROUP BY c.id ORDER BY c.start_date DESC,c.cycle_number DESC`);
  return res.json(result.rows);
});
router.post("/cycles", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  if (!String(b.name ?? "").trim() || !isIsoDate(b.startDate)) {
    return res.status(400).json({ error: "Cycle name and valid start date are required" });
  }
  const status = b.status === "COMPLETED" ? "COMPLETED" : "ACTIVE";
  if (status === "ACTIVE" && !isIsoDate(b.trackingStartDate)) {
    return res.status(400).json({ error: "An active cycle needs an explicit digital tracking start date" });
  }
  if (b.endDate !== undefined && b.endDate !== null && b.endDate !== "" && !isIsoDate(b.endDate)) {
    return res.status(400).json({ error: "End date must be YYYY-MM-DD" });
  }
  const number = b.cycleNumber
    ? Number(b.cycleNumber)
    : Number((await pool.query("SELECT COALESCE(MAX(cycle_number),0)+1 AS next FROM fund_cycles")).rows[0].next);
  if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: "Cycle number must be a positive whole number" });
  try {
    const result = await pool.query(`INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,tracking_start_date,daily_per_share,draw_frequency,draw_day,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,'WEEKLY','FRIDAY',$7,$8)
      RETURNING id,cycle_number AS "cycleNumber",name,start_date::text AS "startDate",end_date::text AS "endDate",tracking_start_date::text AS "trackingStartDate",
      daily_per_share::float AS "dailyPerShare",draw_frequency AS "drawFrequency",draw_day AS "drawDay",status,notes,created_at AS "createdAt"`,
      [number,String(b.name).trim(),b.startDate,b.endDate || null,status === "ACTIVE" ? b.trackingStartDate : b.trackingStartDate || null,Number(b.dailyPerShare) > 0 ? Number(b.dailyPerShare) : 100,status,b.notes ?? ""]);
    await audit(req.user!.id, "CYCLE_CREATED", `Created ${result.rows[0].name}`, "cycle", String(result.rows[0].id));
    return res.status(201).json({ ...result.rows[0], memberCount: 0 });
  } catch {
    return res.status(409).json({ error: "Cycle number already exists or another active cycle is already open" });
  }
});
router.patch("/cycles/:id", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT id,name,end_date::text AS end_date,tracking_start_date::text AS tracking_start_date,
        daily_per_share::float AS daily_per_share,draw_frequency,draw_day,status,notes,
        (SELECT COUNT(*) FROM fund_payments WHERE cycle_id=fund_cycles.id AND status='POSTED')::int AS posted_payments
        FROM fund_cycles WHERE id=$1 FOR UPDATE`, [id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cycle not found" });
    }
    if (current.rows[0].status === "COMPLETED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Completed cycles are locked and cannot be edited" });
    }
    const tan = await tanConfigForCycle(client, id);
    if (tan && b.status === "COMPLETED" && tan.tanStatus !== "COMPLETED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "The active TAN must complete all scheduled draw-dates before the cycle can be completed" });
    }
    if (tan && (b.name !== undefined || b.endDate !== undefined || b.trackingStartDate !== undefined || b.dailyPerShare !== undefined)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "TAN configuration is locked; use a share transfer to move member shares" });
    }
    const requestedStatus = b.status ?? current.rows[0].status;
    if (!["ACTIVE", "COMPLETED"].includes(requestedStatus)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid cycle status" });
    }
    if (b.trackingStartDate !== undefined && !isIsoDate(b.trackingStartDate)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Tracking start date must be YYYY-MM-DD" });
    }
    if (current.rows[0].posted_payments > 0 && b.trackingStartDate && b.trackingStartDate !== current.rows[0].tracking_start_date) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Tracking start date cannot change after payments are posted" });
    }
    if (
      b.dailyPerShare !== undefined
      && Number(b.dailyPerShare) !== Number(current.rows[0].daily_per_share)
      && (
        current.rows[0].posted_payments > 0
        || (current.rows[0].tracking_start_date && todayIso() >= String(current.rows[0].tracking_start_date))
      )
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Daily contribution cannot change after digital collection has started" });
    }
    const result = await client.query(`UPDATE fund_cycles SET name=COALESCE($2,name),end_date=COALESCE($3,end_date),
      tracking_start_date=COALESCE($4,tracking_start_date),daily_per_share=COALESCE($5,daily_per_share),status=$6,notes=COALESCE($7,notes)
      WHERE id=$1 RETURNING id,cycle_number AS "cycleNumber",name,start_date::text AS "startDate",end_date::text AS "endDate",
      tracking_start_date::text AS "trackingStartDate",daily_per_share::float AS "dailyPerShare",draw_frequency AS "drawFrequency",draw_day AS "drawDay",status,notes,created_at AS "createdAt"`,
      [id,b.name ?? null,b.endDate ?? null,b.trackingStartDate ?? null,b.dailyPerShare ? Number(b.dailyPerShare) : null,requestedStatus,b.notes ?? null]);
    await auditOn(client, req.user!.id, "CYCLE_UPDATED", `Updated ${result.rows[0].name}`, "cycle", String(id), {
      cycleId: id,
      reason: b.reason ?? b.notes ?? "Cycle configuration update",
      beforeValue: {
        name: current.rows[0].name,
        endDate: current.rows[0].end_date,
        trackingStartDate: current.rows[0].tracking_start_date,
        dailyPerShare: current.rows[0].daily_per_share,
        drawFrequency: current.rows[0].draw_frequency,
        drawDay: current.rows[0].draw_day,
        status: current.rows[0].status,
        notes: current.rows[0].notes,
      },
      afterValue: {
        name: result.rows[0].name,
        endDate: result.rows[0].endDate,
        trackingStartDate: result.rows[0].trackingStartDate,
        dailyPerShare: result.rows[0].dailyPerShare,
        drawFrequency: result.rows[0].drawFrequency,
        drawDay: result.rows[0].drawDay,
        status: result.rows[0].status,
        notes: result.rows[0].notes,
      },
    });
    await client.query("COMMIT");
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Cycle update failed");
    return res.status(409).json({ error: "Cycle could not be updated" });
  } finally {
    client.release();
  }
});

router.get("/cycles/:id/tan", requireAuth, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.params.id);
  const config = await tanConfigForCycle(pool, cycleId);
  if (!config) return res.json({ tan: null, periods: [], activePeriod: null, nextPeriod: null });
  const periods = await pool.query(
    `SELECT p.id,p.sequence_no AS "sequenceNo",p.period_start::text AS "periodStart",p.period_end::text AS "periodEnd",
      p.draw_date::text AS "drawDate",p.expected_collection::float AS "expectedCollection",p.status,
      p.completed_at AS "completedAt",COUNT(d.id)::int AS "recordedDraws"
     FROM fund_tan_periods p
     LEFT JOIN fund_draws d ON d.tan_period_id=p.id AND d.status <> 'VOID'
     WHERE p.tan_config_id=$1
     GROUP BY p.id ORDER BY p.sequence_no`,
    [config.tanConfigId],
  );
  const currentDate = todayIso();
  const mapped = periods.rows.map((period) => ({
    ...period,
    computedStatus: period.status === "COMPLETED"
      ? "COMPLETED"
      : currentDate < String(period.periodStart)
        ? "SCHEDULED"
        : currentDate > String(period.periodEnd)
          ? "CLOSED"
          : "OPEN",
  }));
  const activePeriod = mapped.find((period) => period.computedStatus === "OPEN") ?? null;
  const nextPeriod = mapped.find((period) => period.computedStatus === "SCHEDULED") ?? null;
  return res.json({
    tan: {
      id: config.tanConfigId,
      cycleId,
      tanStartDate: config.tanStartDate,
      drawsPerWeek: Number(config.drawsPerWeek),
      totalShares: Number(config.totalShares),
      totalDrawDates: Number(config.totalDrawDates),
      dailyPerShare: money(config.dailyPerShare),
      expectedDailyCollection: money(config.expectedDailyCollection),
      weeklyCollectionUnit: money(config.weeklyCollectionUnit),
      perDrawWinnerAmount: money(config.perDrawWinnerAmount),
      status: config.tanStatus,
      lockedAt: config.lockedAt,
      completedAt: config.completedAt,
    },
    periods: mapped,
    activePeriod,
    nextPeriod,
  });
});

router.post("/cycles/:id/tan/lock", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.params.id);
  const tanStartDate = isIsoDate(req.body.tanStartDate ?? req.body.startDate)
    ? String(req.body.tanStartDate ?? req.body.startDate)
    : "";
  const drawsPerWeek = Number(req.body.drawsPerWeek);
  if (!cycleId || !isSaturday(tanStartDate) || !Number.isInteger(drawsPerWeek) || drawsPerWeek < 1) {
    return res.status(400).json({ error: "TAN start date must be a Saturday and draws per week must be a positive whole number" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `tan-lock:${cycleId}`);
    const cycle = await client.query(
      `SELECT id,status,tracking_start_date::text AS "trackingStartDate",daily_per_share::float AS "dailyPerShare"
       FROM fund_cycles WHERE id=$1 FOR UPDATE`,
      [cycleId],
    );
    if (!cycle.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cycle not found" });
    }
    if (cycle.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only the active cycle can receive a TAN schedule" });
    }
    const previousTan = await tanConfigForCycle(client, cycleId, true);
    if (previousTan && previousTan.tanStatus !== "COMPLETED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "The current TAN must complete all draw-dates before a new TAN can be locked" });
    }
    if (!previousTan) {
      if (cycle.rows[0].trackingStartDate && String(cycle.rows[0].trackingStartDate) !== tanStartDate) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "TAN start must match the existing digital tracking start date" });
      }
      const conflicts = await client.query(
        `SELECT
          (SELECT COUNT(*) FROM fund_payments WHERE cycle_id=$1) AS payments,
          (SELECT COUNT(*) FROM fund_draws WHERE cycle_id=$1) AS draws,
          (SELECT COUNT(*) FROM fund_due_entries WHERE cycle_id=$1) AS dues,
          (SELECT COUNT(*) FROM fund_share_transfers WHERE cycle_id=$1) AS transfers`,
        [cycleId],
      );
      const conflict = conflicts.rows[0];
      if (Number(conflict.payments) || Number(conflict.draws) || Number(conflict.dues) || Number(conflict.transfers)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "TAN can only be locked before financial activity exists in this cycle" });
      }
    } else {
      const previousEnd = await client.query("SELECT MAX(period_end)::text AS \"periodEnd\" FROM fund_tan_periods WHERE tan_config_id=$1", [previousTan.tanConfigId]);
      if (!previousEnd.rows[0]?.periodEnd || tanStartDate <= String(previousEnd.rows[0].periodEnd)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "A new TAN must start after the previous TAN has ended" });
      }
    }
    const shareResult = await client.query(
      "SELECT COALESCE(SUM(shares),0)::int AS \"totalShares\" FROM fund_cycle_members WHERE cycle_id=$1",
      [cycleId],
    );
    const totalShares = Number(shareResult.rows[0]?.totalShares ?? 0);
    if (!totalShares) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Import or enroll cycle members before locking TAN" });
    }
    if (drawsPerWeek > totalShares || totalShares % drawsPerWeek !== 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Total shares must divide evenly by draws per week", totalShares, drawsPerWeek });
    }
    const dailyPerShare = money(cycle.rows[0].dailyPerShare);
    const expectedDailyCollection = roundMoney(totalShares * dailyPerShare);
    const weeklyCollectionUnit = expectedDailyCollection;
    const perDrawWinnerAmount = roundMoney(weeklyCollectionUnit / drawsPerWeek);
    const totalDrawDates = totalShares / drawsPerWeek;
    const created = await client.query(
      `INSERT INTO fund_tan_configs(cycle_id,tan_start_date,draws_per_week,total_shares,total_draw_dates,daily_per_share,
        expected_daily_collection,weekly_collection_unit,per_draw_winner_amount,locked_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [cycleId,tanStartDate,drawsPerWeek,totalShares,totalDrawDates,dailyPerShare,expectedDailyCollection,weeklyCollectionUnit,perDrawWinnerAmount,req.user!.id],
    );
    const tanConfigId = Number(created.rows[0].id);
    const memberSnapshots = await client.query(
      "SELECT member_id AS \"memberId\",shares FROM fund_cycle_members WHERE cycle_id=$1 ORDER BY member_id",
      [cycleId],
    );
    for (const member of memberSnapshots.rows) {
      await client.query(
        `INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(tan_config_id,member_id) DO NOTHING`,
        [tanConfigId, cycleId, member.memberId, member.shares],
      );
    }
    for (let index = 0; index < totalDrawDates; index += 1) {
      const periodStart = addDays(tanStartDate, index * 7);
      const periodEnd = addDays(periodStart, 6);
      const period = await client.query(
        `INSERT INTO fund_tan_periods(tan_config_id,cycle_id,sequence_no,period_start,period_end,draw_date,expected_collection)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tanConfigId,cycleId,index + 1,periodStart,periodEnd,periodEnd,weeklyCollectionUnit],
      );
      for (const member of memberSnapshots.rows) {
        await client.query(
          `INSERT INTO fund_tan_period_member_obligations(tan_period_id,cycle_id,member_id,shares_snapshot,required_amount)
           VALUES($1,$2,$3,$4,$5)`,
          [period.rows[0].id, cycleId, member.memberId, member.shares, roundMoney(Number(member.shares) * dailyPerShare)],
        );
      }
    }
    if (!previousTan) {
      await client.query("UPDATE fund_cycles SET tracking_start_date=$2 WHERE id=$1", [cycleId, tanStartDate]);
    }
    await auditOn(client, req.user!.id, "TAN_LOCKED", `Locked TAN for cycle ${cycleId}: ${totalShares} shares, ${drawsPerWeek} draws/week, ${totalDrawDates} draw-dates`, "tan_config", String(tanConfigId), {
      cycleId,
      effectiveDate: tanStartDate,
      afterValue: { totalShares, drawsPerWeek, totalDrawDates, perDrawWinnerAmount, tanStartDate },
    });
    await client.query("COMMIT");
    return res.status(201).json({ id: tanConfigId, cycleId, totalShares, drawsPerWeek, totalDrawDates, perDrawWinnerAmount, tanStartDate });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "TAN lock failed");
    return res.status(409).json({ error: "TAN schedule could not be locked; no records were changed" });
  } finally {
    client.release();
  }
});
router.get("/cycles/:id/members", requireAuth, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.params.id);
  const tan = await tanConfigForCycle(pool, cycleId);
  const tanPeriod = tan ? await tanPeriodForDate(pool, cycleId, todayIso()) : null;
  const tanDue = tan ? await tanDueForMembers(pool, cycleId, tanPeriod) : new Map<number, any>();
  const params: unknown[] = [Number(req.params.id)];
  let access = "";
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); access = " AND (m.assigned_collector_id=$2 OR m.assigned_collector_id IS NULL)"; }
  const entitlementConfigParam = params.push(Number(tan?.tanConfigId ?? 0));
  const result = await pool.query(`SELECT cm.id,cm.cycle_id AS "cycleId",m.id AS "memberId",COALESCE(m.public_member_id,m.member_id) AS "memberCode",m.name,m.mobile,m.business_name AS "businessName",
    m.status,cm.shares,cm.daily_contribution::float AS "dailyContribution",
     COALESCE((SELECT e.allocated_entitlements FROM fund_tan_member_draw_entitlements e WHERE e.tan_config_id=$${entitlementConfigParam} AND e.member_id=cm.member_id),cm.shares)::int AS "drawEntitlementTotal",
     COALESCE((SELECT e.consumed_entitlements FROM fund_tan_member_draw_entitlements e WHERE e.tan_config_id=$${entitlementConfigParam} AND e.member_id=cm.member_id),
       (SELECT COUNT(*) FROM fund_draws d WHERE d.cycle_id=cm.cycle_id AND d.winner_member_id=cm.member_id AND d.status <> 'VOID'))::int AS "drawEntitlementUsed",
    COALESCE(SUM(p.amount) FILTER(WHERE p.status='POSTED'),0)::float AS "totalCollected",
     CASE WHEN c.status='ACTIVE' AND c.tracking_start_date IS NOT NULL AND '${todayIso()}'::date >= c.tracking_start_date
      THEN GREATEST(cm.daily_contribution-COALESCE(SUM(p.amount) FILTER(WHERE p.collection_date='${todayIso()}'::date AND p.status='POSTED'),0),0)
      ELSE 0 END::float AS "todayDue"
     ,GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=c.id AND de.member_id=cm.member_id),0)
       - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=c.id AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0)::float AS "previousDue"
    FROM fund_cycle_members cm JOIN fund_members m ON m.id=cm.member_id JOIN fund_cycles c ON c.id=cm.cycle_id
      LEFT JOIN fund_payments p ON p.cycle_id=cm.cycle_id AND p.member_id=cm.member_id
    WHERE cm.cycle_id=$1${access} GROUP BY cm.id,m.id,c.id ORDER BY m.member_id`, params);
  return res.json(result.rows.map((member) => {
    const tanMemberDue = tan ? tanDue.get(Number(member.memberId)) : null;
    const previousDue = tan ? money(tanMemberDue?.previousDue) : money(member.previousDue);
    const currentPeriodDue = tan ? money(tanMemberDue?.currentPeriodDue) : 0;
    const todayDue = tan ? currentPeriodDue : money(member.todayDue);
      const drawEntitlementTotal = Number(member.drawEntitlementTotal ?? member.shares);
      const drawEntitlementUsed = Number(member.drawEntitlementUsed ?? 0);
      return {
        ...member,
        drawEntitlementTotal,
        drawEntitlementUsed,
        drawEntitlementRemaining: Math.max(0, drawEntitlementTotal - drawEntitlementUsed),
        previousDue,
        currentPeriodDue,
        todayDue,
        totalDue: todayDue + previousDue,
      };
  }));
});
router.post("/cycles/:id/members", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.params.id);
  const memberId = Number(req.body.memberId);
  const shares = Number(req.body.shares);
  if (!Number.isInteger(shares) || shares < 1) return res.status(400).json({ error: "Shares must be a positive whole number" });
  const effectiveDate = isIsoDate(req.body.effectiveDate) ? String(req.body.effectiveDate) : todayIso();
  if (effectiveDate > todayIso()) return res.status(400).json({ error: "Effective share date cannot be in the future" });
  const reason = String(req.body.reason ?? "Owner share update").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required for every share change" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cycle = await client.query(
      "SELECT status,daily_per_share::float AS per_share,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE id=$1 FOR UPDATE",
      [cycleId],
    );
    const tan = await tanConfigForCycle(client, cycleId, true);
    if (tan && tan.tanStatus !== "COMPLETED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "TAN shares are locked; use the Share Transfer workflow instead of editing membership shares" });
    }
    const member = await client.query("SELECT id FROM fund_members WHERE id=$1", [memberId]);
    if (!cycle.rows[0] || !member.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cycle or member not found" });
    }
    if (cycle.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Completed cycles are locked" });
    }
    const before = await client.query("SELECT shares FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2 FOR UPDATE", [cycleId, memberId]);
    const previousShares = Number(before.rows[0]?.shares ?? 0);
    const membershipChanged = !before.rows[0] || previousShares !== shares;
    if (membershipChanged && cycle.rows[0].tracking_start_date && todayIso() >= String(cycle.rows[0].tracking_start_date)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cycle membership shares are frozen after digital collection starts" });
    }
    if (membershipChanged) {
      const activity = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM fund_payments WHERE cycle_id=$1) AS payments,
           (SELECT COUNT(*) FROM fund_due_entries WHERE cycle_id=$1) AS dues,
           (SELECT COUNT(*) FROM fund_share_transfers WHERE cycle_id=$1) AS transfers,
           (SELECT COUNT(*) FROM fund_draws WHERE cycle_id=$1) AS draws`,
        [cycleId],
      );
      if (Object.values(activity.rows[0] ?? {}).some((value) => Number(value) > 0)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Cycle membership shares cannot change after financial activity begins" });
      }
    }
    const result = await client.query(`INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
      VALUES($1,$2,$3,$4) ON CONFLICT(cycle_id,member_id) DO UPDATE SET shares=EXCLUDED.shares,daily_contribution=EXCLUDED.daily_contribution
      RETURNING id,cycle_id AS "cycleId",member_id AS "memberId",shares,daily_contribution::float AS "dailyContribution"`,
      [cycleId,memberId,shares,shares * money(cycle.rows[0].per_share)]);
    if (previousShares !== shares) {
      const shareHistory = await client.query(
        `INSERT INTO fund_cycle_member_share_history(cycle_id,member_id,previous_shares,new_shares,effective_date,reason,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [cycleId, memberId, previousShares, shares, effectiveDate, reason, req.user!.id],
      );
       await auditOn(client, req.user!.id, "CYCLE_MEMBER_UPDATED", `${memberId}: ${previousShares} → ${shares} shares; ${reason}`, "cycle_member", String(result.rows[0].id), {
         memberId,
         cycleId,
         relatedTransactionId: shareHistory.rows[0].id,
         reason,
         effectiveDate,
         beforeValue: { shares: previousShares },
         afterValue: { shares },
       });
    }
    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Cycle membership update failed");
    return res.status(400).json({ error: "Cycle member update was not saved" });
  } finally {
    client.release();
  }
});

router.post("/due-entries/batch", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.body.cycleId);
  const rawMemberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  const memberIds = rawMemberIds.map((value: unknown) => Number(value));
  const amount = Number(req.body.amount);
  const dueDate = isIsoDate(req.body.dueDate) ? String(req.body.dueDate) : todayIso();
  const reason = String(req.body.reason ?? "").trim();
  const idempotencyKey = String(req.body.idempotencyKey ?? "").trim() || null;
  const uniqueMemberIds = new Set(memberIds);
  if (
    !cycleId ||
    memberIds.length === 0 ||
    memberIds.some((memberId: number) => !Number.isInteger(memberId) || memberId < 1) ||
    uniqueMemberIds.size !== memberIds.length ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    dueDate > todayIso() ||
    !reason
  ) {
    return res.status(400).json({ error: "Cycle, unique members, positive amount, non-future due date, and reason are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tan = await tanConfigForCycle(client, cycleId, true);
    let tanPeriodId: number | null = null;
    if (tan) {
      const tanPeriod = await tanPeriodForDate(client, cycleId, dueDate, true);
      if (!tanPeriod || !tanPeriodIsLive(tanPeriod, dueDate) || !(await tanPreviousPeriodsComplete(client, tanPeriod))) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Previous due entries can only be recorded during the currently open TAN period" });
      }
      tanPeriodId = tanPeriod.periodId;
    }
    if (idempotencyKey) {
      await transactionLock(client, `due-entry-batch:${cycleId}:${idempotencyKey}`);
      const replay = await client.query(
        `SELECT id,cycle_id AS "cycleId",member_id AS "memberId",amount::float,due_date::text AS "dueDate",reason,created_at AS "createdAt"
         FROM fund_due_entries WHERE cycle_id=$1 AND idempotency_key=$2 ORDER BY id`,
        [cycleId, idempotencyKey],
      );
      if (replay.rows.length > 0) {
        const replayMemberIds = replay.rows.map((row) => Number(row.memberId));
        const sameMembers = replayMemberIds.length === memberIds.length && replayMemberIds.every((memberId) => uniqueMemberIds.has(memberId));
        const sameValues = replay.rows.every((row) =>
          sameMoney(row.amount, amount) && String(row.dueDate) === dueDate && String(row.reason) === reason);
        if (!sameMembers || !sameValues) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This batch idempotency key was already used for different due entries" });
        }
        await client.query("COMMIT");
        return res.status(200).json({ count: replay.rows.length, entries: replay.rows });
      }
    }
    const membership = await client.query(
      `SELECT cm.member_id AS "memberId"
       FROM fund_cycle_members cm
       JOIN fund_cycles c ON c.id=cm.cycle_id
       WHERE cm.cycle_id=$1 AND cm.member_id=ANY($2::int[]) AND c.status='ACTIVE'`,
      [cycleId, memberIds],
    );
    const enrolled = new Set(membership.rows.map((row) => Number(row.memberId)));
    if (enrolled.size !== memberIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Every selected member must be enrolled in the active cycle" });
    }
    const entries: any[] = [];
    for (const memberId of memberIds) {
      const dueBefore = await client.query(
        `SELECT GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=$1 AND de.member_id=$2),0)
          - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=$1 AND pp.member_id=$2 AND pp.status='POSTED'),0),0)::float AS "previousDue"`,
        [cycleId, memberId],
      );
      const previousDueBefore = money(dueBefore.rows[0]?.previousDue);
      const entry = await client.query(
        `INSERT INTO fund_due_entries(cycle_id,member_id,amount,due_date,reason,idempotency_key,created_by,tan_period_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,cycle_id AS "cycleId",member_id AS "memberId",amount::float,due_date::text AS "dueDate",reason,created_at AS "createdAt"`,
        [cycleId, memberId, amount, dueDate, reason, idempotencyKey, req.user!.id, tanPeriodId],
      );
      entries.push(entry.rows[0]);
      await auditOn(client, req.user!.id, "DUE_ENTRY_CREATED", `Member ${memberId}: BDT ${amount}; ${reason}`, "due_entry", String(entry.rows[0].id), {
        memberId,
        cycleId,
        reason,
        effectiveDate: dueDate,
        beforeValue: { previousDue: previousDueBefore },
        afterValue: { previousDue: roundMoney(previousDueBefore + amount), amount, dueDate },
      });
    }
    await client.query("COMMIT");
    return res.status(201).json({ count: entries.length, entries });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Batch due entry failed");
    return res.status(409).json({ error: "Previous due entries could not be recorded; no records were changed" });
  } finally {
    client.release();
  }
});

router.post("/due-entries", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.body.cycleId);
  const memberId = Number(req.body.memberId);
  const amount = Number(req.body.amount);
  const dueDate = isIsoDate(req.body.dueDate) ? String(req.body.dueDate) : todayIso();
  const reason = String(req.body.reason ?? "").trim();
  const idempotencyKey = String(req.body.idempotencyKey ?? "").trim() || null;
  if (!cycleId || !memberId || !Number.isFinite(amount) || amount <= 0 || dueDate > todayIso() || !reason) {
    return res.status(400).json({ error: "Cycle, member, positive amount, non-future due date, and reason are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tan = await tanConfigForCycle(client, cycleId, true);
    let tanPeriodId: number | null = null;
    if (tan) {
      const tanPeriod = await tanPeriodForDate(client, cycleId, dueDate, true);
      if (!tanPeriod || !tanPeriodIsLive(tanPeriod) || !(await tanPreviousPeriodsComplete(client, tanPeriod))) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Previous due entries can only be recorded during the currently open TAN period" });
      }
      tanPeriodId = tanPeriod.periodId;
    }
    if (idempotencyKey) {
      await transactionLock(client, `due-entry:${cycleId}:${memberId}:${idempotencyKey}`);
      const replay = await client.query(`SELECT id,cycle_id AS "cycleId",member_id AS "memberId",amount::float,due_date::text AS "dueDate",reason,created_at AS "createdAt"
        FROM fund_due_entries WHERE cycle_id=$1 AND member_id=$2 AND idempotency_key=$3`, [cycleId, memberId, idempotencyKey]);
      if (replay.rows[0]) {
        await client.query("COMMIT");
        return res.status(200).json(replay.rows[0]);
      }
    }
    const membership = await client.query(
      "SELECT 1 FROM fund_cycle_members cm JOIN fund_cycles c ON c.id=cm.cycle_id WHERE cm.cycle_id=$1 AND cm.member_id=$2 AND c.status='ACTIVE'",
      [cycleId, memberId],
    );
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Member is not enrolled in an active cycle" });
    }
    const dueBefore = await client.query(
      `SELECT GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=$1 AND de.member_id=$2),0)
        - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=$1 AND pp.member_id=$2 AND pp.status='POSTED'),0),0)::float AS "previousDue"`,
      [cycleId, memberId],
    );
    const previousDueBefore = money(dueBefore.rows[0]?.previousDue);
    const entry = await client.query(`INSERT INTO fund_due_entries(cycle_id,member_id,amount,due_date,reason,idempotency_key,created_by,tan_period_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id,cycle_id AS "cycleId",member_id AS "memberId",amount::float,due_date::text AS "dueDate",reason,created_at AS "createdAt"`,
      [cycleId, memberId, amount, dueDate, reason, idempotencyKey, req.user!.id, tanPeriodId]);
    await auditOn(client, req.user!.id, "DUE_ENTRY_CREATED", `Member ${memberId}: BDT ${amount}; ${reason}`, "due_entry", String(entry.rows[0].id), {
      memberId,
      cycleId,
      reason,
      effectiveDate: dueDate,
      beforeValue: { previousDue: previousDueBefore },
      afterValue: { previousDue: roundMoney(previousDueBefore + amount), amount, dueDate },
    });
    await client.query("COMMIT");
    return res.status(201).json(entry.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Due entry failed");
    return res.status(409).json({ error: "Previous due could not be recorded" });
  } finally {
    client.release();
  }
});

router.get("/share-transfers/preview", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.query.cycleId);
  const fromMemberId = Number(req.query.fromMemberId);
  const quantity = Number(req.query.quantity);
  if (!cycleId || !fromMemberId || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: "Cycle, source member, and a positive whole-number quantity are required" });
  }
  const cycle = await pool.query("SELECT id,status,tracking_start_date::text AS tracking_start_date,daily_per_share::float AS daily_per_share FROM fund_cycles WHERE id=$1", [cycleId]);
  if (!cycle.rows[0]) return res.status(404).json({ error: "Cycle not found" });
  if (cycle.rows[0].status !== "ACTIVE") return res.status(409).json({ error: "Completed cycles are locked" });
  if (!cycle.rows[0].tracking_start_date || todayIso() < String(cycle.rows[0].tracking_start_date)) {
    return res.status(409).json({ error: "Owner must open digital tracking before transferring shares" });
  }
  const tan = await tanConfigForCycle(pool, cycleId);
  if (tan) {
    const tanPeriod = await tanPeriodForDate(pool, cycleId, todayIso());
    if (!tanPeriod || !tanPeriodIsLive(tanPeriod) || !(await tanPreviousPeriodsComplete(pool, tanPeriod))) {
      return res.status(409).json({ error: "Share transfers are available only during the currently open TAN period" });
    }
  }
  const membership = await pool.query(
    `SELECT cm.shares,COALESCE(m.public_member_id,m.member_id) AS "memberCode",m.name
       FROM fund_cycle_members cm JOIN fund_members m ON m.id=cm.member_id
      WHERE cm.cycle_id=$1 AND cm.member_id=$2`,
    [cycleId, fromMemberId],
  );
  if (!membership.rows[0]) return res.status(400).json({ error: "Source member is not enrolled in this cycle" });
  const currentShares = Number(membership.rows[0].shares);
  if (quantity > currentShares) return res.status(400).json({ error: "Transfer quantity cannot exceed the source member's available shares", currentShares });
  const totals = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 AND status='POSTED'),0)::float AS own_paid,
       COALESCE((SELECT SUM(accumulated_value) FROM fund_share_transfers WHERE cycle_id=$1 AND to_member_id=$2),0)::float AS incoming_value,
       COALESCE((SELECT SUM(accumulated_value) FROM fund_share_transfers WHERE cycle_id=$1 AND from_member_id=$2),0)::float AS outgoing_value`,
    [cycleId, fromMemberId],
  );
  const row = totals.rows[0];
  const accumulatedContribution = roundMoney(Math.max(0, money(row.own_paid) + money(row.incoming_value) - money(row.outgoing_value)));
  const transferredContribution = roundMoney(currentShares > 0 ? accumulatedContribution * quantity / currentShares : 0);
  const winner = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM fund_draws WHERE cycle_id=$1 AND winner_member_id=$2 AND status <> 'VOID') AS is_winner",
    [cycleId, fromMemberId],
  );
  return res.json({
    cycleId,
    fromMemberId,
    fromMemberCode: membership.rows[0].memberCode,
    fromMemberName: membership.rows[0].name,
    currentShares,
    transferableShares: currentShares,
    requestedShares: quantity,
    remainingShares: currentShares - quantity,
    accumulatedContribution,
    transferredContribution,
    isWinner: Boolean(winner.rows[0]?.is_winner),
  });
});

router.get("/share-transfers", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (req.query.cycleId) { params.push(Number(req.query.cycleId)); clauses.push(`t.cycle_id=$${params.length}`); }
  if (req.query.memberId) {
    params.push(Number(req.query.memberId));
    clauses.push(`(t.from_member_id=$${params.length} OR t.to_member_id=$${params.length})`);
  }
  if (req.user?.role === "COLLECTOR") {
    params.push(req.user.id);
    clauses.push(`(fm.assigned_collector_id=$${params.length} OR fm.assigned_collector_id IS NULL OR tm.assigned_collector_id=$${params.length} OR tm.assigned_collector_id IS NULL)`);
  }
  const result = req.user?.role === "OWNER"
    ? await pool.query(`${transferSelect} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY t.transfer_date DESC,t.created_at DESC`, params)
    : await pool.query(`${collectorTransferSelect} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY t.transfer_date DESC,t.created_at DESC`, params);
  return res.json(result.rows);
});

router.post("/share-transfers", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  const cycleId = Number(b.cycleId);
  const fromMemberId = Number(b.fromMemberId);
  const toMemberId = Number(b.toMemberId);
  const quantity = Number(b.quantity ?? b.shares);
  const transferDate = isIsoDate(b.transferDate) ? String(b.transferDate) : todayIso();
  const idempotencyKey = idempotency(b.idempotencyKey);
  const overrideWinner = b.overrideWinner === true;
  const settlementAmount = b.settlementAmount === undefined || b.settlementAmount === null || b.settlementAmount === ""
    ? null
    : Number(b.settlementAmount);
  if (!cycleId || !fromMemberId || !toMemberId || fromMemberId === toMemberId || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: "Cycle, different source/receiver members, and a positive whole-number quantity are required" });
  }
  if (settlementAmount !== null && (!Number.isFinite(settlementAmount) || settlementAmount < 0)) {
    return res.status(400).json({ error: "Settlement amount must be zero or greater" });
  }
  if (overrideWinner && b.overrideConfirmation !== true) {
    return res.status(400).json({ error: "Confirm the Owner-only winner override explicitly before saving" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await transactionLock(client, `share-transfer:${req.user!.id}:${idempotencyKey}`);
      const replay = await client.query(`${transferSelect} WHERE t.created_by=$1 AND t.idempotency_key=$2`, [req.user!.id, idempotencyKey]);
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        const requestMatches = Number(existing.cycleId) === cycleId
          && Number(existing.fromMemberId) === fromMemberId
          && Number(existing.toMemberId) === toMemberId
          && Number(existing.shares) === quantity
          && String(existing.transferDate) === transferDate
          && Boolean(existing.overrideWinner) === overrideWinner
          && ((settlementAmount === null && existing.settlementAmount == null) || (settlementAmount !== null && sameMoney(existing.settlementAmount, settlementAmount)));
        if (!requestMatches) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This idempotency key was already used for a different share transfer" });
        }
        await client.query("COMMIT");
        return res.status(200).json(replay.rows[0]);
      }
    }
    const cycle = await client.query(
      "SELECT id,status,tracking_start_date::text AS tracking_start_date,daily_per_share::float AS daily_per_share FROM fund_cycles WHERE id=$1 FOR UPDATE",
      [cycleId],
    );
    if (!cycle.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cycle not found" });
    }
    if (cycle.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Completed cycles are locked" });
    }
    if (!cycle.rows[0].tracking_start_date || todayIso() < String(cycle.rows[0].tracking_start_date)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Owner must open digital tracking before transferring shares" });
    }
    if (transferDate < String(cycle.rows[0].tracking_start_date) || transferDate > todayIso()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Transfer date must be on or after tracking start and not in the future" });
    }
    const tan = await tanConfigForCycle(client, cycleId, true);
    let tanPeriodId: number | null = null;
    if (tan) {
      const tanPeriod = await tanPeriodForDate(client, cycleId, transferDate, true);
      if (!tanPeriod || !tanPeriodIsLive(tanPeriod) || !(await tanPreviousPeriodsComplete(client, tanPeriod))) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Share transfers are available only during the currently open TAN period" });
      }
      tanPeriodId = tanPeriod.periodId;
    }
    const people = await client.query(
      "SELECT id,name,status FROM fund_members WHERE id IN ($1,$2) FOR SHARE",
      [fromMemberId, toMemberId],
    );
    const sourcePerson = people.rows.find((person) => Number(person.id) === fromMemberId);
    const receiverPerson = people.rows.find((person) => Number(person.id) === toMemberId);
    if (!sourcePerson || !receiverPerson) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Source or receiver member not found" });
    }
    if (sourcePerson.status !== "active" || receiverPerson.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Both source and receiver members must be active" });
    }
    const memberships = await client.query(
      `SELECT cm.member_id,cm.shares
         FROM fund_cycle_members cm
        WHERE cm.cycle_id=$1 AND cm.member_id IN ($2,$3)
        ORDER BY cm.member_id
        FOR UPDATE`,
      [cycleId, fromMemberId, toMemberId],
    );
    const sourceMembership = memberships.rows.find((membership) => Number(membership.member_id) === fromMemberId);
    if (!sourceMembership) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Source member is not enrolled in this cycle" });
    }
    if (!memberships.rows.find((membership) => Number(membership.member_id) === toMemberId)) {
      await client.query(
        `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
         VALUES($1,$2,0,0)`,
        [cycleId, toMemberId],
      );
    }
    const sourceShares = Number(sourceMembership.shares);
    const receiverBeforeShares = Number(memberships.rows.find((membership) => Number(membership.member_id) === toMemberId)?.shares ?? 0);
    if (quantity > sourceShares) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Transfer quantity cannot exceed the source member's available shares", currentShares: sourceShares });
    }
    let sourceRemainingEntitlements = sourceShares;
    if (tan) {
      await client.query(
        `INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(tan_config_id,member_id) DO NOTHING`,
        [tan.tanConfigId, cycleId, fromMemberId, sourceShares],
      );
      await client.query(
        `INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
         VALUES($1,$2,$3,0)
         ON CONFLICT(tan_config_id,member_id) DO NOTHING`,
        [tan.tanConfigId, cycleId, toMemberId],
      );
      const entitlementRows = await client.query(
        `SELECT member_id AS "memberId",allocated_entitlements AS "allocatedEntitlements",consumed_entitlements AS "consumedEntitlements"
         FROM fund_tan_member_draw_entitlements
         WHERE tan_config_id=$1 AND member_id IN ($2,$3)
         FOR UPDATE`,
        [tan.tanConfigId, fromMemberId, toMemberId],
      );
      const sourceEntitlement = entitlementRows.rows.find((row) => Number(row.memberId) === fromMemberId);
      sourceRemainingEntitlements = Number(sourceEntitlement?.allocatedEntitlements ?? sourceShares)
        - Number(sourceEntitlement?.consumedEntitlements ?? 0);
      if (quantity > sourceRemainingEntitlements) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Transfer quantity cannot exceed the source member's remaining draw entitlements",
          remainingDrawEntitlements: sourceRemainingEntitlements,
        });
      }
    }
    const winner = await client.query(
      "SELECT EXISTS(SELECT 1 FROM fund_draws WHERE cycle_id=$1 AND winner_member_id=$2 AND status <> 'VOID') AS is_winner",
      [cycleId, fromMemberId],
    );
    const isWinner = Boolean(winner.rows[0]?.is_winner);
    if (isWinner && !overrideWinner) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This member has already won a draw. Use the explicit Owner override to transfer these shares.", winnerTransferBlocked: true });
    }
    if (overrideWinner && !isWinner) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Winner override is only valid when the source member has a recorded draw win" });
    }
    const totals = await client.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 AND status='POSTED'),0)::float AS own_paid,
         COALESCE((SELECT SUM(accumulated_value) FROM fund_share_transfers WHERE cycle_id=$1 AND to_member_id=$2),0)::float AS incoming_value,
         COALESCE((SELECT SUM(accumulated_value) FROM fund_share_transfers WHERE cycle_id=$1 AND from_member_id=$2),0)::float AS outgoing_value`,
      [cycleId, fromMemberId],
    );
    const total = totals.rows[0];
    const accumulatedValue = roundMoney(Math.max(0, money(total.own_paid) + money(total.incoming_value) - money(total.outgoing_value)));
    const shareChange = calculateShareTransfer(sourceShares, receiverBeforeShares, quantity, accumulatedValue);
    const transferredValue = shareChange.transferredValue;
    const transferId = `IRF-TR-${todayIso().replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const transfer = await client.query(
      `INSERT INTO fund_share_transfers(transfer_id,cycle_id,from_member_id,to_member_id,share_quantity,accumulated_value,transfer_date,notes,override_winner,created_by,idempotency_key,tan_period_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [transferId,cycleId,fromMemberId,toMemberId,quantity,transferredValue,transferDate,String(b.notes ?? ""),overrideWinner,req.user!.id,idempotencyKey,tanPeriodId],
    );
    await client.query(
      `UPDATE fund_cycle_members
          SET shares=shares-$3::int,daily_contribution=(shares-$3::int)*$4::numeric
        WHERE cycle_id=$1 AND member_id=$2`,
      [cycleId,fromMemberId,quantity,money(cycle.rows[0].daily_per_share)],
    );
    await client.query(
      `INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
       VALUES($1::int,$2::int,$3::int,$3::int*$4::numeric)
       ON CONFLICT(cycle_id,member_id) DO UPDATE SET
         shares=fund_cycle_members.shares+EXCLUDED.shares,
         daily_contribution=(fund_cycle_members.shares+EXCLUDED.shares)*$4::numeric`,
      [cycleId,toMemberId,quantity,money(cycle.rows[0].daily_per_share)],
    );
    if (tan) {
      await client.query(
        `UPDATE fund_tan_member_draw_entitlements
         SET allocated_entitlements=allocated_entitlements-$3::int,updated_at=now()
         WHERE tan_config_id=$1 AND member_id=$2`,
        [tan.tanConfigId, fromMemberId, quantity],
      );
      await client.query(
        `UPDATE fund_tan_member_draw_entitlements
         SET allocated_entitlements=allocated_entitlements+$3::int,updated_at=now()
         WHERE tan_config_id=$1 AND member_id=$2`,
        [tan.tanConfigId, toMemberId, quantity],
      );
    }
    await client.query(
      `INSERT INTO fund_cycle_member_share_history(cycle_id,member_id,previous_shares,new_shares,effective_date,reason,related_transfer_id,changed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8),($1,$9,$10,$11,$5,$12,$7,$8)`,
      [
        cycleId, fromMemberId, sourceShares, sourceShares - quantity, transferDate, "Share transfer out", transfer.rows[0].id, req.user!.id,
         toMemberId, receiverBeforeShares,
         receiverBeforeShares + quantity, "Share transfer in",
      ],
    );
    if (tan) {
      const totalShares = await client.query(
        "SELECT COALESCE(SUM(shares),0)::int AS total_shares FROM fund_cycle_members WHERE cycle_id=$1",
        [cycleId],
      );
      if (Number(totalShares.rows[0]?.total_shares) !== Number(tan.totalShares)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Share transfer would change the locked TAN total shares; no records were changed" });
      }
    }
    if (settlementAmount !== null) {
      if (settlementAmount > transferredValue) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Settlement amount cannot exceed the transferred accumulated value", transferredValue });
      }
      await client.query(
        `INSERT INTO fund_transfer_settlements(transfer_id,cycle_id,amount,status,approved_by,approved_at,notes,idempotency_key)
         VALUES($1,$2,$3,'APPROVED',$4,now(),$5,$6)`,
        [transfer.rows[0].id,cycleId,settlementAmount,req.user!.id,String(b.settlementNotes ?? b.settlementNote ?? ""),idempotencyKey ? `${idempotencyKey}:settlement` : null],
      );
    }
    const transferKind = quantity === sourceShares ? "FULL" : "PARTIAL";
    await auditOn(
      client,
      req.user!.id,
      overrideWinner ? "SHARE_TRANSFER_OVERRIDE" : "SHARE_TRANSFER_CREATED",
      `${transferId}: ${quantity} shares from member ${fromMemberId} to ${toMemberId}; accumulated value BDT ${transferredValue}`,
      "share_transfer",
      String(transfer.rows[0].id),
      {
        memberId: fromMemberId,
        cycleId,
        relatedTransactionId: transferId,
        reason: String(b.notes ?? `Share transfer ${transferKind.toLowerCase()}`).trim(),
        effectiveDate: transferDate,
        beforeValue: {
          transferKind,
          fromMemberId,
          fromShares: sourceShares,
          toMemberId,
          toShares: receiverBeforeShares,
        },
        afterValue: {
          transferKind,
          fromMemberId,
          fromShares: sourceShares - quantity,
          toMemberId,
          toShares: receiverBeforeShares + quantity,
          sharesTransferred: quantity,
          accumulatedValue: transferredValue,
        },
      },
    );
    await client.query("COMMIT");
    const result = await pool.query(`${transferSelect} WHERE t.id=$1`, [transfer.rows[0].id]);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Share transfer failed");
    return res.status(409).json({ error: "Share transfer could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});

router.post("/share-transfers/:id/settlement", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const transferId = Number(req.params.id);
  const amount = Number(req.body.amount);
  const idempotencyKey = idempotency(req.body.idempotencyKey);
  if (!transferId || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "A settlement amount of zero or greater is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await transactionLock(client, `transfer-settlement:${req.user!.id}:${idempotencyKey}`);
      const replay = await client.query(`${transferSelect} JOIN fund_transfer_settlements existing_settlement ON existing_settlement.transfer_id=t.id WHERE existing_settlement.approved_by=$1 AND existing_settlement.idempotency_key=$2`, [req.user!.id, idempotencyKey]);
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (Number(existing.id) !== transferId || !sameMoney(existing.settlementAmount, amount)) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This idempotency key was already used for a different transfer settlement" });
        }
        await client.query("COMMIT");
        return res.status(200).json(replay.rows[0]);
      }
    }
    const transfer = await client.query(
      `SELECT t.id,t.transfer_id,t.cycle_id,t.from_member_id,t.to_member_id,t.accumulated_value::float AS accumulated_value,
              c.status,c.tracking_start_date::text AS tracking_start_date
         FROM fund_share_transfers t JOIN fund_cycles c ON c.id=t.cycle_id
        WHERE t.id=$1 FOR UPDATE`,
      [transferId],
    );
    if (!transfer.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Share transfer not found" });
    }
    if (amount > money(transfer.rows[0].accumulated_value)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Settlement amount cannot exceed the transferred accumulated value",
        transferredValue: money(transfer.rows[0].accumulated_value),
      });
    }
    if (transfer.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Completed cycles are locked" });
    }
    if (!transfer.rows[0].tracking_start_date || todayIso() < String(transfer.rows[0].tracking_start_date)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Owner must open digital tracking before recording transfer settlement" });
    }
    const existing = await client.query("SELECT id FROM fund_transfer_settlements WHERE transfer_id=$1", [transferId]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A settlement is already recorded for this transfer" });
    }
    const settlement = await client.query(
      `INSERT INTO fund_transfer_settlements(transfer_id,cycle_id,amount,status,approved_by,approved_at,notes,idempotency_key)
       VALUES($1,$2,$3,'APPROVED',$4,now(),$5,$6) RETURNING id`,
      [transferId,transfer.rows[0].cycle_id,amount,req.user!.id,String(req.body.notes ?? ""),idempotencyKey],
    );
    await auditOn(client, req.user!.id, "TRANSFER_SETTLEMENT_APPROVED", `Transfer ${transferId}: BDT ${amount}`, "transfer_settlement", String(settlement.rows[0].id), {
      memberId: transfer.rows[0].from_member_id,
      cycleId: transfer.rows[0].cycle_id,
      relatedTransactionId: transfer.rows[0].transfer_id,
      reason: String(req.body.notes ?? "Transfer settlement approved").trim(),
      beforeValue: { settlement: null, transferId: transfer.rows[0].transfer_id },
      afterValue: {
        settlementId: settlement.rows[0].id,
        transferId: transfer.rows[0].transfer_id,
        amount,
        status: "APPROVED",
        fromMemberId: transfer.rows[0].from_member_id,
        toMemberId: transfer.rows[0].to_member_id,
      },
    });
    await client.query("COMMIT");
    const result = await pool.query(`${transferSelect} WHERE t.id=$1`, [transferId]);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Transfer settlement failed");
    return res.status(409).json({ error: "Transfer settlement could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});

router.get("/draws", requireAuth, async (req, res) => {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (req.query.cycleId) { values.push(Number(req.query.cycleId)); clauses.push(`d.cycle_id=$${values.length}`); }
  if (req.query.memberId) { values.push(Number(req.query.memberId)); clauses.push(`d.winner_member_id=$${values.length}`); }
  if (req.query.date) { values.push(String(req.query.date)); clauses.push(`d.draw_date=$${values.length}`); }
  if (req.query.drawNumber) { values.push(Number(req.query.drawNumber)); clauses.push(`d.draw_number=$${values.length}`); }
  const result = await pool.query(`${drawSelect}
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY d.draw_date DESC,d.draw_number DESC`, values);
  return res.json(result.rows);
});
router.post("/draws/:id/disbursement", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const drawId = Number(req.params.id);
  const payerUserId = Number(req.body?.payerUserId);
  const amount = Number(req.body?.amount);
  const payoutDate = String(req.body?.payoutDate ?? todayIso());
  const reference = String(req.body?.reference ?? "").trim();
  const idempotencyKey = idempotency(req.body?.idempotencyKey);
  if (!Number.isInteger(drawId) || drawId <= 0 || !Number.isInteger(payerUserId) || payerUserId <= 0
    || !Number.isFinite(amount) || amount <= 0 || !isIsoDate(payoutDate) || !reference) {
    return res.status(400).json({ error: "A valid draw, payer, positive amount, payout date, and reference are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `draw-disbursement:${drawId}`);
    if (idempotencyKey) {
      const replay = await client.query(
        `${drawSelect} WHERE pd.payer_user_id=$1 AND pd.idempotency_key=$2`,
        [payerUserId, idempotencyKey],
      );
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (Number(existing.id) !== drawId || !sameMoney(existing.payoutAmount, amount) || String(existing.payoutReference) !== reference) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This idempotency key was already used for a different draw payout" });
        }
        await client.query("COMMIT");
        return res.status(200).json(existing);
      }
    }
    const drawResult = await client.query(
      `SELECT d.id,d.cycle_id,d.draw_date::text AS draw_date,d.winner_member_id,d.winning_amount::float AS winning_amount,d.status,
        c.tracking_start_date::text AS tracking_start_date
       FROM fund_draws d JOIN fund_cycles c ON c.id=d.cycle_id
       WHERE d.id=$1 FOR UPDATE OF d`,
      [drawId],
    );
    const draw = drawResult.rows[0];
    if (!draw) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Draw not found" });
    }
    if (draw.status !== "RECORDED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only a recorded draw can be paid" });
    }
    if (!sameMoney(amount, draw.winning_amount)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Payout amount must equal the draw amount of BDT ${money(draw.winning_amount).toFixed(2)}` });
    }
    if (payoutDate < String(draw.draw_date) || payoutDate > todayIso()
      || (draw.tracking_start_date && payoutDate < String(draw.tracking_start_date))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payout date must be on or after the draw and digital tracking dates, and not in the future" });
    }
    const existingPayout = await client.query(
      "SELECT id,status FROM fund_draw_disbursements WHERE draw_id=$1 AND status='PAID' FOR UPDATE",
      [drawId],
    );
    if (existingPayout.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This draw has already been paid", payoutId: existingPayout.rows[0].id });
    }
    const payer = await client.query(
      "SELECT id,name,role FROM fund_users WHERE id=$1 AND active=true FOR SHARE",
      [payerUserId],
    );
    if (!payer.rows[0] || !isCashCustodyRole(payer.rows[0].role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payer must be an active Owner, Collector, or Cash Receiver" });
    }
    await transactionLock(client, `cash-balance:${payerUserId}:${draw.cycle_id}`);
    const available = await client.query(
      `SELECT GREATEST(
        COALESCE((SELECT SUM(p.amount) FROM fund_payments p
          WHERE COALESCE(p.receiver_id,p.collector_id)=$1 AND p.cycle_id=$2 AND p.status='POSTED'),0)
        + COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
          WHERE h.to_user_id=$1 AND h.cycle_id=$2 AND h.status='ACCEPTED'),0)
         - COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
           WHERE h.from_user_id=$1 AND h.cycle_id=$2 AND h.status IN ('SUBMITTED','ACCEPTED')),0)
        - COALESCE((SELECT SUM(s.amount) FROM fund_settlements s
          WHERE s.collector_id=$1 AND s.cycle_id=$2),0)
        - COALESCE((SELECT SUM(pd.amount) FROM fund_draw_disbursements pd
          WHERE pd.payer_user_id=$1 AND pd.cycle_id=$2 AND pd.status='PAID'),0),
        0)::float AS "availableAmount"`,
      [payerUserId, draw.cycle_id],
    );
    const availableAmount = money(available.rows[0]?.availableAmount);
    if (amount > availableAmount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Payout amount cannot exceed the payer's available custody",
        availableAmount,
      });
    }
    const inserted = await client.query(
      `INSERT INTO fund_draw_disbursements(draw_id,cycle_id,payer_user_id,winner_member_id,amount,payout_date,reference,note,status,created_by,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PAID',$9,$10) RETURNING id`,
      [drawId, draw.cycle_id, payerUserId, draw.winner_member_id, amount, payoutDate, reference, String(req.body?.note ?? "").trim(), req.user!.id, idempotencyKey],
    );
    const payoutId = inserted.rows[0].id;
    await auditOn(client, req.user!.id, "DRAW_PAYOUT_RECORDED", `${reference}: BDT ${amount} paid by ${payer.rows[0].name}`, "draw_disbursement", String(payoutId), {
      cycleId: Number(draw.cycle_id),
      memberId: Number(draw.winner_member_id),
      relatedTransactionId: String(payoutId),
      reason: String(req.body?.note ?? "Draw payout recorded").trim(),
      effectiveDate: payoutDate,
      afterValue: { payoutId, drawId, payerUserId, winnerMemberId: draw.winner_member_id, amount, status: "PAID", reference },
    });
    const result = await client.query(`${drawSelect} WHERE d.id=$1`, [drawId]);
    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Draw payout failed");
    return res.status(409).json({ error: "Draw payout could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});
router.post("/draw-disbursements/:id/reverse", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const payoutId = Number(req.params.id);
  const reason = String(req.body?.reason ?? "").trim();
  if (!Number.isInteger(payoutId) || payoutId <= 0 || !reason) {
    return res.status(400).json({ error: "A valid payout and reversal reason are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `draw-disbursement-decision:${payoutId}`);
    const current = await client.query(
      `SELECT pd.id,pd.draw_id AS "drawId",pd.cycle_id AS "cycleId",pd.payer_user_id AS "payerUserId",
        pd.status,pd.amount::float,pd.reference,d.winner_member_id AS "winnerMemberId"
       FROM fund_draw_disbursements pd JOIN fund_draws d ON d.id=pd.draw_id
       WHERE pd.id=$1 FOR UPDATE OF pd`,
      [payoutId],
    );
    const payout = current.rows[0];
    if (!payout) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Draw payout not found" });
    }
    if (payout.status === "REVERSED") {
      const result = await client.query(`${drawSelect} WHERE d.id=$1`, [payout.drawId]);
      await client.query("COMMIT");
      return res.status(200).json(result.rows[0]);
    }
    await transactionLock(client, `cash-balance:${payout.payerUserId}:${payout.cycleId}`);
    await client.query(
      "UPDATE fund_draw_disbursements SET status='REVERSED',reversed_by=$2,reversed_at=now(),reversal_reason=$3 WHERE id=$1",
      [payoutId, req.user!.id, reason],
    );
    await auditOn(client, req.user!.id, "DRAW_PAYOUT_REVERSED", `${payout.reference}: BDT ${payout.amount} payout reversed`, "draw_disbursement", String(payoutId), {
      memberId: Number(payout.winnerMemberId),
      cycleId: Number(payout.cycleId),
      relatedTransactionId: String(payoutId),
      reason,
      beforeValue: { payoutId, drawId: payout.drawId, amount: money(payout.amount), status: "PAID" },
      afterValue: { payoutId, drawId: payout.drawId, amount: money(payout.amount), status: "REVERSED", reason },
    });
    const result = await client.query(`${drawSelect} WHERE d.id=$1`, [payout.drawId]);
    await client.query("COMMIT");
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Draw payout reversal failed");
    return res.status(409).json({ error: "Draw payout could not be reversed; no records were changed" });
  } finally {
    client.release();
  }
});
router.post("/draws", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  const cycleId = Number(b.cycleId);
  const winnerMemberId = Number(b.winnerMemberId);
  const drawDate = String(b.drawDate ?? "");
  const requestedDrawSlot = b.drawSlot === undefined || b.drawSlot === null || b.drawSlot === "" ? null : Number(b.drawSlot);
  const idempotencyKey = idempotency(b.idempotencyKey);
  const status = String(b.status ?? "RECORDED");
  if (!cycleId || !winnerMemberId || !isIsoDate(drawDate) || Number(b.winningAmount) <= 0) {
    return res.status(400).json({ error: "Cycle, winner, draw date and positive winning amount are required" });
  }
  if (!isFriday(drawDate)) return res.status(400).json({ error: "Draw date must be a Friday" });
  if (drawDate > todayIso()) return res.status(400).json({ error: "Draw date cannot be in the future" });
  if (!validStatus(status, ["RECORDED", "VOID"])) return res.status(400).json({ error: "Invalid draw status" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await transactionLock(client, `draw:${cycleId}:${idempotencyKey}`);
      const replay = await client.query(`${drawSelect} WHERE d.cycle_id=$1 AND d.idempotency_key=$2`, [cycleId, idempotencyKey]);
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (Number(existing.winnerMemberId) !== winnerMemberId
          || String(existing.drawDate) !== drawDate
          || !sameMoney(existing.winningAmount, b.winningAmount)
          || String(existing.status) !== status) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This idempotency key was already used for a different draw" });
        }
        await client.query("COMMIT");
        return res.status(200).json(replay.rows[0]);
      }
    }
    const cycle = await client.query("SELECT status,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE id=$1 FOR UPDATE", [cycleId]);
    if (!cycle.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cycle not found" });
    }
    if (cycle.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Completed cycles are locked" });
    }
    if (!cycle.rows[0].tracking_start_date || drawDate < cycle.rows[0].tracking_start_date) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Draw date cannot be before the digital tracking start" });
    }
    const tan = await tanConfigForCycle(client, cycleId, true);
    let tanPeriodId: number | null = null;
    let drawSlot = requestedDrawSlot;
    let entitlementId: number | null = null;
    let entitlementNumber: number | null = null;
    if (tan) {
      const tanPeriod = await tanPeriodForDate(client, cycleId, drawDate, true);
      if (!tanPeriod || !tanPeriodIsLive(tanPeriod) || drawDate !== todayIso() || !isFriday(drawDate)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "TAN draws can only be recorded on the currently open period's Friday" });
      }
      if (!(await tanPreviousPeriodsComplete(client, tanPeriod))) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Complete the previous TAN draw-date before recording this draw" });
      }
      if (status !== "RECORDED" || !sameMoney(b.winningAmount, tan.perDrawWinnerAmount)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `TAN winner amount is locked at BDT ${money(tan.perDrawWinnerAmount).toFixed(2)}` });
      }
      if (drawSlot === null) {
        const nextSlot = await client.query("SELECT COALESCE(MAX(draw_slot),0)+1 AS slot FROM fund_draws WHERE tan_period_id=$1 AND status <> 'VOID'", [tanPeriod.periodId]);
        drawSlot = Number(nextSlot.rows[0].slot);
      }
      if (!Number.isInteger(drawSlot) || drawSlot < 1 || drawSlot > Number(tan.drawsPerWeek)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Draw slot must be between 1 and ${tan.drawsPerWeek}` });
      }
      tanPeriodId = tanPeriod.periodId;
    }
    const membership = await client.query("SELECT 1 FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2", [cycleId,winnerMemberId]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Winner must participate in the selected cycle" });
    }
    if (tan && status === "RECORDED") {
      await client.query(
        `INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
         SELECT $1,cm.cycle_id,cm.member_id,cm.shares
         FROM fund_cycle_members cm
         WHERE cm.cycle_id=$2 AND cm.member_id=$3
         ON CONFLICT(tan_config_id,member_id) DO NOTHING`,
        [tan.tanConfigId, cycleId, winnerMemberId],
      );
      const entitlement = await client.query(
        `SELECT id,allocated_entitlements AS "allocatedEntitlements",consumed_entitlements AS "consumedEntitlements"
         FROM fund_tan_member_draw_entitlements
         WHERE tan_config_id=$1 AND member_id=$2
         FOR UPDATE`,
        [tan.tanConfigId, winnerMemberId],
      );
      if (!entitlement.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Draw entitlement ledger is not initialized for this member" });
      }
      const allocated = Number(entitlement.rows[0].allocatedEntitlements);
      const consumed = Number(entitlement.rows[0].consumedEntitlements);
      if (consumed >= allocated) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "This member has used all draw entitlements for the current TAN",
          totalDrawEntitlements: allocated,
          usedDrawEntitlements: consumed,
          remainingDrawEntitlements: 0,
        });
      }
      entitlementId = Number(entitlement.rows[0].id);
      entitlementNumber = consumed + 1;
    }
    const next = await client.query("SELECT COALESCE(MAX(draw_number),0)+1 AS number FROM fund_draws WHERE cycle_id=$1", [cycleId]);
    const result = await client.query(`INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes,idempotency_key,tan_period_id,draw_slot,entitlement_id,entitlement_number)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,cycle_id AS "cycleId",draw_number AS "drawNumber",draw_date::text AS "drawDate",
      winner_member_id AS "winnerMemberId",winning_amount::float AS "winningAmount",status,notes,created_at AS "createdAt",
      tan_period_id AS "tanPeriodId",draw_slot AS "drawSlot",entitlement_id AS "entitlementId",entitlement_number AS "entitlementNumber"`,
      [cycleId,Number(next.rows[0].number),drawDate,winnerMemberId,Number(b.winningAmount),status,b.notes ?? "",idempotencyKey,tanPeriodId,drawSlot,entitlementId,entitlementNumber]);
    if (entitlementId) {
      await client.query(
        "UPDATE fund_tan_member_draw_entitlements SET consumed_entitlements=consumed_entitlements+1,updated_at=now() WHERE id=$1",
        [entitlementId],
      );
    }
    if (tanPeriodId) {
      const tanPeriod = await client.query("SELECT tan_config_id,sequence_no FROM fund_tan_periods WHERE id=$1 FOR UPDATE", [tanPeriodId]);
      const count = await client.query("SELECT COUNT(*)::int AS count FROM fund_draws WHERE tan_period_id=$1 AND status='RECORDED'", [tanPeriodId]);
      if (Number(count.rows[0].count) === Number(tan.drawsPerWeek)) {
        await client.query("UPDATE fund_tan_periods SET status='COMPLETED',completed_by=$2,completed_at=now() WHERE id=$1", [tanPeriodId, req.user!.id]);
        const remaining = await client.query("SELECT COUNT(*)::int AS count FROM fund_tan_periods WHERE tan_config_id=$1 AND status <> 'COMPLETED'", [tanPeriod.rows[0].tan_config_id]);
        if (Number(remaining.rows[0].count) === 0) {
          await client.query("UPDATE fund_tan_configs SET status='COMPLETED',completed_by=$2,completed_at=now() WHERE id=$1", [tanPeriod.rows[0].tan_config_id, req.user!.id]);
        }
      }
    }
    await auditOn(client, req.user!.id, "DRAW_RECORDED", `Recorded draw #${result.rows[0].drawNumber} for cycle ${cycleId}`, "draw", String(result.rows[0].id));
     await client.query("COMMIT");
     const fullDraw = await pool.query(`${drawSelect} WHERE d.id=$1`, [result.rows[0].id]);
     return res.status(201).json(fullDraw.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Draw creation failed");
    return res.status(409).json({ error: "Could not record draw; no records were changed" });
  } finally {
    client.release();
  }
});

router.get("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
  const params: unknown[] = [Number(activeCycle.rows[0]?.id ?? 0)];
  const clauses = ["p.cycle_id=$1"];
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); clauses.push(`COALESCE(p.receiver_id,p.collector_id)=$${params.length}`); }
  const r = await pool.query(
    `SELECT p.id,p.receipt_id AS "receiptId",COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name AS "memberName",p.cycle_id AS "cycleId",
       p.collection_date::text AS "collectionDate",p.shares,p.notes,p.amount::float,
       u.name AS "collectorName",ru.name AS "receiverName",p.receipt_source AS "receiptSource",
       p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status
      FROM fund_payments p JOIN fund_members m ON m.id=p.member_id
        LEFT JOIN fund_users u ON u.id=p.collector_id
       LEFT JOIN fund_users ru ON ru.id=COALESCE(p.receiver_id,p.collector_id)
      WHERE ${clauses.join(" AND ")} ORDER BY p.created_at DESC LIMIT 500`, params);
  res.json(r.rows);
});
router.post("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const { memberId, cycleId, collectionDate, amount, notes, verificationMethod, confirmDuplicate } = req.body;
  if (!req.user || !isCashCustodyRole(req.user.role)) {
    res.status(403).json({ error: "This account cannot receive payments" });
    return;
  }
  const idempotencyKey = idempotency(req.body.idempotencyKey);
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });
  const selectedCycleId = Number(cycleId);
  if (!selectedCycleId) return res.status(400).json({ error: "An active cycle is required for every payment" });
  const paidDate = isIsoDate(collectionDate) ? collectionDate : todayIso();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await transactionLock(client, `payment:${req.user!.id}:${idempotencyKey}`);
       const replay = await client.query(`SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "_memberDbId",COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name AS "memberName",p.cycle_id AS "cycleId",p.collection_date::text AS "collectionDate",p.shares,p.notes,p.amount::float,p.previous_due_applied::float AS "previousDueApplied",p.current_period_applied::float AS "currentPeriodApplied",u.name AS "collectorName",ru.name AS "receiverName",p.receipt_source AS "receiptSource",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id LEFT JOIN fund_users u ON u.id=p.collector_id LEFT JOIN fund_users ru ON ru.id=COALESCE(p.receiver_id,p.collector_id) WHERE COALESCE(p.receiver_id,p.collector_id)=$1 AND p.idempotency_key=$2`, [req.user!.id,idempotencyKey]);
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (Number(existing._memberDbId) !== Number(memberId)
          || Number(existing.cycleId) !== selectedCycleId
          || String(existing.collectionDate) !== paidDate
          || !sameMoney(existing.amount, amount)) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "This idempotency key was already used for a different payment" });
        }
        await client.query("COMMIT");
        delete existing._memberDbId;
        return res.status(200).json(replay.rows[0]);
      }
    }
    const cycle = await client.query("SELECT id,status,daily_per_share::float AS daily_per_share,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE id=$1 FOR UPDATE", [selectedCycleId]);
    if (!cycle.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Selected cycle not found" });
    }
    if (cycle.rows[0].status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Payments can only be recorded in an active cycle" });
    }
    if (!cycle.rows[0].tracking_start_date) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Owner must set the digital tracking start date before collection begins" });
    }
    if (paidDate < cycle.rows[0].tracking_start_date || paidDate > todayIso()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Collection date must be on or after the digital tracking start and not in the future" });
    }
    const tan = await tanConfigForCycle(client, selectedCycleId, true);
    let tanPeriodId: number | null = null;
    let tanPeriod: TanPeriodRow | null = null;
    if (tan) {
      tanPeriod = await tanPeriodForDate(client, selectedCycleId, paidDate, true);
      if (!tanPeriod || !tanPeriodIsLive(tanPeriod) || !(await tanPreviousPeriodsComplete(client, tanPeriod))) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Payments can only be recorded during the currently open TAN period" });
      }
      tanPeriodId = tanPeriod.periodId;
    }
    const duplicate = await client.query("SELECT 1 FROM fund_payments WHERE member_id=$1 AND cycle_id=$2 AND collection_date=$3 AND status='POSTED' LIMIT 1", [memberId, selectedCycleId, paidDate]);
    if (duplicate.rowCount && !confirmDuplicate) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A payment already exists today. Confirm to add another or partial payment." });
    }
    const member = await client.query(
      "SELECT id,name,assigned_collector_id FROM fund_members WHERE id=$1 AND status='active' FOR SHARE",
      [memberId],
    );
    if (!member.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Active member not found" });
    }
    if (
      req.user?.role === "COLLECTOR"
      && member.rows[0].assigned_collector_id !== null
      && Number(member.rows[0].assigned_collector_id) !== req.user.id
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Collector is not assigned to this member" });
    }
    const expectedVerification = req.user.role === "OWNER"
      ? "OWNER_CONFIRMATION"
      : req.user.role === "CASH_RECEIVER"
        ? "CASH_RECEIVER_CONFIRMATION"
        : "COLLECTOR_CONFIRMATION";
    if (verificationMethod === "PIN") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "PIN verification is not configured; use collector confirmation" });
    }
    if (String(verificationMethod ?? "") !== expectedVerification) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Use ${expectedVerification} for this receiver account` });
    }
    const cycleMember = await client.query("SELECT shares,daily_contribution::float AS daily_contribution FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2 FOR SHARE", [selectedCycleId,Number(memberId)]);
    if (!cycleMember.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Member is not enrolled in the selected cycle" });
    }
    const tanDue = tan ? await tanDueForMembers(client, selectedCycleId, tanPeriod) : null;
    const previousDueOutstanding = tan
      ? money(tanDue?.get(Number(memberId))?.previousDue)
      : money((await client.query(
        `SELECT GREATEST(COALESCE((SELECT SUM(amount) FROM fund_due_entries WHERE cycle_id=$1 AND member_id=$2),0)
          - COALESCE((SELECT SUM(previous_due_applied) FROM fund_payments WHERE cycle_id=$1 AND member_id=$2 AND status='POSTED'),0),0)::float AS previous_due`,
        [selectedCycleId, memberId],
      )).rows[0]?.previous_due);
    const allocation = allocatePayment(Number(amount), previousDueOutstanding);
    const { previousDueApplied, currentPeriodApplied } = allocation;
    const receiptId = `IRF-${paidDate.replaceAll("-","")}-${randomBytes(3).toString("hex").toUpperCase()}`;
     const receiptSource = req.user.role === "OWNER" ? "OWNER_DIRECT" : req.user.role === "CASH_RECEIVER" ? "CASH_RECEIVER_DIRECT" : "COLLECTOR";
     const collectorId = req.user.role === "COLLECTOR" ? req.user.id : null;
    const verification = req.user.role === "OWNER"
      ? "OWNER CONFIRMED"
      : req.user.role === "CASH_RECEIVER"
        ? "CASH RECEIVER CONFIRMED"
        : "COLLECTOR CONFIRMED";
    const r = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,receiver_id,receipt_source,verification_status,notes,idempotency_key,previous_due_applied,current_period_applied,tan_period_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,receipt_id AS "receiptId",member_id AS "memberId",cycle_id AS "cycleId",collection_date::text AS "collectionDate",shares,notes,amount::float,previous_due_applied::float AS "previousDueApplied",current_period_applied::float AS "currentPeriodApplied",verification_status AS "verificationStatus",created_at AS "createdAt",status`,
       [receiptId,memberId,selectedCycleId,paidDate,Number(cycleMember.rows[0].shares),amount,collectorId,req.user.id,receiptSource,verification,notes ?? "",idempotencyKey ?? null,previousDueApplied,currentPeriodApplied,tanPeriodId],
    );
    await auditOn(client, req.user.id, "PAYMENT_POSTED", `${receiptId}: BDT ${amount}; previous due ${previousDueApplied}; receiver ${req.user.role}`, "payment", String(r.rows[0].id));
    await client.query("COMMIT");
    return res.status(201).json({
      ...r.rows[0],
      memberName: member.rows[0].name,
       collectorName: req.user.role === "COLLECTOR" ? req.user.name : null,
      receiverName: req.user.name,
      receiptSource,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Payment failed");
    return res.status(409).json({ error: "Payment could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});
router.post("/payments/:id/reverse", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `reversal:${req.params.id}`);
    const original = await client.query("SELECT * FROM fund_payments WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!original.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Payment not found" });
    }
    const o = original.rows[0];
    if (o.status === "REVERSED") {
      const existing = await client.query("SELECT * FROM fund_payments WHERE reversed_payment_id=$1", [o.id]);
      await client.query("COMMIT");
      return res.json(existing.rows[0] ?? o);
    }
    if (o.status !== "POSTED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only a posted payment can be reversed" });
    }
    const reason = String(req.body.reason ?? "").trim();
    if (!reason) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "A reversal reason is required" });
    }
    await client.query("UPDATE fund_payments SET status='REVERSED',correction_reason=$2 WHERE id=$1", [o.id, reason]);
    const r = await client.query(
      `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,receiver_id,receipt_source,verification_status,status,reversed_payment_id,correction_reason,previous_due_applied,current_period_applied)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OWNER REVERSAL','REVERSAL',$10,$11,$12,$13)
        RETURNING id,receipt_id AS "receiptId",member_id AS "memberId",cycle_id AS "cycleId",amount::float,verification_status AS "verificationStatus",created_at AS "createdAt",status`,
      [`REV-${o.receipt_id}`,o.member_id,o.cycle_id,o.collection_date,o.shares,o.amount,o.collector_id,o.receiver_id,o.receipt_source,o.id,reason,o.previous_due_applied ?? 0,o.current_period_applied ?? 0]);
    await auditOn(client, req.user!.id, "PAYMENT_REVERSED", `${o.receipt_id}: ${reason}`, "payment", String(o.id), {
      memberId: o.member_id,
      cycleId: o.cycle_id,
      relatedTransactionId: o.receipt_id,
      reason,
      effectiveDate: String(o.collection_date),
      beforeValue: {
        paymentId: o.id,
        receiptId: o.receipt_id,
        status: o.status,
        amount: money(o.amount),
        previousDueApplied: money(o.previous_due_applied),
        currentPeriodApplied: money(o.current_period_applied),
      },
      afterValue: {
        reversalPaymentId: r.rows[0].id,
        receiptId: r.rows[0].receiptId,
        originalStatus: "REVERSED",
        reversalStatus: r.rows[0].status,
        amount: money(r.rows[0].amount),
        previousDueApplied: money(o.previous_due_applied),
        currentPeriodApplied: money(o.current_period_applied),
      },
    });
    const names = await client.query("SELECT m.name AS member,u.name AS collector,ru.name AS receiver FROM fund_members m LEFT JOIN fund_users u ON u.id=$2 LEFT JOIN fund_users ru ON ru.id=$3 WHERE m.id=$1", [o.member_id,o.collector_id,o.receiver_id ?? o.collector_id]);
    await client.query("COMMIT");
    return res.json({ ...r.rows[0], memberName: names.rows[0].member, collectorName: names.rows[0].collector ?? null, receiverName: names.rows[0].receiver ?? null });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Payment reversal failed");
    return res.status(409).json({ error: "Payment reversal could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});

router.get("/settlements", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[]=[]; const clauses=["s.cycle_id=(SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1)"];
  if(req.user?.role==="COLLECTOR"){params.push(req.user.id);clauses.push(`s.collector_id=$${params.length}`);}
  const r=await pool.query(`SELECT s.id,s.cycle_id AS "cycleId",s.amount::float,u.name AS "collectorName",s.reference,s.created_at AS "createdAt" FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id WHERE ${clauses.join(" AND ")} ORDER BY s.created_at DESC`,params);
  res.json(r.rows);
});
router.post("/settlements", requireAuth, async (req: AuthedRequest,res)=>{
  const b=req.body;
  const settlementAmount = Number(b.amount);
  const reference = String(b.reference ?? "").trim();
  const idempotencyKey = idempotency(b.idempotencyKey);
  if (!Number.isFinite(settlementAmount) || settlementAmount <= 0 || !reference) return res.status(400).json({error:"A positive settlement amount and reference are required"});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await transactionLock(client, `settlement:${req.user!.id}:${idempotencyKey}`);
      const replay=await client.query(`SELECT s.id,s.cycle_id AS "cycleId",s.amount::float,u.name AS "collectorName",s.reference,s.created_at AS "createdAt" FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id WHERE s.collector_id=$1 AND s.idempotency_key=$2`,[req.user!.id,idempotencyKey]);
      if(replay.rows[0]) {
        if (!sameMoney(replay.rows[0].amount, settlementAmount) || String(replay.rows[0].reference) !== reference) {
          await client.query("ROLLBACK");
          return res.status(409).json({error:"This idempotency key was already used for a different settlement"});
        }
        await client.query("COMMIT");
        return res.status(200).json(replay.rows[0]);
      }
    }
    const activeCycle=await client.query("SELECT id,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE status='ACTIVE' LIMIT 1 FOR UPDATE");
    if(!activeCycle.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({error:"An active cycle is required before recording a settlement"});
    }
    if(!activeCycle.rows[0].tracking_start_date) {
      await client.query("ROLLBACK");
      return res.status(409).json({error:"Owner must set the digital tracking start date before recording settlements"});
    }
    await transactionLock(client, `cash-balance:${req.user!.id}:${activeCycle.rows[0].id}`);
    const availableCash = await client.query(
      `SELECT GREATEST(
         COALESCE((SELECT SUM(amount) FROM fund_payments
                   WHERE collector_id=$1 AND cycle_id=$2 AND status='POSTED'),0)
          - COALESCE((SELECT SUM(amount) FROM fund_settlements
                      WHERE collector_id=$1 AND cycle_id=$2),0)
          - COALESCE((SELECT SUM(amount) FROM fund_draw_disbursements
                      WHERE payer_user_id=$1 AND cycle_id=$2 AND status='PAID'),0),
         0
       )::float AS "availableAmount"`,
      [req.user!.id, activeCycle.rows[0].id],
    );
    const availableAmount = money(availableCash.rows[0]?.availableAmount);
    if (settlementAmount > availableAmount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Settlement amount cannot exceed the collector's unsettled posted collections",
        availableAmount,
      });
    }
     const r=await client.query(`INSERT INTO fund_settlements(collector_id,cycle_id,amount,reference,note,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,cycle_id AS "cycleId",amount::float,reference,created_at AS "createdAt"`,[req.user!.id,activeCycle.rows[0].id,settlementAmount,reference,b.note??"",idempotencyKey]);
      await auditOn(client, req.user!.id,"SETTLEMENT_CREATED",`${reference}: BDT ${settlementAmount}`,"settlement",String(r.rows[0].id), {
        cycleId: activeCycle.rows[0].id,
        relatedTransactionId: reference,
        reason: String(b.note ?? "Collector settlement created").trim(),
        afterValue: {
          settlementId: r.rows[0].id,
          amount: settlementAmount,
          reference,
          status: "RECORDED",
        },
      });
    await client.query("COMMIT");
    return res.status(201).json({...r.rows[0],collectorName:req.user!.name});
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Settlement failed");
    return res.status(409).json({error:"Settlement could not be saved; no records were changed"});
  } finally {
    client.release();
  }
});

router.get("/cash-handovers", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[] = [];
  const clauses = ["h.cycle_id=(SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1)"];
  if (req.user?.role === "COLLECTOR") {
    params.push(req.user.id);
    clauses.push(`h.from_user_id=$${params.length}`);
  } else if (req.user?.role === "CASH_RECEIVER") {
    params.push(req.user.id);
    clauses.push(`(h.from_user_id=$${params.length} OR h.to_user_id=$${params.length})`);
  }
  const result = await pool.query(
    `${cashHandoverSelect} WHERE ${clauses.join(" AND ")} ORDER BY h.created_at DESC LIMIT 300`,
    params,
  );
  res.json(result.rows);
});

router.get("/cash-handover-recipients", requireAuth, async (_req, res) => {
  const result = await pool.query(
    "SELECT id,name,username,role,active FROM fund_users WHERE active=true AND role IN ('OWNER','CASH_RECEIVER') ORDER BY CASE WHEN role='OWNER' THEN 0 ELSE 1 END,name",
  );
  res.json(result.rows);
});

router.get("/cash-custody/balances", requireAuth, async (req: AuthedRequest, res) => {
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
  const cycleId = Number(activeCycle.rows[0]?.id ?? 0);
  if (!cycleId) {
    res.json([]);
    return;
  }
  const result = await pool.query(
    `SELECT u.id AS "userId",u.name,u.role,
      COALESCE((SELECT SUM(p.amount) FROM fund_payments p
        WHERE COALESCE(p.receiver_id,p.collector_id)=u.id AND p.cycle_id=$1 AND p.status='POSTED'),0)::float AS "postedPayments",
      COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
        WHERE h.to_user_id=u.id AND h.cycle_id=$1 AND h.status='ACCEPTED'),0)::float AS "acceptedIncoming",
       (COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
         WHERE h.from_user_id=u.id AND h.cycle_id=$1 AND h.status='ACCEPTED'),0)
        + COALESCE((SELECT SUM(s.amount) FROM fund_settlements s
         WHERE s.collector_id=u.id AND s.cycle_id=$1),0)
        + COALESCE((SELECT SUM(pd.amount) FROM fund_draw_disbursements pd
         WHERE pd.payer_user_id=u.id AND pd.cycle_id=$1 AND pd.status='PAID'),0))::float AS "acceptedOutgoing",
       COALESCE((SELECT SUM(pd.amount) FROM fund_draw_disbursements pd
         WHERE pd.payer_user_id=u.id AND pd.cycle_id=$1 AND pd.status='PAID'),0)::float AS "drawPayouts",
      GREATEST(
        COALESCE((SELECT SUM(p.amount) FROM fund_payments p
          WHERE COALESCE(p.receiver_id,p.collector_id)=u.id AND p.cycle_id=$1 AND p.status='POSTED'),0)
        + COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
          WHERE h.to_user_id=u.id AND h.cycle_id=$1 AND h.status='ACCEPTED'),0)
          - COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
           WHERE h.from_user_id=u.id AND h.cycle_id=$1 AND h.status IN ('SUBMITTED','ACCEPTED')),0)
         - COALESCE((SELECT SUM(s.amount) FROM fund_settlements s
           WHERE s.collector_id=u.id AND s.cycle_id=$1),0)
         - COALESCE((SELECT SUM(pd.amount) FROM fund_draw_disbursements pd
           WHERE pd.payer_user_id=u.id AND pd.cycle_id=$1 AND pd.status='PAID'),0),0)::float AS "availableAmount"
     FROM fund_users u
     WHERE u.active=true AND u.role IN ('OWNER','COLLECTOR','CASH_RECEIVER')
       AND ($2::int IS NULL OR u.id=$2)
     ORDER BY CASE WHEN u.role='OWNER' THEN 0 WHEN u.role='CASH_RECEIVER' THEN 1 ELSE 2 END,u.name`,
    [cycleId, req.user?.role === "COLLECTOR" || req.user?.role === "CASH_RECEIVER" ? req.user.id : null],
  );
  res.json(result.rows);
});

router.get("/collector-targets", requireAuth, async (req: AuthedRequest, res) => {
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1");
  const cycleId = Number(activeCycle.rows[0]?.id ?? 0);
  if (!cycleId) {
    res.json([]);
    return;
  }
  const businessDate = todayIso();
  const tanPeriod = await tanPeriodForDate(pool, cycleId, businessDate);
  const { periodStart, periodEnd } = tanPeriod ?? saturdayWeekBounds(businessDate);
  const params: unknown[] = [cycleId, periodStart, periodEnd];
  const clauses = ["u.active=true", "u.role='COLLECTOR'"];
  if (req.user?.role === "COLLECTOR") {
    params.push(req.user.id);
    clauses.push(`u.id=$${params.length}`);
  }
  const result = await pool.query(
    `SELECT COALESCE(t.id,0)::int AS id,
      $1::int AS "cycleId",u.id AS "collectorId",u.name AS "collectorName",
      COALESCE(t.target_amount,0)::float AS "targetAmount",
      $2::date::text AS "periodStart",$3::date::text AS "periodEnd",
      COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
        WHERE h.cycle_id=$1 AND h.from_user_id=u.id AND h.status='ACCEPTED'
          AND h.collection_date BETWEEN $2::date AND $3::date),0)::float AS "acceptedAmount",
      COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
        WHERE h.cycle_id=$1 AND h.from_user_id=u.id AND h.status='SUBMITTED'
          AND h.collection_date BETWEEN $2::date AND $3::date),0)::float AS "pendingAmount"
     FROM fund_users u
     LEFT JOIN fund_collector_weekly_targets t
       ON t.cycle_id=$1 AND t.collector_id=u.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY u.name`,
    params,
  );
  res.json(result.rows.map((row) => {
    const targetAmount = money(row.targetAmount);
    const acceptedAmount = money(row.acceptedAmount);
    return {
      ...row,
      targetAmount,
      acceptedAmount,
      pendingAmount: money(row.pendingAmount),
      remainingAmount: Math.max(0, targetAmount - acceptedAmount),
      isAchieved: targetAmount > 0 && acceptedAmount >= targetAmount,
    };
  }));
});

router.post("/collector-targets", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body as Record<string, unknown>;
  const collectorId = Number(b.collectorId);
  const targetAmount = Number(b.targetAmount);
  if (!Number.isInteger(collectorId) || collectorId <= 0 || !Number.isFinite(targetAmount) || targetAmount < 0) {
    res.status(400).json({ error: "A valid collector and non-negative weekly target are required" });
    return;
  }
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1");
  const cycleId = Number(activeCycle.rows[0]?.id ?? 0);
  if (!cycleId) {
    res.status(409).json({ error: "Create an active cycle before setting a collector target" });
    return;
  }
  const collector = await pool.query(
    "SELECT id,name FROM fund_users WHERE id=$1 AND role='COLLECTOR' AND active=true",
    [collectorId],
  );
  if (!collector.rows[0]) {
    res.status(400).json({ error: "The selected user is not an active Collector" });
    return;
  }
  const result = await pool.query(
    `INSERT INTO fund_collector_weekly_targets(cycle_id,collector_id,target_amount,set_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(cycle_id,collector_id)
     DO UPDATE SET target_amount=EXCLUDED.target_amount,set_by=EXCLUDED.set_by,updated_at=now()
     RETURNING id,cycle_id AS "cycleId",collector_id AS "collectorId",target_amount::float AS "targetAmount"`,
    [cycleId, collectorId, targetAmount, req.user!.id],
  );
  await auditOn(pool, req.user!.id, "COLLECTOR_TARGET_UPDATED", `Weekly target for ${collector.rows[0].name}: BDT ${targetAmount}`, "collector_target", String(result.rows[0].id), {
    cycleId,
    afterValue: { collectorId, targetAmount },
  });
  const businessDate = todayIso();
  const tanPeriod = await tanPeriodForDate(pool, cycleId, businessDate);
  const { periodStart, periodEnd } = tanPeriod ?? saturdayWeekBounds(businessDate);
  const progress = await pool.query(
    `SELECT
      COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h WHERE h.cycle_id=$1 AND h.from_user_id=$2 AND h.status='ACCEPTED' AND h.collection_date BETWEEN $3::date AND $4::date),0)::float AS "acceptedAmount",
      COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h WHERE h.cycle_id=$1 AND h.from_user_id=$2 AND h.status='SUBMITTED' AND h.collection_date BETWEEN $3::date AND $4::date),0)::float AS "pendingAmount"`,
    [cycleId, collectorId, periodStart, periodEnd],
  );
  const acceptedAmount = money(progress.rows[0].acceptedAmount);
  return res.json({
    id: Number(result.rows[0].id),
    cycleId,
    collectorId,
    collectorName: collector.rows[0].name,
    targetAmount,
    periodStart,
    periodEnd,
    acceptedAmount,
    pendingAmount: money(progress.rows[0].pendingAmount),
    remainingAmount: Math.max(0, targetAmount - acceptedAmount),
    isAchieved: targetAmount > 0 && acceptedAmount >= targetAmount,
  });
});

router.post("/cash-handovers", requireAuth, async (req: AuthedRequest, res) => {
  if (!req.user || !["COLLECTOR", "CASH_RECEIVER"].includes(req.user.role)) {
    res.status(403).json({ error: "Only a Collector or Cash Receiver can submit a cash handover" });
    return;
  }
  const b = req.body as Record<string, unknown>;
  const toUserId = Number(b.toUserId);
  const amount = Number(b.amount);
  const collectionDate = isIsoDate(b.collectionDate) ? b.collectionDate : todayIso();
  const reference = String(b.reference ?? "").trim();
  const receiptCount = b.receiptCount == null ? 0 : Number(b.receiptCount);
  const idempotencyKey = idempotency(b.idempotencyKey);
  if (!Number.isInteger(toUserId) || toUserId <= 0 || !Number.isFinite(amount) || amount <= 0 || !reference) {
    res.status(400).json({ error: "A valid receiver, positive amount, and reference are required" });
    return;
  }
  if (!Number.isInteger(receiptCount) || receiptCount < 0) {
    res.status(400).json({ error: "Receipt count must be a whole number" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockScope = `cash-handover:${req.user.id}:${idempotencyKey ?? `${toUserId}:${reference}`}`;
    await transactionLock(client, lockScope);
    if (idempotencyKey) {
      const replay = await client.query(`${cashHandoverSelect} WHERE h.from_user_id=$1 AND h.idempotency_key=$2`, [req.user.id, idempotencyKey]);
      if (replay.rows[0]) {
        const existing = replay.rows[0];
        if (!sameMoney(existing.amount, amount) || Number(existing.toUserId) !== toUserId || String(existing.reference) !== reference) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "This idempotency key was already used for a different handover" });
          return;
        }
        await client.query("COMMIT");
        res.status(200).json(existing);
        return;
      }
    }
    const cycle = await client.query("SELECT id,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE status='ACTIVE' LIMIT 1 FOR UPDATE");
    if (!cycle.rows[0]) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "An active cycle is required before recording a cash handover" });
      return;
    }
    if (!cycle.rows[0].tracking_start_date) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Owner must set the digital tracking start date before recording cash handovers" });
      return;
    }
    if (collectionDate < cycle.rows[0].tracking_start_date || collectionDate > todayIso()) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Collection date must be on or after the digital tracking start and not in the future" });
      return;
    }
    const receiver = await client.query("SELECT id,name,role FROM fund_users WHERE id=$1 AND active=true FOR SHARE", [toUserId]);
    if (!receiver.rows[0] || !isCashCustodyRole(receiver.rows[0].role) || !["OWNER", "CASH_RECEIVER"].includes(receiver.rows[0].role)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Handover receiver must be an active Owner or Cash Receiver" });
      return;
    }
    if (req.user.role === "CASH_RECEIVER" && receiver.rows[0].role !== "OWNER") {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Cash Receiver can only hand over final custody to the Owner" });
      return;
    }
    await transactionLock(client, `cash-balance:${req.user.id}:${cycle.rows[0].id}`);
    const available = await client.query(
      `SELECT GREATEST(
        COALESCE((SELECT SUM(p.amount) FROM fund_payments p
          WHERE COALESCE(p.receiver_id,p.collector_id)=$1 AND p.cycle_id=$2 AND p.status='POSTED'),0)
        + COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
          WHERE h.to_user_id=$1 AND h.cycle_id=$2 AND h.status='ACCEPTED'),0)
         - COALESCE((SELECT SUM(h.amount) FROM fund_cash_handovers h
           WHERE h.from_user_id=$1 AND h.cycle_id=$2 AND h.status IN ('SUBMITTED','ACCEPTED')),0)
        - COALESCE((SELECT SUM(s.amount) FROM fund_settlements s
          WHERE s.collector_id=$1 AND s.cycle_id=$2),0)
        - COALESCE((SELECT SUM(pd.amount) FROM fund_draw_disbursements pd
          WHERE pd.payer_user_id=$1 AND pd.cycle_id=$2 AND pd.status='PAID'),0),
        0)::float AS "availableAmount"`,
      [req.user.id, cycle.rows[0].id],
    );
    const availableAmount = money(available.rows[0]?.availableAmount);
    if (amount > availableAmount) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "Handover amount cannot exceed the sender's available custody",
        availableAmount,
      });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO fund_cash_handovers(cycle_id,from_user_id,to_user_id,amount,collection_date,receipt_start,receipt_end,receipt_count,reference,note,status,submitted_by,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SUBMITTED',$2,$11)
       RETURNING id`,
      [
        cycle.rows[0].id,
        req.user.id,
        toUserId,
        amount,
        collectionDate,
        String(b.receiptStart ?? "").trim() || null,
        String(b.receiptEnd ?? "").trim() || null,
        receiptCount,
        reference,
        String(b.note ?? "").trim(),
        idempotencyKey,
      ],
    );
    const handoverId = inserted.rows[0].id;
    await auditOn(client, req.user.id, "CASH_HANDOVER_SUBMITTED", `${reference}: BDT ${amount} submitted to ${receiver.rows[0].name}`, "cash_handover", String(handoverId), {
      cycleId: cycle.rows[0].id,
      relatedTransactionId: reference,
      effectiveDate: collectionDate,
      afterValue: { handoverId, fromUserId: req.user.id, toUserId, amount, status: "SUBMITTED" },
    });
    const result = await client.query(`${cashHandoverSelect} WHERE h.id=$1`, [handoverId]);
    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Cash handover submission failed");
    res.status(409).json({ error: "Cash handover could not be saved; no records were changed" });
  } finally {
    client.release();
  }
});

router.post("/cash-handovers/:id/accept", requireAuth, async (req: AuthedRequest, res) => {
  if (!req.user || !["OWNER", "CASH_RECEIVER"].includes(req.user.role)) {
    res.status(403).json({ error: "Only the Owner or Cash Receiver can accept a handover" });
    return;
  }
  const id = Number(req.params.id);
  const countedAmount = req.body?.countedAmount == null ? null : Number(req.body.countedAmount);
  if (!Number.isInteger(id) || id <= 0 || (countedAmount !== null && (!Number.isFinite(countedAmount) || countedAmount < 0))) {
    res.status(400).json({ error: "A valid handover and counted amount are required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `cash-handover-decision:${id}`);
    const current = await client.query(`${cashHandoverSelect} WHERE h.id=$1 FOR UPDATE OF h`, [id]);
    const handover = current.rows[0];
    if (!handover) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Cash handover not found" });
      return;
    }
    if (Number(handover.toUserId) !== req.user.id) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Only the named receiver can accept this handover" });
      return;
    }
    if (handover.status !== "SUBMITTED") {
      await client.query("ROLLBACK");
      res.status(handover.status === "ACCEPTED" ? 200 : 409).json(handover.status === "ACCEPTED" ? handover : { error: `Handover is already ${handover.status.toLowerCase()}` });
      return;
    }
    if (countedAmount !== null && !sameMoney(countedAmount, handover.amount)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Counted cash does not match the submitted amount; reject and submit a correction instead", expectedAmount: money(handover.amount), countedAmount });
      return;
    }
     const finalCountedAmount = countedAmount ?? money(handover.amount);
     await client.query(
       "UPDATE fund_cash_handovers SET status='ACCEPTED',accepted_by=$2,accepted_at=now(),counted_by=$2,counted_amount=$3,received_by=$2 WHERE id=$1",
       [id, req.user.id, finalCountedAmount],
     );
    await auditOn(client, req.user.id, "CASH_HANDOVER_ACCEPTED", `${handover.reference}: BDT ${handover.amount} accepted from ${handover.fromUserName}`, "cash_handover", String(id), {
      cycleId: Number(handover.cycleId),
      relatedTransactionId: handover.reference,
      effectiveDate: handover.collectionDate,
      beforeValue: { status: "SUBMITTED", amount: money(handover.amount) },
       afterValue: { status: "ACCEPTED", acceptedBy: req.user.id, countedBy: req.user.id, receivedBy: req.user.id, countedAmount: finalCountedAmount },
    });
    const result = await client.query(`${cashHandoverSelect} WHERE h.id=$1`, [id]);
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Cash handover acceptance failed");
    res.status(409).json({ error: "Cash handover could not be accepted; no records were changed" });
  } finally {
    client.release();
  }
});

router.post("/cash-handovers/:id/reject", requireAuth, async (req: AuthedRequest, res) => {
  if (!req.user || !["OWNER", "CASH_RECEIVER"].includes(req.user.role)) {
    res.status(403).json({ error: "Only the Owner or Cash Receiver can reject a handover" });
    return;
  }
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "").trim();
  if (!Number.isInteger(id) || id <= 0 || !reason) {
    res.status(400).json({ error: "A handover and rejection reason are required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transactionLock(client, `cash-handover-decision:${id}`);
    const current = await client.query(`${cashHandoverSelect} WHERE h.id=$1 FOR UPDATE OF h`, [id]);
    const handover = current.rows[0];
    if (!handover) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Cash handover not found" });
      return;
    }
    if (Number(handover.toUserId) !== req.user.id) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Only the named receiver can reject this handover" });
      return;
    }
    if (handover.status !== "SUBMITTED") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `Handover is already ${handover.status.toLowerCase()}` });
      return;
    }
    await client.query(
      "UPDATE fund_cash_handovers SET status='REJECTED',rejected_by=$2,rejected_at=now(),rejection_reason=$3 WHERE id=$1",
      [id, req.user.id, reason],
    );
    await auditOn(client, req.user.id, "CASH_HANDOVER_REJECTED", `${handover.reference}: ${reason}`, "cash_handover", String(id), {
      cycleId: Number(handover.cycleId),
      relatedTransactionId: handover.reference,
      effectiveDate: handover.collectionDate,
      beforeValue: { status: "SUBMITTED", amount: money(handover.amount) },
      afterValue: { status: "REJECTED", rejectedBy: req.user.id, reason },
    });
    const result = await client.query(`${cashHandoverSelect} WHERE h.id=$1`, [id]);
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Cash handover rejection failed");
    res.status(409).json({ error: "Cash handover could not be rejected; no records were changed" });
  } finally {
    client.release();
  }
});

router.get("/collectors",requireAuth,ownerOnly,async(_req,res)=>{const r=await pool.query("SELECT id,name,username,role,active FROM fund_users WHERE role='COLLECTOR' ORDER BY active DESC,name");res.json(r.rows);});
router.post("/collectors",requireAuth,ownerOnly,async(req:AuthedRequest,res)=>{
  const b=req.body;
  if(!b.name||!b.username||String(b.password??"").length<8)return res.status(400).json({error:"Name, username and an 8-character password are required"});
  try{
    const r=await pool.query("INSERT INTO fund_users(name,username,password_hash,role) VALUES($1,$2,$3,'COLLECTOR') RETURNING id,name,username,role,active",[b.name,b.username,hashPassword(b.password)]);
    await audit(req.user!.id,"COLLECTOR_CREATED",`Created collector ${b.username}`,"user",String(r.rows[0].id));
    return res.status(201).json(r.rows[0]);
  }catch{return res.status(409).json({error:"Username already exists"});}
});
router.patch("/collectors/:id",requireAuth,ownerOnly,async(req:AuthedRequest,res)=>{
  const id=Number(req.params.id);const b=req.body;
  const current=await pool.query("SELECT id,name,username,role,active FROM fund_users WHERE id=$1 AND role='COLLECTOR'",[id]);
  if(!current.rows[0])return res.status(404).json({error:"Collector not found"});
  const r=await pool.query(`UPDATE fund_users SET name=COALESCE($2,name),active=COALESCE($3,active),password_hash=COALESCE($4,password_hash) WHERE id=$1 RETURNING id,name,username,role,active`,[id,b.name??null,b.active??null,b.password?hashPassword(b.password):null]);
  if(b.active===false)await pool.query("DELETE FROM fund_sessions WHERE user_id=$1",[id]);
  await audit(req.user!.id,"COLLECTOR_UPDATED",`Updated collector ${current.rows[0].username}`,"user",String(id));
  return res.json(r.rows[0]);
});
router.get("/cash-receivers", requireAuth, ownerOnly, async (_req, res) => {
  const result = await pool.query("SELECT id,name,username,role,active FROM fund_users WHERE role='CASH_RECEIVER' ORDER BY active DESC,name");
  res.json(result.rows);
});
router.post("/cash-receivers", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  if (!b.name || !b.username || String(b.password ?? "").length < 8) {
    res.status(400).json({ error: "Name, username and an 8-character password are required" });
    return;
  }
  try {
    const result = await pool.query(
      "INSERT INTO fund_users(name,username,password_hash,role) VALUES($1,$2,$3,'CASH_RECEIVER') RETURNING id,name,username,role,active",
      [b.name, b.username, hashPassword(b.password)],
    );
    await audit(req.user!.id, "CASH_RECEIVER_CREATED", `Created cash receiver ${b.username}`, "user", String(result.rows[0].id));
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(409).json({ error: "Username already exists" });
  }
});
router.patch("/cash-receivers/:id", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const current = await pool.query("SELECT id,name,username,role,active FROM fund_users WHERE id=$1 AND role='CASH_RECEIVER'", [id]);
  if (!current.rows[0]) {
    res.status(404).json({ error: "Cash receiver not found" });
    return;
  }
  const result = await pool.query(
    "UPDATE fund_users SET name=COALESCE($2,name),active=COALESCE($3,active),password_hash=COALESCE($4,password_hash) WHERE id=$1 RETURNING id,name,username,role,active",
    [id, b.name ?? null, b.active ?? null, b.password ? hashPassword(b.password) : null],
  );
  await audit(req.user!.id, "CASH_RECEIVER_UPDATED", `Updated cash receiver ${current.rows[0].username}`, "user", String(id));
  res.json(result.rows[0]);
});
router.get("/audit",requireAuth,ownerOnly,async(_req,res)=>{const r=await pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.entity_type AS "entityType",a.entity_id AS "entityId",
  COALESCE(m.public_member_id,m.member_id) AS "memberId",a.cycle_id AS "cycleId",a.related_transaction_id AS "relatedTransactionId",a.reason,a.effective_date::text AS "effectiveDate",
  a.before_value AS "beforeValue",a.after_value AS "afterValue",a.created_at AS "createdAt"
  FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id LEFT JOIN fund_members m ON m.id=a.member_id ORDER BY a.created_at DESC LIMIT 300`);res.json(r.rows);});
router.get("/settings",requireAuth,async(_req,res)=>{const r=await pool.query(`SELECT organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional" FROM fund_settings WHERE id=1`);res.json(r.rows[0]);});
router.patch("/settings",requireAuth,ownerOnly,async(req:AuthedRequest,res)=>{const b=req.body;const r=await pool.query(`UPDATE fund_settings SET organization_name=COALESCE($1,organization_name),expected_members=COALESCE($2,expected_members),default_daily_per_share=COALESCE($3,default_daily_per_share) WHERE id=1 RETURNING organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional"`,[b.organizationName??null,b.expectedMembers??null,b.defaultDailyPerShare??null]);await audit(req.user!.id,"SETTINGS_UPDATED","Business settings updated");res.json(r.rows[0]);});

 router.get("/dashboard",requireAuth,async(req:AuthedRequest,res)=>{
    const businessDate = todayIso();
    const activeCycleResult = await pool.query("SELECT id,tracking_start_date::text AS tracking_start_date FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
   const activeCycleId = Number(activeCycleResult.rows[0]?.id ?? 0);
   const trackingStartDate = activeCycleResult.rows[0]?.tracking_start_date ?? null;
    const trackingReady = Boolean(trackingStartDate && businessDate >= String(trackingStartDate));
   const readySql = trackingReady ? "TRUE" : "FALSE";
    const activeTan = activeCycleId ? await tanConfigForCycle(pool, activeCycleId) : null;
     const activeTanPeriod = activeTan ? await tanPeriodForDate(pool, activeCycleId, businessDate) : null;
     const periodSummary = {
       ...collectionCalendarState(businessDate, activeCycleId > 0, Boolean(activeTan), activeTanPeriod),
       currentDrawDate: activeTanPeriod?.drawDate ?? null,
       currentPeriodStart: activeTanPeriod?.periodStart ?? null,
       currentPeriodEnd: activeTanPeriod?.periodEnd ?? null,
     };
    const activeTanDue = activeTan ? await tanDueForMembers(pool, activeCycleId, activeTanPeriod) : new Map<number, any>();
    const tanCollectorRows = activeTan && req.user!.role === "COLLECTOR"
      ? await tanDashboardMemberRows(pool, activeCycleId, activeTanPeriod, activeTanDue, req.user!.id)
      : [];
    const tanOwnerRows = activeTan && req.user!.role !== "COLLECTOR"
      ? await tanDashboardMemberRows(pool, activeCycleId, activeTanPeriod, activeTanDue)
      : [];
   if(req.user!.role==="COLLECTOR"){
       const [members,payments,settlements,due,recent,reconciliation,drawPayouts]=await Promise.all([
        pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(CASE WHEN ${readySql} THEN cm.daily_contribution ELSE 0 END),0)::float target
          FROM fund_members m JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=${activeCycleId}
          WHERE m.status='active' AND (m.assigned_collector_id=$1 OR m.assigned_collector_id IS NULL)`,[req.user!.id]),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float amount,COUNT(*)::int count FROM fund_payments p
          WHERE collector_id=$1 AND cycle_id=${activeCycleId} AND collection_date='${businessDate}'::date AND status='POSTED'`,[req.user!.id]),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float amount FROM fund_settlements WHERE collector_id=$1 AND cycle_id=${activeCycleId} AND (created_at AT TIME ZONE 'Asia/Dhaka')::date='${businessDate}'::date`,[req.user!.id]),
        pool.query(`SELECT m.id,COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name,m.mobile,m.address,m.business_name AS "businessName",cm.shares,cm.daily_contribution::float AS "dailyAmount",
          m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount),0)::float AS "todayPaid"
          FROM fund_members m JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=${activeCycleId}
          LEFT JOIN fund_payments p ON p.member_id=m.id AND p.cycle_id=${activeCycleId} AND p.collection_date='${businessDate}'::date AND p.status='POSTED'
          WHERE ${readySql} AND m.status='active' AND (m.assigned_collector_id=$1 OR m.assigned_collector_id IS NULL)
          GROUP BY m.id,cm.id HAVING COALESCE(SUM(p.amount),0)<cm.daily_contribution
          ORDER BY m.member_id LIMIT 20`,[req.user!.id]),
        pool.query(`SELECT p.id,p.receipt_id AS "receiptId",COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name AS "memberName",p.amount::float,u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id LEFT JOIN fund_users u ON u.id=p.collector_id WHERE p.collector_id=$1 AND p.cycle_id=${activeCycleId} ORDER BY p.created_at DESC LIMIT 8`,[req.user!.id])
         ,
          pool.query(`SELECT
           COALESCE(SUM(GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=cm.cycle_id AND de.member_id=cm.member_id),0)
             - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=cm.cycle_id AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0)),0)::float AS "previousDue",
           COALESCE((SELECT SUM(t.accumulated_value) FROM fund_share_transfers t WHERE t.cycle_id=${activeCycleId}),0)::float AS "transferValue",
           COALESCE((SELECT SUM(s.amount) FROM fund_transfer_settlements s WHERE s.cycle_id=${activeCycleId} AND s.status='APPROVED'),0)::float AS "transferSettlementValue",
           COALESCE((SELECT COUNT(*) FROM fund_draws d WHERE d.cycle_id=${activeCycleId} AND d.status='RECORDED'),0)::int AS "drawCount"
           FROM fund_cycle_members cm JOIN fund_members m ON m.id=cm.member_id
            WHERE cm.cycle_id=${activeCycleId} AND (m.assigned_collector_id=$1 OR m.assigned_collector_id IS NULL)`,[req.user!.id]),
          pool.query(`SELECT COALESCE(SUM(amount),0)::float AS amount FROM fund_draw_disbursements
            WHERE payer_user_id=$1 AND cycle_id=${activeCycleId} AND payout_date='${businessDate}'::date AND status='PAID'`,[req.user!.id])
     ]);
        const target=money(members.rows[0].target),collected=money(payments.rows[0].amount),deposits=money(settlements.rows[0].amount),payouts=money(drawPayouts.rows[0]?.amount);
       const currentCollectionDue = activeTan
         ? tanCollectorRows.reduce((sum, member) => sum + money(member.currentPeriodDue), 0)
         : Math.max(0, target - collected);
       const previousDue = activeTan
         ? tanCollectorRows.reduce((sum, member) => sum + money(member.previousDue), 0)
         : money(reconciliation.rows[0]?.previousDue);
       const totalDue = currentCollectionDue + previousDue;
       const dueMembers = activeTan
         ? tanCollectorRows.filter((member) => money(member.totalDue) > 0).slice(0, 20)
         : due.rows.map(m => ({...m,todayDue:Math.max(0,money(m.dailyAmount)-money(m.todayPaid)),totalDue:Math.max(0,money(m.dailyAmount)-money(m.todayPaid))+money(m.previousDue)}));
         return res.json({trackingReady,trackingStartDate,...periodSummary,totalMembers:members.rows[0].count,todayTarget:target,currentCollectionDue,collected,due:currentCollectionDue,previousDue,totalDue,transferValue:money(reconciliation.rows[0]?.transferValue),transferSettlementValue:money(reconciliation.rows[0]?.transferSettlementValue),drawCount:Number(reconciliation.rows[0]?.drawCount ?? 0),collectorCash:collected,officeDeposits:deposits,unsettledCash:collected-deposits,drawPayouts:payouts,netCashMovement:collected-deposits-payouts,paymentCount:payments.rows[0].count,performances:[{name:req.user!.name,collected,payments:payments.rows[0].count,cash:collected-deposits-payouts}],dueMembers,recentPayments:recent.rows,audit:[]});
   }
     const [members,payments,settlements,perf,due,recent,audits,reconciliation,drawPayouts]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(CASE WHEN ${readySql} THEN cm.daily_contribution ELSE 0 END),0)::float target
        FROM fund_members m JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=${activeCycleId} WHERE m.status='active'`),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float amount,COUNT(*)::int count FROM fund_payments p WHERE p.cycle_id=${activeCycleId} AND collection_date='${businessDate}'::date AND status='POSTED'`),
       pool.query(`SELECT COALESCE(SUM(amount),0)::float amount FROM fund_settlements WHERE cycle_id=${activeCycleId} AND (created_at AT TIME ZONE 'Asia/Dhaka')::date='${businessDate}'::date`),
       pool.query(`SELECT u.name,COALESCE(SUM(p.amount),0)::float collected,COUNT(p.id)::int payments,(COALESCE(SUM(p.amount),0)-COALESCE((SELECT SUM(s.amount) FROM fund_settlements s WHERE s.collector_id=u.id AND s.cycle_id=${activeCycleId} AND (s.created_at AT TIME ZONE 'Asia/Dhaka')::date='${businessDate}'::date),0))::float cash FROM fund_users u LEFT JOIN fund_payments p ON p.collector_id=u.id AND p.cycle_id=${activeCycleId} AND p.collection_date='${businessDate}'::date AND p.status='POSTED' WHERE u.role='COLLECTOR' GROUP BY u.id ORDER BY collected DESC`),
      pool.query(`SELECT m.id,COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name,m.mobile,m.address,m.business_name AS "businessName",cm.shares,cm.daily_contribution::float AS "dailyAmount",m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount),0)::float AS "todayPaid",
         GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=cm.cycle_id AND de.member_id=cm.member_id),0)-COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=cm.cycle_id AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0)::float AS "previousDue"
        FROM fund_members m JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=${activeCycleId}
        LEFT JOIN fund_payments p ON p.member_id=m.id AND p.cycle_id=${activeCycleId} AND p.collection_date='${businessDate}'::date AND p.status='POSTED'
        WHERE ${readySql} AND m.status='active' GROUP BY m.id,cm.id
        HAVING COALESCE(SUM(p.amount),0)<cm.daily_contribution ORDER BY m.member_id LIMIT 20`),
      pool.query(`SELECT p.id,p.receipt_id AS "receiptId",COALESCE(m.public_member_id,m.member_id) AS "memberId",m.name AS "memberName",p.amount::float,u.name AS "collectorName",ru.name AS "receiverName",p.receipt_source AS "receiptSource",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id LEFT JOIN fund_users u ON u.id=p.collector_id LEFT JOIN fund_users ru ON ru.id=COALESCE(p.receiver_id,p.collector_id) WHERE p.cycle_id=${activeCycleId} ORDER BY p.created_at DESC LIMIT 8`),
       pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.entity_type AS "entityType",a.entity_id AS "entityId",
          COALESCE(m.public_member_id,m.member_id) AS "memberId",a.cycle_id AS "cycleId",a.related_transaction_id AS "relatedTransactionId",a.reason,a.effective_date::text AS "effectiveDate",
         a.before_value AS "beforeValue",a.after_value AS "afterValue",a.created_at AS "createdAt"
          FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id LEFT JOIN fund_members m ON m.id=a.member_id ORDER BY a.created_at DESC LIMIT 8`),
       pool.query(`SELECT
        COALESCE(SUM(GREATEST(COALESCE((SELECT SUM(de.amount) FROM fund_due_entries de WHERE de.cycle_id=cm.cycle_id AND de.member_id=cm.member_id),0)
          - COALESCE((SELECT SUM(pp.previous_due_applied) FROM fund_payments pp WHERE pp.cycle_id=cm.cycle_id AND pp.member_id=cm.member_id AND pp.status='POSTED'),0),0)),0)::float AS "previousDue",
        COALESCE((SELECT SUM(t.accumulated_value) FROM fund_share_transfers t WHERE t.cycle_id=${activeCycleId}),0)::float AS "transferValue",
        COALESCE((SELECT SUM(s.amount) FROM fund_transfer_settlements s WHERE s.cycle_id=${activeCycleId} AND s.status='APPROVED'),0)::float AS "transferSettlementValue",
        COALESCE((SELECT COUNT(*) FROM fund_draws d WHERE d.cycle_id=${activeCycleId} AND d.status='RECORDED'),0)::int AS "drawCount"
         FROM fund_cycle_members cm WHERE cm.cycle_id=${activeCycleId}`),
       pool.query(`SELECT COALESCE(SUM(amount),0)::float AS amount FROM fund_draw_disbursements
         WHERE cycle_id=${activeCycleId} AND payout_date='${businessDate}'::date AND status='PAID'`)
   ]);
   const target=money(members.rows[0].target), collected=money(payments.rows[0].amount), deposits=money(settlements.rows[0].amount), payouts=money(drawPayouts.rows[0]?.amount);
  const currentCollectionDue = activeTan
    ? tanOwnerRows.reduce((sum, member) => sum + money(member.currentPeriodDue), 0)
    : Math.max(0, target - collected);
  const previousDue = activeTan
    ? tanOwnerRows.reduce((sum, member) => sum + money(member.previousDue), 0)
    : money(reconciliation.rows[0]?.previousDue);
  const totalDue = currentCollectionDue + previousDue;
  const dueMembers = activeTan
    ? tanOwnerRows.filter((member) => money(member.totalDue) > 0).slice(0, 20)
    : due.rows.map(m=>{const todayDue=Math.max(0,money(m.dailyAmount)-money(m.todayPaid)); return {...m,todayDue,totalDue:todayDue+money(m.previousDue)}});
   return res.json({trackingReady,trackingStartDate,...periodSummary,totalMembers:members.rows[0].count,todayTarget:target,currentCollectionDue,collected,due:currentCollectionDue,previousDue,totalDue,transferValue:money(reconciliation.rows[0]?.transferValue),transferSettlementValue:money(reconciliation.rows[0]?.transferSettlementValue),drawCount:Number(reconciliation.rows[0]?.drawCount ?? 0),collectorCash:collected,officeDeposits:deposits,unsettledCash:collected-deposits,drawPayouts:payouts,netCashMovement:collected-deposits-payouts,paymentCount:payments.rows[0].count,performances:perf.rows,dueMembers,recentPayments:recent.rows,audit:audits});
});
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const sendCsv = (res: Response, filename: string, headers: string[], rows: unknown[][]) => {
  const csv = [headers.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=islamiya-${filename}.csv`);
  res.send("\uFEFF" + csv);
};

router.get("/reports/export", requireAuth, ownerOnly, async (req, res) => {
  const type = String(req.query.type ?? "payments").toLowerCase().replace(/[^a-z-]/g, "");
  const activeCycle = await pool.query("SELECT id FROM fund_cycles WHERE status='ACTIVE' LIMIT 1");
  const activeCycleId = Number(activeCycle.rows[0]?.id ?? 0);

  if (type === "members") {
    const r = await pool.query(`SELECT COALESCE(public_member_id,member_id) AS member_id,name,mobile,business_name,address,nid,shares,daily_amount,joining_date,status,notes
      FROM fund_members ORDER BY member_id`);
    return sendCsv(res, "members-backup", ["Member ID", "Name", "Mobile", "Business Name", "Address", "NID", "Shares", "Daily Amount", "Joining Date", "Status", "Notes"],
      r.rows.map((x) => [x.member_id, x.name, x.mobile, x.business_name, x.address, x.nid, x.shares, x.daily_amount, x.joining_date, x.status, x.notes]));
  }

  if (type === "collectors") {
    const r = await pool.query(`SELECT id,name,username,role,active
      FROM fund_users ORDER BY role,name`);
    return sendCsv(res, "collectors-backup", ["Collector ID", "Name", "Username", "Role", "Active"],
      r.rows.map((x) => [x.id, x.name, x.username, x.role, x.active]));
  }

  if (type === "settlements" || type === "settlement") {
    const r = await pool.query(`SELECT s.id,u.id AS collector_id,u.name AS collector_name,
      (s.created_at AT TIME ZONE 'Asia/Dhaka')::date AS settlement_date,s.amount,s.reference,s.note
      FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id
      WHERE s.cycle_id=${activeCycleId} ORDER BY s.created_at DESC`);
    return sendCsv(res, "settlements-backup", ["Settlement ID", "Collector ID", "Collector", "Date", "Deposited Amount", "Reference", "Notes"],
      r.rows.map((x) => [x.id, x.collector_id, x.collector_name, x.settlement_date, x.amount, x.reference, x.note]));
  }

  if (type === "draws") {
    const r = await pool.query(`${drawSelect} WHERE d.cycle_id=$1 ORDER BY d.draw_date DESC,d.draw_number DESC`, [activeCycleId]);
    return sendCsv(res, "draw-payouts-backup",
      ["Draw ID", "Cycle ID", "Draw Date", "Draw Number", "Winner Member ID", "Winner", "Winning Amount", "Draw Status", "Payout Status", "Payout Date", "Payer", "Payout Amount", "Reference", "Payout Note", "Reversal Reason"],
      r.rows.map((x) => [x.id, x.cycleId, x.drawDate, x.drawNumber, x.winnerMemberCode, x.winnerName, x.winningAmount, x.status, x.payoutStatus ?? "PENDING", x.payoutDate, x.payoutPayerName, x.payoutAmount, x.payoutReference, x.payoutNote, x.payoutReversalReason]));
  }

  if (type === "audit") {
    const r = await pool.query(`SELECT a.id,a.created_at,COALESCE(u.name,'System') AS actor,
      COALESCE(u.role,'SYSTEM') AS role,a.action,a.entity_type,a.entity_id,COALESCE(m.public_member_id,m.member_id) AS member_id,a.cycle_id,a.related_transaction_id,
      a.reason,a.effective_date,a.before_value,a.after_value,a.detail
      FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id LEFT JOIN fund_members m ON m.id=a.member_id
      ORDER BY a.created_at DESC`);
    return sendCsv(res, "audit-backup", ["Audit ID", "Timestamp", "User", "Role", "Action", "Entity Type", "Entity ID", "Member ID", "Cycle ID", "Related Transaction ID", "Reason", "Effective Date", "Before", "After", "Details"],
      r.rows.map((x) => [x.id, x.created_at, x.actor, x.role, x.action, x.entity_type, x.entity_id, x.member_id, x.cycle_id, x.related_transaction_id, x.reason, x.effective_date, x.before_value, x.after_value, x.detail]));
  }

  if (type === "due") {
    const r = await pool.query(`SELECT COALESCE(m.public_member_id,m.member_id) AS member_id,m.name,m.mobile,cm.shares,cm.daily_contribution AS daily_amount,
       COALESCE(SUM(p.amount) FILTER (WHERE p.collection_date='${todayIso()}'::date AND p.status='POSTED'),0)::float AS today_paid,
       GREATEST(cm.daily_contribution-COALESCE(SUM(p.amount) FILTER (WHERE p.collection_date='${todayIso()}'::date AND p.status='POSTED'),0),0)::float AS today_due
      FROM fund_members m JOIN fund_cycle_members cm ON cm.member_id=m.id AND cm.cycle_id=${activeCycleId}
      JOIN fund_cycles c ON c.id=cm.cycle_id LEFT JOIN fund_payments p ON p.member_id=m.id AND p.cycle_id=${activeCycleId}
       WHERE m.status='active' AND c.tracking_start_date IS NOT NULL AND '${todayIso()}'::date >= c.tracking_start_date GROUP BY m.id,cm.id
       HAVING COALESCE(SUM(p.amount) FILTER (WHERE p.collection_date='${todayIso()}'::date AND p.status='POSTED'),0) < cm.daily_contribution
      ORDER BY m.member_id`);
    return sendCsv(res, "due-members", ["Member ID", "Name", "Mobile", "Shares", "Daily Amount", "Today Paid", "Today Due"],
      r.rows.map((x) => [x.member_id, x.name, x.mobile, x.shares, x.daily_amount, x.today_paid, x.today_due]));
  }

  if (type === "collector") {
    const r = await pool.query(`SELECT u.id,u.name,COUNT(p.id)::int AS payment_count,
      COALESCE(SUM(p.amount),0)::float AS collected
      FROM fund_users u LEFT JOIN fund_payments p ON p.collector_id=u.id AND p.cycle_id=${activeCycleId} AND p.status='POSTED'
      WHERE u.role='COLLECTOR' GROUP BY u.id ORDER BY u.name`);
    return sendCsv(res, "collector-collection", ["Collector ID", "Collector", "Payment Count", "Collected Amount"],
      r.rows.map((x) => [x.id, x.name, x.payment_count, x.collected]));
  }

  const reportDate = todayIso();
  const period = type === "weekly" ? `p.collection_date >= '${addDays(reportDate, -6)}'::date AND p.collection_date <= '${reportDate}'::date`
    : type === "monthly" ? `p.collection_date >= date_trunc('month', '${reportDate}'::date)::date AND p.collection_date <= '${reportDate}'::date`
    : type === "daily" ? `p.collection_date = '${reportDate}'::date`
    : "TRUE";
  const r = await pool.query(`SELECT p.id AS payment_id,p.receipt_id,COALESCE(m.public_member_id,m.member_id) AS member_id,m.name AS member_name,
       p.collection_date AS payment_date,(p.created_at AT TIME ZONE 'Asia/Dhaka')::time AS payment_time,p.amount,
      p.verification_status,u.id AS collector_id,u.name AS collector_name,ru.name AS receiver_name,p.receipt_source,p.status,p.idempotency_key,p.created_at
      FROM fund_payments p JOIN fund_members m ON m.id=p.member_id LEFT JOIN fund_users u ON u.id=p.collector_id
      LEFT JOIN fund_users ru ON ru.id=COALESCE(p.receiver_id,p.collector_id)
       WHERE p.cycle_id=${activeCycleId} AND ${period} ORDER BY p.created_at DESC`);
  return sendCsv(res, `payments-${type || "all"}`, ["Payment ID", "Receipt ID", "Member ID", "Member", "Payment Date", "Payment Time", "Amount", "Verification", "Collector ID", "Collector", "Receiver", "Receipt Source", "Status", "Idempotency Key", "Created At"],
    r.rows.map((x) => [x.payment_id, x.receipt_id, x.member_id, x.member_name, x.payment_date, x.payment_time, x.amount, x.verification_status, x.collector_id, x.collector_name, x.receiver_name, x.receipt_source, x.status, x.idempotency_key, x.created_at]));
});

export default router;