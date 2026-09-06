import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const router = Router();
const COOKIE = "irf_session";
type AuthUser = { id: number; name: string; username: string; role: "OWNER" | "COLLECTOR" };
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
  const params: unknown[] = [search];
  let allowed = "";
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); allowed = " AND (m.assigned_collector_id=$2 OR m.assigned_collector_id IS NULL)"; }
  const rows = await pool.query(
    `SELECT m.id,m.member_id AS "memberId",m.name,m.mobile,m.address,m.shares,m.daily_amount::float AS "dailyAmount",
       m.joining_date::text AS "joiningDate",m.created_at AS "createdAt",m.notes,m.status,COALESCE(SUM(p.amount) FILTER(WHERE p.created_at::date=CURRENT_DATE AND p.status='POSTED'),0)::float AS "todayPaid"
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
    `INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,member_id AS "memberId",name,mobile,address,shares,daily_amount::float AS "dailyAmount",joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status`,
    [b.memberId,b.name,b.mobile ?? "",b.address ?? "",b.shares,b.dailyAmount,b.joiningDate,b.status === "inactive" ? "inactive" : "active",b.notes ?? ""],
  );
  await audit(req.user!.id, "MEMBER_CREATED", `Created ${b.memberId}`, "member", String(r.rows[0].id));
  res.status(201).json({ ...r.rows[0], todayPaid: 0, todayDue: money(b.dailyAmount) });
});
router.post("/members/import", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const rows: Array<Record<string, unknown>> = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
  const cycleId = req.body.cycleId ? Number(req.body.cycleId) : null;
  const settings = await pool.query("SELECT default_daily_per_share::float AS amount FROM fund_settings WHERE id=1");
  const defaultDaily = money(settings.rows[0]?.amount) || 100;
  const normalized = rows.map((row) => ({
    ...row,
    memberId: String(row.memberId ?? "").trim(),
    name: String(row.name ?? "").trim(),
    mobile: String(row.mobile ?? "").trim(),
    address: String(row.address ?? ""),
    shares: Number(row.shares),
    dailyAmount: row.dailyAmount === "" || row.dailyAmount == null ? Number(row.shares) * defaultDaily : Number(row.dailyAmount),
    joiningDate: String(row.joiningDate ?? "").trim() || new Date().toISOString().slice(0, 10),
    status: row.status === "inactive" ? "inactive" : "active",
  }));
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();
  normalized.forEach((row, index) => {
    const id = row.memberId;
    if (!row.name) errors.push({ row: index + 2, message: "Name is required" });
    if (id && seen.has(id)) errors.push({ row: index + 2, message: `Duplicate member ID in file: ${id}` });
    if (id) seen.add(id);
    if (!Number.isInteger(Number(row.shares)) || Number(row.shares) < 1) errors.push({ row: index + 2, message: "Shares must be a positive whole number" });
    if (!Number.isFinite(Number(row.dailyAmount)) || Number(row.dailyAmount) <= 0) errors.push({ row: index + 2, message: "Daily amount must be positive" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.joiningDate ?? ""))) errors.push({ row: index + 2, message: "Joining date must be YYYY-MM-DD" });
  });
  if (cycleId) {
    const cycle = await pool.query("SELECT id,daily_per_share::float AS daily_per_share FROM fund_cycles WHERE id=$1", [cycleId]);
    if (!cycle.rows[0]) errors.push({ row: 1, message: "Selected cycle was not found" });
  }
  if (seen.size) {
    const existing = await pool.query("SELECT member_id FROM fund_members WHERE member_id=ANY($1::text[])", [[...seen]]);
    const ids = new Set(existing.rows.map((r) => r.member_id));
    normalized.forEach((row, index) => {
      if (row.memberId && ids.has(row.memberId) && !cycleId) errors.push({ row: index + 2, message: `Member ID already exists: ${row.memberId}` });
    });
  }
  if (errors.length || req.body.dryRun) return res.json({ valid: Math.max(0, normalized.length - new Set(errors.map((e) => e.row)).size), imported: 0, errors });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let imported = 0;
    for (const row of normalized) {
      let memberId = row.memberId;
      let memberDbId: number;
      if (memberId) {
        const existing = await client.query("SELECT id FROM fund_members WHERE member_id=$1", [memberId]);
        if (existing.rows[0]) memberDbId = existing.rows[0].id;
        else {
          const created = await client.query(`INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [memberId,row.name,row.mobile,row.address,row.shares,row.dailyAmount,row.joiningDate,row.status]);
          memberDbId = created.rows[0].id;
        }
      } else {
        const existing = await client.query(
          `SELECT id FROM fund_members
             WHERE LOWER(TRIM(name))=LOWER(TRIM($1))
               AND (NULLIF($2,'') IS NULL OR mobile=$2)
             ORDER BY id LIMIT 1`,
          [row.name,row.mobile],
        );
        if (existing.rows[0]) memberDbId = existing.rows[0].id;
        else {
          memberId = `M-${randomBytes(4).toString("hex").toUpperCase()}`;
          const created = await client.query(`INSERT INTO fund_members(member_id,name,mobile,address,shares,daily_amount,joining_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [memberId,row.name,row.mobile,row.address,row.shares,row.dailyAmount,row.joiningDate,row.status]);
          memberDbId = created.rows[0].id;
        }
      }
      if (cycleId) {
        const cycle = await client.query("SELECT daily_per_share::float AS daily_per_share FROM fund_cycles WHERE id=$1", [cycleId]);
        const perShare = money(cycle.rows[0]?.daily_per_share) || defaultDaily;
        await client.query(`INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution) VALUES($1,$2,$3,$4)
          ON CONFLICT(cycle_id,member_id) DO UPDATE SET shares=EXCLUDED.shares,daily_contribution=EXCLUDED.daily_contribution`,
          [cycleId,memberDbId,row.shares,row.shares * perShare]);
      }
      imported += 1;
    }
    await client.query("INSERT INTO fund_audit(actor_id,action,detail,entity_type) VALUES($1,'MEMBERS_IMPORTED',$2,'member_import')", [req.user!.id, `${imported} members imported${cycleId ? ` into cycle ${cycleId}` : ""}`]);
    await client.query("COMMIT");
    return res.json({ valid: normalized.length, imported, errors: [] });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Member import failed");
    return res.status(400).json({ error: "Import was cancelled; no rows were saved" });
  } finally { client.release(); }
});
router.patch("/members/:id", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const result = await pool.query(
    `UPDATE fund_members SET name=COALESCE($2,name),mobile=COALESCE($3,mobile),address=COALESCE($4,address),
      status=COALESCE($5,status),notes=COALESCE($6,notes) WHERE id=$1
      RETURNING id,member_id AS "memberId",name,mobile,address,shares,daily_amount::float AS "dailyAmount",
      joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status`,
    [id,b.name ?? null,b.mobile ?? null,b.address ?? null,b.status ?? null,b.notes ?? null],
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Member not found" });
  await audit(req.user!.id, "MEMBER_UPDATED", `Updated ${result.rows[0].memberId}`, "member", String(id));
  return res.json(result.rows[0]);
});
router.get("/members/:id/history", requireAuth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const member = await pool.query(`SELECT id,member_id AS "memberId",name,mobile,address,shares,daily_amount::float AS "dailyAmount",
    joining_date::text AS "joiningDate",created_at AS "createdAt",notes,status FROM fund_members WHERE id=$1`, [id]);
  if (!member.rows[0]) return res.status(404).json({ error: "Member not found" });
  const [cycles, payments, draws] = await Promise.all([
    pool.query(`SELECT c.id AS "cycleId",c.cycle_number AS "cycleNumber",c.name,c.start_date::text AS "startDate",c.end_date::text AS "endDate",
      c.status,cm.shares,cm.daily_contribution::float AS "dailyContribution",
      COALESCE(SUM(p.amount) FILTER(WHERE p.status='POSTED'),0)::float AS "totalCollected"
      FROM fund_cycle_members cm JOIN fund_cycles c ON c.id=cm.cycle_id
      LEFT JOIN fund_payments p ON p.cycle_id=c.id AND p.member_id=cm.member_id
      WHERE cm.member_id=$1 GROUP BY c.id,cm.id ORDER BY c.start_date DESC`, [id]),
    pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.cycle_id AS "cycleId",p.amount::float,p.collection_date::text AS "collectionDate",
      p.shares,p.verification_status AS "verificationStatus",p.status,p.created_at AS "createdAt",u.name AS "collectorName"
      FROM fund_payments p JOIN fund_users u ON u.id=p.collector_id WHERE p.member_id=$1 ORDER BY p.created_at DESC LIMIT 500`, [id]),
    pool.query(`SELECT d.id,d.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",d.draw_number AS "drawNumber",
      d.draw_date::text AS "drawDate",d.winning_amount::float AS "winningAmount",d.status,d.notes
      FROM fund_draws d JOIN fund_cycles c ON c.id=d.cycle_id WHERE d.winner_member_id=$1 ORDER BY d.draw_date DESC`, [id]),
  ]);
  return res.json({ member: member.rows[0], cycles: cycles.rows, payments: payments.rows, draws: draws.rows });
});

router.get("/cycles", requireAuth, async (_req, res) => {
  const result = await pool.query(`SELECT c.id,c.cycle_number AS "cycleNumber",c.name,c.start_date::text AS "startDate",
    c.end_date::text AS "endDate",c.daily_per_share::float AS "dailyPerShare",c.draw_frequency AS "drawFrequency",
    c.draw_day AS "drawDay",c.status,c.notes,c.created_at AS "createdAt",COUNT(cm.id)::int AS "memberCount"
    FROM fund_cycles c LEFT JOIN fund_cycle_members cm ON cm.cycle_id=c.id
    GROUP BY c.id ORDER BY c.start_date DESC,c.cycle_number DESC`);
  return res.json(result.rows);
});
router.post("/cycles", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  if (!String(b.name ?? "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate ?? ""))) {
    return res.status(400).json({ error: "Cycle name and valid start date are required" });
  }
  const number = b.cycleNumber ? Number(b.cycleNumber) : Number((await pool.query("SELECT COALESCE(MAX(cycle_number),0)+1 AS next FROM fund_cycles")).rows[0].next);
  try {
    const result = await pool.query(`INSERT INTO fund_cycles(cycle_number,name,start_date,end_date,daily_per_share,draw_frequency,draw_day,status,notes)
      VALUES($1,$2,$3,$4,$5,'WEEKLY','FRIDAY',$6,$7)
      RETURNING id,cycle_number AS "cycleNumber",name,start_date::text AS "startDate",end_date::text AS "endDate",
      daily_per_share::float AS "dailyPerShare",draw_frequency AS "drawFrequency",draw_day AS "drawDay",status,notes,created_at AS "createdAt"`,
      [number,String(b.name).trim(),b.startDate,b.endDate || null,Number(b.dailyPerShare) > 0 ? Number(b.dailyPerShare) : 100,b.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",b.notes ?? ""]);
    await audit(req.user!.id, "CYCLE_CREATED", `Created ${result.rows[0].name}`, "cycle", String(result.rows[0].id));
    return res.status(201).json({ ...result.rows[0], memberCount: 0 });
  } catch {
    return res.status(409).json({ error: "Cycle number already exists" });
  }
});
router.patch("/cycles/:id", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const result = await pool.query(`UPDATE fund_cycles SET name=COALESCE($2,name),end_date=COALESCE($3,end_date),
    daily_per_share=COALESCE($4,daily_per_share),status=COALESCE($5,status),notes=COALESCE($6,notes)
    WHERE id=$1 RETURNING id,cycle_number AS "cycleNumber",name,start_date::text AS "startDate",end_date::text AS "endDate",
    daily_per_share::float AS "dailyPerShare",draw_frequency AS "drawFrequency",draw_day AS "drawDay",status,notes,created_at AS "createdAt"`,
    [id,b.name ?? null,b.endDate ?? null,b.dailyPerShare ? Number(b.dailyPerShare) : null,b.status ?? null,b.notes ?? null]);
  if (!result.rows[0]) return res.status(404).json({ error: "Cycle not found" });
  await audit(req.user!.id, "CYCLE_UPDATED", `Updated ${result.rows[0].name}`, "cycle", String(id));
  return res.json(result.rows[0]);
});
router.get("/cycles/:id/members", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[] = [Number(req.params.id)];
  let access = "";
  if (req.user?.role === "COLLECTOR") { params.push(req.user.id); access = " AND (m.assigned_collector_id=$2 OR m.assigned_collector_id IS NULL)"; }
  const result = await pool.query(`SELECT cm.id,cm.cycle_id AS "cycleId",m.id AS "memberId",m.member_id AS "memberCode",m.name,m.mobile,
    m.status,cm.shares,cm.daily_contribution::float AS "dailyContribution",
    COALESCE(SUM(p.amount) FILTER(WHERE p.status='POSTED'),0)::float AS "totalCollected",
    GREATEST(cm.daily_contribution-COALESCE(SUM(p.amount) FILTER(WHERE p.collection_date=CURRENT_DATE AND p.status='POSTED'),0),0)::float AS "todayDue"
    FROM fund_cycle_members cm JOIN fund_members m ON m.id=cm.member_id LEFT JOIN fund_payments p ON p.cycle_id=cm.cycle_id AND p.member_id=cm.member_id
    WHERE cm.cycle_id=$1${access} GROUP BY cm.id,m.id ORDER BY m.member_id`, params);
  return res.json(result.rows);
});
router.post("/cycles/:id/members", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const cycleId = Number(req.params.id);
  const memberId = Number(req.body.memberId);
  const shares = Number(req.body.shares);
  const cycle = await pool.query("SELECT daily_per_share::float AS per_share FROM fund_cycles WHERE id=$1", [cycleId]);
  const member = await pool.query("SELECT id FROM fund_members WHERE id=$1", [memberId]);
  if (!cycle.rows[0] || !member.rows[0]) return res.status(404).json({ error: "Cycle or member not found" });
  if (!Number.isInteger(shares) || shares < 1) return res.status(400).json({ error: "Shares must be a positive whole number" });
  const result = await pool.query(`INSERT INTO fund_cycle_members(cycle_id,member_id,shares,daily_contribution)
    VALUES($1,$2,$3,$4) ON CONFLICT(cycle_id,member_id) DO UPDATE SET shares=EXCLUDED.shares,daily_contribution=EXCLUDED.daily_contribution
    RETURNING id,cycle_id AS "cycleId",member_id AS "memberId",shares,daily_contribution::float AS "dailyContribution"`,
    [cycleId,memberId,shares,shares * money(cycle.rows[0].per_share)]);
  await audit(req.user!.id, "CYCLE_MEMBER_UPDATED", `Updated member ${memberId} in cycle ${cycleId}`, "cycle_member", String(result.rows[0].id));
  return res.status(201).json(result.rows[0]);
});

router.get("/draws", requireAuth, async (req, res) => {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (req.query.cycleId) { values.push(Number(req.query.cycleId)); clauses.push(`d.cycle_id=$${values.length}`); }
  if (req.query.memberId) { values.push(Number(req.query.memberId)); clauses.push(`d.winner_member_id=$${values.length}`); }
  if (req.query.date) { values.push(String(req.query.date)); clauses.push(`d.draw_date=$${values.length}`); }
  if (req.query.drawNumber) { values.push(Number(req.query.drawNumber)); clauses.push(`d.draw_number=$${values.length}`); }
  const result = await pool.query(`SELECT d.id,d.cycle_id AS "cycleId",c.cycle_number AS "cycleNumber",c.name AS "cycleName",
    d.draw_number AS "drawNumber",d.draw_date::text AS "drawDate",m.id AS "winnerMemberId",m.member_id AS "winnerMemberCode",
    m.name AS "winnerName",d.winning_amount::float AS "winningAmount",d.status,d.notes,d.created_at AS "createdAt"
    FROM fund_draws d JOIN fund_cycles c ON c.id=d.cycle_id JOIN fund_members m ON m.id=d.winner_member_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY d.draw_date DESC,d.draw_number DESC`, values);
  return res.json(result.rows);
});
router.post("/draws", requireAuth, ownerOnly, async (req: AuthedRequest, res) => {
  const b = req.body;
  const cycleId = Number(b.cycleId);
  const winnerMemberId = Number(b.winnerMemberId);
  if (!cycleId || !winnerMemberId || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.drawDate ?? "")) || Number(b.winningAmount) <= 0) {
    return res.status(400).json({ error: "Cycle, winner, draw date and positive winning amount are required" });
  }
  const membership = await pool.query("SELECT 1 FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2", [cycleId,winnerMemberId]);
  if (!membership.rowCount) return res.status(400).json({ error: "Winner must participate in the selected cycle" });
  const next = await pool.query("SELECT COALESCE(MAX(draw_number),0)+1 AS number FROM fund_draws WHERE cycle_id=$1", [cycleId]);
  try {
    const result = await pool.query(`INSERT INTO fund_draws(cycle_id,draw_number,draw_date,winner_member_id,winning_amount,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,cycle_id AS "cycleId",draw_number AS "drawNumber",draw_date::text AS "drawDate",
      winner_member_id AS "winnerMemberId",winning_amount::float AS "winningAmount",status,notes,created_at AS "createdAt"`,
      [cycleId,Number(next.rows[0].number),b.drawDate,winnerMemberId,Number(b.winningAmount),b.status || "RECORDED",b.notes ?? ""]);
    await audit(req.user!.id, "DRAW_RECORDED", `Recorded draw #${result.rows[0].drawNumber} for cycle ${cycleId}`, "draw", String(result.rows[0].id));
    return res.status(201).json(result.rows[0]);
  } catch {
    return res.status(409).json({ error: "Could not record draw" });
  }
});

router.get("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const params: unknown[] = [];
  const where = req.user?.role === "COLLECTOR" ? (params.push(req.user.id), "WHERE p.collector_id=$1") : "";
  const r = await pool.query(
    `SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.cycle_id AS "cycleId",
       p.collection_date::text AS "collectionDate",p.shares,p.notes,p.amount::float,
       u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status
     FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id ${where}
     ORDER BY p.created_at DESC LIMIT 500`, params);
  res.json(r.rows);
});
router.post("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const { memberId, cycleId, collectionDate, amount, notes, verificationMethod, verificationCode, confirmDuplicate, idempotencyKey } = req.body;
  if (idempotencyKey) {
    const replay = await pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.cycle_id AS "cycleId",p.collection_date::text AS "collectionDate",p.shares,p.notes,p.amount::float,u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id WHERE p.collector_id=$1 AND p.idempotency_key=$2`, [req.user!.id,idempotencyKey]);
    if (replay.rows[0]) return res.status(200).json(replay.rows[0]);
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(collectionDate ?? "")) ? collectionDate : new Date().toISOString().slice(0, 10);
  const duplicate = await pool.query("SELECT 1 FROM fund_payments WHERE member_id=$1 AND cycle_id IS NOT DISTINCT FROM $2 AND collection_date=$3 AND status='POSTED' LIMIT 1", [memberId, cycleId ? Number(cycleId) : null, paidDate]);
  if (duplicate.rowCount && !confirmDuplicate) return res.status(409).json({ error: "A payment already exists today. Confirm to add another or partial payment." });
  const member = await pool.query("SELECT id,name,shares,daily_amount::float AS daily_amount FROM fund_members WHERE id=$1 AND status='active'", [memberId]);
  if (!member.rows[0]) return res.status(404).json({ error: "Active member not found" });
  let paymentShares = Number(member.rows[0].shares);
  if (cycleId) {
    const cycleMember = await pool.query("SELECT shares FROM fund_cycle_members WHERE cycle_id=$1 AND member_id=$2", [Number(cycleId),Number(memberId)]);
    if (!cycleMember.rows[0]) return res.status(400).json({ error: "Member is not enrolled in the selected cycle" });
    paymentShares = Number(cycleMember.rows[0].shares);
  }
  const receiptId = `IRF-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const verification = verificationMethod === "PIN" && verificationCode ? "PIN VERIFIED" : "COLLECTOR CONFIRMED";
  const r = await pool.query(
    `INSERT INTO fund_payments(receipt_id,member_id,cycle_id,collection_date,shares,amount,collector_id,verification_status,notes,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,receipt_id AS "receiptId",member_id AS "memberId",cycle_id AS "cycleId",collection_date::text AS "collectionDate",shares,notes,amount::float,verification_status AS "verificationStatus",created_at AS "createdAt",status`,
    [receiptId,memberId,cycleId ? Number(cycleId) : null,paidDate,paymentShares,amount,req.user!.id,verification,notes ?? "",idempotencyKey ?? null],
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
  const b=req.body;
  if (b.idempotencyKey) {
    const replay=await pool.query(`SELECT s.id,s.amount::float,u.name AS "collectorName",s.reference,s.created_at AS "createdAt" FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id WHERE s.collector_id=$1 AND s.idempotency_key=$2`,[req.user!.id,b.idempotencyKey]);
    if(replay.rows[0]) return res.status(200).json(replay.rows[0]);
  }
  const r=await pool.query(`INSERT INTO fund_settlements(collector_id,amount,reference,note,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING id,amount::float,reference,created_at AS "createdAt"`,[req.user!.id,b.amount,b.reference,b.note??"",b.idempotencyKey??null]);
  await audit(req.user!.id,"SETTLEMENT_CREATED",`${b.reference}: BDT ${b.amount}`,"settlement",String(r.rows[0].id));
  return res.status(201).json({...r.rows[0],collectorName:req.user!.name});
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
router.get("/audit",requireAuth,ownerOnly,async(_req,res)=>{const r=await pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.created_at AS "createdAt" FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300`);res.json(r.rows);});
router.get("/settings",requireAuth,async(_req,res)=>{const r=await pool.query(`SELECT organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional" FROM fund_settings WHERE id=1`);res.json(r.rows[0]);});
router.patch("/settings",requireAuth,ownerOnly,async(req:AuthedRequest,res)=>{const b=req.body;const r=await pool.query(`UPDATE fund_settings SET organization_name=COALESCE($1,organization_name),expected_members=COALESCE($2,expected_members),default_daily_per_share=COALESCE($3,default_daily_per_share) WHERE id=1 RETURNING organization_name AS "organizationName",expected_members AS "expectedMembers",default_daily_per_share::float AS "defaultDailyPerShare",demo_mode AS "demoMode",biometric_optional AS "biometricOptional"`,[b.organizationName??null,b.expectedMembers??null,b.defaultDailyPerShare??null]);await audit(req.user!.id,"SETTINGS_UPDATED","Business settings updated");res.json(r.rows[0]);});

router.get("/dashboard",requireAuth,async(req:AuthedRequest,res)=>{
   const activeCycleExists = "EXISTS (SELECT 1 FROM fund_cycles WHERE status='ACTIVE')";
   const paymentCycleScope = `(NOT ${activeCycleExists} OR p.cycle_id=(SELECT id FROM fund_cycles WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1))`;
  if(req.user!.role==="COLLECTOR"){
    const [members,payments,settlements,due,recent]=await Promise.all([
       pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(COALESCE(cm.daily_contribution,m.daily_amount)),0)::float target
         FROM fund_members m LEFT JOIN fund_cycle_members cm ON cm.member_id=m.id
         LEFT JOIN fund_cycles c ON c.id=cm.cycle_id AND c.status='ACTIVE'
         WHERE m.status='active' AND (m.assigned_collector_id=$1 OR m.assigned_collector_id IS NULL)
           AND (c.id IS NOT NULL OR NOT ${activeCycleExists})`,[req.user!.id]),
       pool.query(`SELECT COALESCE(SUM(amount),0)::float amount,COUNT(*)::int count FROM fund_payments p
         WHERE collector_id=$1 AND created_at::date=CURRENT_DATE AND status='POSTED' AND ${paymentCycleScope}`,[req.user!.id]),
      pool.query("SELECT COALESCE(SUM(amount),0)::float amount FROM fund_settlements WHERE collector_id=$1 AND created_at::date=CURRENT_DATE",[req.user!.id]),
       pool.query(`SELECT m.id,m.member_id AS "memberId",m.name,m.mobile,m.address,
         COALESCE(cm.shares,m.shares)::int AS shares,COALESCE(cm.daily_contribution,m.daily_amount)::float AS "dailyAmount",
         m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount),0)::float AS "todayPaid"
         FROM fund_members m LEFT JOIN fund_cycle_members cm ON cm.member_id=m.id
         LEFT JOIN fund_cycles c ON c.id=cm.cycle_id AND c.status='ACTIVE'
         LEFT JOIN fund_payments p ON p.member_id=m.id AND p.created_at::date=CURRENT_DATE AND p.status='POSTED' AND ${paymentCycleScope}
         WHERE m.status='active' AND (m.assigned_collector_id=$1 OR m.assigned_collector_id IS NULL)
           AND (c.id IS NOT NULL OR NOT ${activeCycleExists})
         GROUP BY m.id,cm.shares,cm.daily_contribution,c.id
         HAVING COALESCE(SUM(p.amount),0)<COALESCE(cm.daily_contribution,m.daily_amount)
         ORDER BY m.member_id LIMIT 20`,[req.user!.id]),
       pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.amount::float,u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id WHERE p.collector_id=$1 AND ${paymentCycleScope} ORDER BY p.created_at DESC LIMIT 8`,[req.user!.id])
    ]);
    const target=money(members.rows[0].target),collected=money(payments.rows[0].amount),deposits=money(settlements.rows[0].amount);
    return res.json({totalMembers:members.rows[0].count,todayTarget:target,collected,due:Math.max(0,target-collected),collectorCash:collected,officeDeposits:deposits,unsettledCash:collected-deposits,paymentCount:payments.rows[0].count,performances:[{name:req.user!.name,collected,payments:payments.rows[0].count,cash:collected-deposits}],dueMembers:due.rows.map(m=>({...m,todayDue:money(m.dailyAmount)-money(m.todayPaid)})),recentPayments:recent.rows,audit:[]});
  }
  const [members,payments,settlements,perf,due,recent,audits]=await Promise.all([
     pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(COALESCE(cm.daily_contribution,m.daily_amount)),0)::float target
       FROM fund_members m LEFT JOIN fund_cycle_members cm ON cm.member_id=m.id
       LEFT JOIN fund_cycles c ON c.id=cm.cycle_id AND c.status='ACTIVE'
       WHERE m.status='active' AND (c.id IS NOT NULL OR NOT ${activeCycleExists})`),
     pool.query(`SELECT COALESCE(SUM(amount),0)::float amount,COUNT(*)::int count FROM fund_payments p WHERE created_at::date=CURRENT_DATE AND status='POSTED' AND ${paymentCycleScope}`),
    pool.query("SELECT COALESCE(SUM(amount),0)::float amount FROM fund_settlements WHERE created_at::date=CURRENT_DATE"),
     pool.query(`SELECT u.name,COALESCE(SUM(p.amount),0)::float collected,COUNT(p.id)::int payments,(COALESCE(SUM(p.amount),0)-COALESCE((SELECT SUM(s.amount) FROM fund_settlements s WHERE s.collector_id=u.id),0))::float cash FROM fund_users u LEFT JOIN fund_payments p ON p.collector_id=u.id AND p.created_at::date=CURRENT_DATE AND p.status='POSTED' AND ${paymentCycleScope} WHERE u.role='COLLECTOR' GROUP BY u.id ORDER BY collected DESC`),
     pool.query(`SELECT m.id,m.member_id AS "memberId",m.name,m.mobile,m.address,COALESCE(cm.shares,m.shares)::int AS shares,COALESCE(cm.daily_contribution,m.daily_amount)::float AS "dailyAmount",m.joining_date::text AS "joiningDate",m.status,COALESCE(SUM(p.amount),0)::float AS "todayPaid"
       FROM fund_members m LEFT JOIN fund_cycle_members cm ON cm.member_id=m.id
       LEFT JOIN fund_cycles c ON c.id=cm.cycle_id AND c.status='ACTIVE'
       LEFT JOIN fund_payments p ON p.member_id=m.id AND p.created_at::date=CURRENT_DATE AND p.status='POSTED' AND ${paymentCycleScope}
       WHERE m.status='active' AND (c.id IS NOT NULL OR NOT ${activeCycleExists})
       GROUP BY m.id,cm.shares,cm.daily_contribution,c.id
       HAVING COALESCE(SUM(p.amount),0)<COALESCE(cm.daily_contribution,m.daily_amount)
       ORDER BY m.member_id LIMIT 20`),
     pool.query(`SELECT p.id,p.receipt_id AS "receiptId",p.member_id AS "memberId",m.name AS "memberName",p.amount::float,u.name AS "collectorName",p.verification_status AS "verificationStatus",p.created_at AS "createdAt",p.status FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id WHERE ${paymentCycleScope} ORDER BY p.created_at DESC LIMIT 8`),
    pool.query(`SELECT a.id,COALESCE(u.name,'System') actor,a.action,a.detail,a.created_at AS "createdAt" FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 8`)
  ]);
  const target=money(members.rows[0].target), collected=money(payments.rows[0].amount), deposits=money(settlements.rows[0].amount);
  return res.json({totalMembers:members.rows[0].count,todayTarget:target,collected,due:Math.max(0,target-collected),collectorCash:collected,officeDeposits:deposits,unsettledCash:collected-deposits,paymentCount:payments.rows[0].count,performances:perf.rows,dueMembers:due.rows.map(m=>({...m,todayDue:money(m.dailyAmount)-money(m.todayPaid)})),recentPayments:recent.rows,audit:audits.rows});
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

  if (type === "members") {
    const r = await pool.query(`SELECT member_id,name,mobile,address,shares,daily_amount,joining_date,status
      FROM fund_members ORDER BY member_id`);
    return sendCsv(res, "members-backup", ["Member ID", "Name", "Mobile", "Address", "Shares", "Daily Amount", "Joining Date", "Status"],
      r.rows.map((x) => [x.member_id, x.name, x.mobile, x.address, x.shares, x.daily_amount, x.joining_date, x.status]));
  }

  if (type === "collectors") {
    const r = await pool.query(`SELECT id,name,username,role,active
      FROM fund_users ORDER BY role,name`);
    return sendCsv(res, "collectors-backup", ["Collector ID", "Name", "Username", "Role", "Active"],
      r.rows.map((x) => [x.id, x.name, x.username, x.role, x.active]));
  }

  if (type === "settlements" || type === "settlement") {
    const r = await pool.query(`SELECT s.id,u.id AS collector_id,u.name AS collector_name,
      s.created_at::date AS settlement_date,s.amount,s.reference,s.note
      FROM fund_settlements s JOIN fund_users u ON u.id=s.collector_id
      ORDER BY s.created_at DESC`);
    return sendCsv(res, "settlements-backup", ["Settlement ID", "Collector ID", "Collector", "Date", "Deposited Amount", "Reference", "Notes"],
      r.rows.map((x) => [x.id, x.collector_id, x.collector_name, x.settlement_date, x.amount, x.reference, x.note]));
  }

  if (type === "audit") {
    const r = await pool.query(`SELECT a.id,a.created_at,COALESCE(u.name,'System') AS actor,
      COALESCE(u.role,'SYSTEM') AS role,a.action,a.entity_type,a.entity_id,a.detail
      FROM fund_audit a LEFT JOIN fund_users u ON u.id=a.actor_id
      ORDER BY a.created_at DESC`);
    return sendCsv(res, "audit-backup", ["Audit ID", "Timestamp", "User", "Role", "Action", "Entity Type", "Entity ID", "Details"],
      r.rows.map((x) => [x.id, x.created_at, x.actor, x.role, x.action, x.entity_type, x.entity_id, x.detail]));
  }

  if (type === "due") {
    const r = await pool.query(`SELECT m.member_id,m.name,m.mobile,m.shares,m.daily_amount,
      COALESCE(SUM(p.amount) FILTER (WHERE p.created_at::date=CURRENT_DATE AND p.status='POSTED'),0)::float AS today_paid,
      GREATEST(m.daily_amount-COALESCE(SUM(p.amount) FILTER (WHERE p.created_at::date=CURRENT_DATE AND p.status='POSTED'),0),0)::float AS today_due
      FROM fund_members m LEFT JOIN fund_payments p ON p.member_id=m.id
      WHERE m.status='active' GROUP BY m.id
      HAVING COALESCE(SUM(p.amount) FILTER (WHERE p.created_at::date=CURRENT_DATE AND p.status='POSTED'),0) < m.daily_amount
      ORDER BY m.member_id`);
    return sendCsv(res, "due-members", ["Member ID", "Name", "Mobile", "Shares", "Daily Amount", "Today Paid", "Today Due"],
      r.rows.map((x) => [x.member_id, x.name, x.mobile, x.shares, x.daily_amount, x.today_paid, x.today_due]));
  }

  if (type === "collector") {
    const r = await pool.query(`SELECT u.id,u.name,COUNT(p.id)::int AS payment_count,
      COALESCE(SUM(p.amount),0)::float AS collected
      FROM fund_users u LEFT JOIN fund_payments p ON p.collector_id=u.id AND p.status='POSTED'
      WHERE u.role='COLLECTOR' GROUP BY u.id ORDER BY u.name`);
    return sendCsv(res, "collector-collection", ["Collector ID", "Collector", "Payment Count", "Collected Amount"],
      r.rows.map((x) => [x.id, x.name, x.payment_count, x.collected]));
  }

  const period = type === "weekly" ? "p.created_at >= CURRENT_DATE - INTERVAL '6 days'"
    : type === "monthly" ? "p.created_at >= date_trunc('month', CURRENT_DATE)"
    : type === "daily" ? "p.created_at::date = CURRENT_DATE"
    : "TRUE";
  const r = await pool.query(`SELECT p.id AS payment_id,p.receipt_id,m.member_id,m.name AS member_name,
      p.created_at::date AS payment_date,p.created_at::time AS payment_time,p.amount,
      p.verification_status,u.id AS collector_id,u.name AS collector_name,p.status,p.idempotency_key,p.created_at
      FROM fund_payments p JOIN fund_members m ON m.id=p.member_id JOIN fund_users u ON u.id=p.collector_id
      WHERE ${period} ORDER BY p.created_at DESC`);
  return sendCsv(res, `payments-${type || "all"}`, ["Payment ID", "Receipt ID", "Member ID", "Member", "Payment Date", "Payment Time", "Amount", "Verification", "Collector ID", "Collector", "Status", "Idempotency Key", "Created At"],
    r.rows.map((x) => [x.payment_id, x.receipt_id, x.member_id, x.member_name, x.payment_date, x.payment_time, x.amount, x.verification_status, x.collector_id, x.collector_name, x.status, x.idempotency_key, x.created_at]));
});

export default router;