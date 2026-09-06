import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const router = Router();
const COOKIE = "irf_session";
type AuthUser = { id: number; name: string; username: string; role: "OWNER" | "COLLECTOR" };
type AuthedRequest = Request & { user?: AuthUser };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const passwordMatches = (password: string, stored: string) => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
};
const cookies = (req: Request) => Object.fromEntries((req.headers.cookie ?? "").split(";").filter(Boolean).map((v) => v.trim().split("=")));
const money = (value: unknown) => Number(value ?? 0);
const audit = async (actorId: number, action: string, detail: string, entityType?: string, entityId?: string) =>
  pool.query("INSERT INTO fund_audit(actor_id,action,detail,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)", [actorId, action, detail, entityType ?? null, entityId ?? null]);

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
router.get("/auth/me", requireAuth, (req: AuthedRequest, res) => res.json(req.user));

router.get("/members", requireAuth, async (req: AuthedRequest, res) => {
  const search = `%${String(req.query.search ?? "")}%`;
  const params: unknown[] = [search];
  let allowed = "";
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); allowed = " AND (m.assigned_collector_id=$2 OR m.assigned_collector_id IS NULL)"; }
  const rows = await pool.query(
    `SELECT m.id,m.member_id AS "memberId",m.name,m.mobile,m.address,m.shares,m.daily_amount::float AS "dailyAmount",
      m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount) FILTER(WHERE p.created_at::date=CURRENT_DATE AND p.status='POSTED'),0)::float AS "todayPaid"
     FROM fund_members m LEFT JOIN fund_payments p ON p.member_id=m.id
     WHERE (m.name ILIKE $1 OR m.member_id ILIKE $1 OR m.mobile ILIKE $1)${allowed}
     GROUP BY m.id ORDER BY m.member_id`,
    params,
  );
  res.json(rows.rows.map((m) => ({ ...m, todayDue: Math.max(0, money(m.dailyAmount) - money(m.todayPaid)) })));
});
router.post("/members", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  const r = await pool.query(
    `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,member_id AS "memberId",name,mobile,address,shares,daily_amount::float AS "dailyAmount",joining_date::text AS "joiningDate",status`,
    [b.memberId,b.name,b.mobile,b.address ?? "",b.shares,b.dailyAmount,b.joiningDate,b.status],
  );
  await audit(req.user!.id, "MEMBER_CREATED", `Created ${b.memberId}`, "member", String(r.rows[0].id));
  res.status(201).json({ ...r.rows[0], todayPaid: 0, todayDue: money(b.dailyAmount) });
});

router.get("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[] = [];
  const where = req.user?.role === "COLLECTOR" ? (params.push(req.user.id), "WHERE p.collector_id=$1") : "";
  const r = await pool.query(
    `SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.amount::float,
      u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status
     FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id ${where}
     ORDER BY p.created_at DESC LIMIT 500`, params);
  res.json(r.rows);
});
router.post("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const { memberId, amount, verificationMethod, verificationCode, confirmDuplicate } = req.body;
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });
  const duplicate = await pool.query("SELECT 1 FROM fund_payments WHERE member_id=$1 AND created_at::date=CURRENT_DATE AND status='POSTED' LIMIT 1", [memberId]);
  if (duplicate.rowCount && !confirmDuplicate) return res.status(409).json({ error: "A payment already exists today. Confirm to add another or partial payment." });
  const member = await pool.query("SELECT id,name FROM fund_members WHERE id=$1 AND status='active'", [memberId]);
  if (!member.rows[0]) return res.status(404).json({ error: "Active member not found" });
  const receiptId = `IRF-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const verification = verificationMethod === "PIN" && verificationCode ? "PIN VERIFIED" : "COLLECTOR CONFIRMED";
  const r = await pool.query(
    `INSERT INTO fund_payments(receipt_id,member_id,amount,collector_id,verification_status)
     VALUES($1,$2,$3,$4,$5) RETURNING id,receipt_id AS "receiptId",member_id AS "memberId",amount::float,verification_status AS "verificationStatus",created_at AS "createdAt",status`,
    [receiptId,memberId,amount,req.user!.id,verification],
  );
  await audit(req.user!.id, "PAYMENT_POSTED", `${receiptId}: BDT ${amount}`, "payment", String(r.rows[0].id));
  return res.status(201).json({ ...r.rows[0], memberName: member.rows[0].name, collectorName: req.user!.name });
});
router.post("/payments/:id/reverse", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const original = await pool.query("SELECT * FROM fund_payments WHERE id=$1 AND status='POSTED'", [req.params.id]);
  if (!original.rows[0]) return res.status(404).json({ error: "Posted payment not found" });
  const o = original.rows[0];
  await pool.query("UPDATE fund_payments SET status='REVERSED',correction_reason=$2 WHERE id=$1", [o.id, req.body.reason]);
  const r = await pool.query(
    `INSERT INTO fund_payments(receipt_id,member_id,amount,collector_id,verification_status,status,reversed_payment_id,correction_reason)
     VALUES($1,$2,$3,$4,'OWNER REVERSAL','REVERSAL',$5,$6)
     RETURNING id,receipt_id AS "receiptId",member_id AS "memberId",amount::float,verification_status AS "verificationStatus",created_at AS "createdAt",status`,
    [`REV-${o.receipt_id}`,o.member_id,o.amount,o.collector_id,o.id,req.body.reason]);
  await audit(req.user!.id, "PAYMENT_REVERSED", `${o.receipt_id}: ${req.body.reason}`, "payment", String(o.id));
  const names = await pool.query("SELECT m.name AS member,u.name AS collector FROM fund_members m,fund_users u WHERE m.id=$1 AND u.id=$2", [o.member_id,o.collector_id]);
  return res.json({ ...r.rows[0], memberName: names.rows[0].member, collectorName: names.rows[0].collector });
});

router.get("/settlements", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[]=[]; const where=req.user?.role==="COLLECTOR"?(params.push(req.user.id),"WHERE s.collector_id=$1"):"";
  const r=await pool.query(`SELECT s.id,s.amount::float,u.name AS "collectorName",s.reference,s.created_at AS "createdAt" FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id ${where} ORDER BY s.created_at DESC`,params);
  res.json(r.rows);
});
router.post("/settlements", requireAuth, async (req: AuthedRequest,res)=>{
  const b=req.body; const r=await pool.query(`INSERT INTO fund_settlements(collector_id,amount,reference,note) VALUES($1,$2,$3,$4) RETURNING id,amount::float,reference,created_at AS "createdAt"`,[req.user!.id,b.amount,b.reference,b.note??""]);
  await audit(req.user!.id,"SETTLEMENT_CREATED",`${b.reference}: BDT ${b.amount}`,"settlement",String(r.rows[0].id));
  res.status(201).json({...r.rows[0],collectorName:req.user!.name});
});
router.get("/collectors",requireAuth,ownerOnly,async(_req,res)=>{const r=await pool.query("SELECT id,name,username,role FROM fund_users WHERE role='COLLECTOR' AND active=true");res.json(r.rows);});
router.get("/audit",requireAuth,ownerOnly,async(_req,res)=>{const r=await pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.created_at AS "createdAt" FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300`);res.json(r.rows);});
router.get("/settings",requireAuth,async(_req,res)=>{const r=await pool.query(`SELECT organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional" FROM fund_settings WHERE id=1`);res.json(r.rows[0]);});
router.patch("/settings",requireAuth,ownerOnly,async(req:AuthedRequest,res)=>{const b=req.body;const r=await pool.query(`UPDATE fund_settings SET organization_name=COALESCE($1,organization_name),expected_members=COALESCE($2,expected_members),default_daily_per_share=COALESCE($3,default_daily_per_share) WHERE id=1 RETURNING organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional"`,[b.organizationName??null,b.expectedMembers??null,b.defaultDailyPerShare??null]);await audit(req.user!.id,"SETTINGS_UPDATED","Business settings updated");res.json(r.rows[0]);});

router.get("/dashboard",requireAuth,async(req:AuthedRequest,res)=>{
  const [members,payments,settlements,perf,due,recent,audits]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count,COALESCE(SUM(daily_amount),0)::float target FROM fund_members WHERE status='active'"),
    pool.query("SELECT COALESCE(SUM(amount),0)::float amount,COUNT(*)::int count FROM fund_payments WHERE created_at::date=CURRENT_DATE AND status='POSTED'"),
    pool.query("SELECT COALESCE(SUM(amount),0)::float amount FROM fund_settlements WHERE created_at::date=CURRENT_DATE"),
    pool.query(`SELECT u.name,COALESCE(SUM(p.amount),0)::float collected,COUNT(p.id)::int payments,(COALESCE(SUM(p.amount),0)-COALESCE((SELECT SUM(s.amount) FROM fund_settlements s WHERE s.collector_id=u.id),0))::float cash FROM fund_users u LEFT JOIN fund_payments p ON p.collector_id=u.id AND p.created_at::date=CURRENT_DATE AND p.status='POSTED' WHERE u.role='COLLECTOR' GROUP BY u.id ORDER BY collected DESC`),
    pool.query(`SELECT m.id,m.member_id AS "memberId",m.name,m.mobile,m.address,m.shares,m.daily_amount::float AS "dailyAmount",m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount),0)::float AS "todayPaid" FROM fund_members m LEFT JOIN fund_payments p ON p.member_id=m.id AND p.created_at::date=CURRENT_DATE AND p.status='POSTED' WHERE m.status='active' GROUP BY m.id HAVING COALESCE(SUM(p.amount),0)<m.daily_amount ORDER BY m.member_id LIMIT 20`),
    pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.amount::float,u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id ORDER BY p.created_at DESC LIMIT 8`),
    pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.created_at AS "createdAt" FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 8`)
  ]);
  const target=money(members.rows[0].target), collected=money(payments.rows[0].amount), deposits=money(settlements.rows[0].amount);
  res.json({totalMembers:members.rows[0].count,todayTarget:target,collected,due:Math.max(0,target-collected),collectorCash:collected,officeDeposits:deposits,unsettledCash:collected-deposits,paymentCount:payments.rows[0].count,performances:perf.rows,dueMembers:due.rows.map(m=>({...m,todayDue:money(m.dailyAmount)-money(m.todayPaid)})),recentPayments:recent.rows,audit:audits.rows});
});
router.get("/reports/export",requireAuth,ownerOnly,async(req,res)=>{
  const type=String(req.query.type??"payments").replace(/[^a-z-]/g,"");
  const r=await pool.query(`SELECT p.receipt_id,m.member_id,m.name,p.amount,p.verification_status,u.name collector,p.status,p.created_at FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id ORDER BY p.created_at DESC`);
  const csv=["Receipt ID,Member ID,Member,Amount,Verification,Collector,Status,Date",...r.rows.map(x=>[x.receipt_id,x.member_id,x.name,x.amount,x.verification_status,x.collector,x.status,x.created_at.toISOString()].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename=islamiya-${type}.csv`);res.send("\\uFEFF"+csv);
});

export default router;