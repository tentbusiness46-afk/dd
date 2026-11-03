// Everything that changes data. Only the super admin can use these routes.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { all, one, run, batch, getSettings, setSettings } from "../db.js";
import { requireAuth, role, sign } from "../auth.js";
import { PERMS, cleanPerms, parsePerms, defaultPerms, allPerms } from "../perms.js";
import { leadFilter } from "../leadFilter.js";
import { newId, normPhone, now, str, personName, fail, todayLocal, OPEN_SQL, placeholders, chunk } from "../util.js";

const r = Router();
r.use("/manage", requireAuth, role("superadmin"));

async function activeCaller(id) {
  const c = await one("SELECT id, active FROM users WHERE id = ? AND role = 'caller'", [id]);
  if (!c || !c.active) fail(400, "That caller wasn't found or is inactive.");
  return c;
}
async function phoneFree(phone, exceptId = "") {
  const hit = await one("SELECT id FROM users WHERE phone = ? AND id <> ?", [phone, exceptId]);
  if (hit) fail(409, "This mobile number is already used by another login. Use a different number.");
}

/** Lead ids from either an explicit list or "every lead matching these filters". */
const SUPER_VIEW = { perms: allPerms(), picked: false, adminId: null, real: true };
async function resolveIds(body) {
  if (body?.filter && typeof body.filter === "object") {
    const { where, args } = leadFilter(body.filter, SUPER_VIEW);
    return (await all(`SELECT id FROM leads WHERE ${where} LIMIT 100000`, args)).map((x) => x.id);
  }
  return (Array.isArray(body?.ids) ? body.ids : []).map(String).slice(0, 100000);
}
async function shareLeads(adminId, ids, add) {
  const stmts = chunk(ids).map((part) => add
    ? { sql: `INSERT OR IGNORE INTO admin_leads (admin_id, lead_id) SELECT ?, id FROM leads WHERE id IN (${placeholders(part.length)})`, args: [adminId, ...part] }
    : { sql: `DELETE FROM admin_leads WHERE admin_id = ? AND lead_id IN (${placeholders(part.length)})`, args: [adminId, ...part] });
  return batch(stmts, 50);
}
async function getAdmin(id) {
  const a = await one("SELECT * FROM users WHERE id = ? AND role = 'admin'", [id]);
  if (!a) fail(404, "Admin not found.");
  return a;
}

/* ---------------- Leads ---------------- */
r.post("/manage/leads", async (req, res) => {
  const b = req.body || {}, phone = normPhone(b.phone);
  if (phone.length < 10) fail(400, "Enter a valid 10-digit mobile number.");
  if (b.assignedTo) await activeCaller(b.assignedTo);
  if (await one("SELECT id FROM leads WHERE phone_norm = ?", [phone])) fail(409, "A lead with this number already exists.");
  await run("INSERT INTO leads (id, name, phone, phone_norm, city, source, assigned_to, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [newId(), str(b.name, 100) || "(no name)", str(b.phone, 20), phone, str(b.city, 80), str(b.source, 80), b.assignedTo || null, now()]);
  res.status(201).json({ ok: true });
});

r.post("/manage/leads/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) fail(400, "No rows to import.");
  if (rows.length > 20000) fail(400, "Import up to 20,000 rows at a time. Split the file and try again.");
  const mode = String(req.body.assign ?? "");
  const callers = await all("SELECT id, name FROM users WHERE role = 'caller' AND active = 1 ORDER BY name");
  const byName = Object.fromEntries(callers.map((c) => [c.name.trim().toLowerCase(), c.id]));
  if (mode && !["rr", "file"].includes(mode) && !callers.find((c) => c.id === mode)) fail(400, "That caller wasn't found or is inactive.");
  const showTo = req.body.showTo ? (await getAdmin(String(req.body.showTo))).id : null;

  const t = now(), seen = new Set(), stmts = [];
  let i = 0, invalid = 0;
  for (const row of rows) {
    const phone = normPhone(row.phone);
    if (phone.length < 10) { invalid++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    let to = null;
    if (mode === "rr" && callers.length) to = callers[i++ % callers.length].id;
    else if (mode === "file") to = byName[String(row.caller || "").trim().toLowerCase()] || null;
    else if (mode && mode !== "rr") to = mode;
    stmts.push({
      sql: "INSERT OR IGNORE INTO leads (id, name, phone, phone_norm, city, source, assigned_to, created_at) VALUES (?,?,?,?,?,?,?,?)",
      args: [newId(), str(row.name, 100) || "(no name)", str(row.phone, 20), phone, str(row.city, 80), str(row.source || req.body.defaultSource, 80), to, t],
    });
  }
  const added = await batch(stmts);
  let shared = 0;
  if (showTo && seen.size) {
    const phones = [...seen];
    const ids = [];
    for (const part of chunk(phones)) ids.push(...(await all(`SELECT id FROM leads WHERE phone_norm IN (${placeholders(part.length)})`, part)).map((x) => x.id));
    shared = await shareLeads(showTo, ids, true);
  }
  res.json({ added, duplicates: rows.length - invalid - added, invalid, shared });
});

r.post("/manage/leads/assign", async (req, res) => {
  const ids = await resolveIds(req.body);
  const to = req.body?.callerId || null;
  if (to) await activeCaller(to);
  const stmts = chunk(ids).map((part) => ({ sql: `UPDATE leads SET assigned_to = ? WHERE id IN (${placeholders(part.length)})`, args: [to, ...part] }));
  res.json({ updated: await batch(stmts, 50) });
});

r.post("/manage/leads/distribute", async (req, res) => {
  const callers = await all(
    `SELECT u.id, (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = u.id AND l.called = 0) load
     FROM users u WHERE u.role = 'caller' AND u.active = 1`);
  if (!callers.length) fail(400, "Add a caller first.");
  const ids = (await all("SELECT id FROM leads WHERE assigned_to IS NULL ORDER BY created_at")).map((x) => x.id);
  const groups = Object.fromEntries(callers.map((c) => [c.id, []]));
  for (const id of ids) { callers.sort((a, b) => a.load - b.load); groups[callers[0].id].push(id); callers[0].load++; }
  const stmts = [];
  for (const [cid, list] of Object.entries(groups))
    for (const part of chunk(list)) stmts.push({ sql: `UPDATE leads SET assigned_to = ? WHERE id IN (${placeholders(part.length)})`, args: [cid, ...part] });
  await batch(stmts, 50);
  res.json({ updated: ids.length });
});

r.post("/manage/leads/delete", async (req, res) => {
  const ids = await resolveIds(req.body);
  const stmts = [];
  for (const part of chunk(ids)) {
    stmts.push({ sql: `DELETE FROM admin_leads WHERE lead_id IN (${placeholders(part.length)})`, args: part });
    stmts.push({ sql: `DELETE FROM call_logs WHERE lead_id IN (${placeholders(part.length)})`, args: part });
    stmts.push({ sql: `DELETE FROM leads WHERE id IN (${placeholders(part.length)})`, args: part });
  }
  await batch(stmts, 50);
  res.json({ deleted: ids.length });
});

/* ---------------- Callers ---------------- */
r.get("/manage/callers", async (req, res) => {
  const [callers, load] = await Promise.all([
    all("SELECT id, name, phone, active, created_at FROM users WHERE role = 'caller' ORDER BY active DESC, name"),
    all("SELECT assigned_to, COUNT(*) assigned, SUM(called = 0) pending FROM leads WHERE assigned_to IS NOT NULL GROUP BY assigned_to"),
  ]);
  const D = Object.fromEntries(load.map((x) => [x.assigned_to, x]));
  res.json(callers.map((c) => ({ ...c, active: !!c.active, assigned: D[c.id]?.assigned || 0, pending: D[c.id]?.pending || 0 })));
});

r.post("/manage/callers", async (req, res) => {
  const name = personName(req.body?.name), phone = normPhone(req.body?.phone), pw = String(req.body?.password || "");
  if (!name) fail(400, "Enter the caller's name.");
  if (phone.length !== 10) fail(400, "Enter a valid 10-digit mobile number.");
  if (pw.length < 6) fail(400, "Password must be at least 6 characters.");
  await phoneFree(phone);
  await run("INSERT INTO users (id, role, name, phone, password_hash, created_at) VALUES (?, 'caller', ?, ?, ?, ?)",
    [newId(), name, phone, await bcrypt.hash(pw, 10), now()]);
  res.status(201).json({ ok: true });
});

r.patch("/manage/callers/:id", async (req, res) => {
  const c = await one("SELECT id, active FROM users WHERE id = ? AND role = 'caller'", [req.params.id]);
  if (!c) fail(404, "Caller not found.");
  const b = req.body || {}, sets = [], args = [];
  if ("name" in b) { const n = personName(b.name); if (!n) fail(400, "Enter the caller's name."); sets.push("name = ?"); args.push(n); }
  if ("phone" in b) { const p = normPhone(b.phone); if (p.length !== 10) fail(400, "Enter a valid 10-digit mobile number."); await phoneFree(p, c.id); sets.push("phone = ?"); args.push(p); }
  if (b.password) { if (String(b.password).length < 6) fail(400, "Password must be at least 6 characters."); sets.push("password_hash = ?", "pw_changed_at = ?"); args.push(await bcrypt.hash(String(b.password), 10), now()); }
  if ("active" in b) { sets.push("active = ?"); args.push(b.active ? 1 : 0); }
  if (sets.length) await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...args, c.id]);
  let released = 0;
  if ("active" in b && !b.active) released = (await run(`UPDATE leads SET assigned_to = NULL WHERE assigned_to = ? AND ${OPEN_SQL}`, [c.id])).rowsAffected;
  res.json({ ok: true, released });
});

/* ---------------- Expenses ---------------- */
r.post("/manage/expenses", async (req, res) => {
  const b = req.body || {}, amount = +b.amount;
  if (!(amount > 0)) fail(400, "Enter an amount greater than zero.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : todayLocal();
  await run("INSERT INTO expenses (id, date, category, amount, note, created_at) VALUES (?,?,?,?,?,?)",
    [newId(), date, str(b.category, 60) || "Other", amount, str(b.note, 200), now()]);
  res.status(201).json({ ok: true });
});
r.delete("/manage/expenses/:id", async (req, res) => {
  await run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

/* ---------------- Admins (view-only accounts) ---------------- */
r.get("/manage/perm-defs", (req, res) => res.json(PERMS));

r.get("/manage/admins", async (req, res) => {
  const [rows, counts] = await Promise.all([
    all("SELECT id, name, phone, active, perms, scope, revenue_amount, revenue_note, revenue_updated_at, created_at FROM users WHERE role = 'admin' ORDER BY active DESC, name"),
    all("SELECT admin_id, COUNT(*) n FROM admin_leads GROUP BY admin_id"),
  ]);
  const N = Object.fromEntries(counts.map((c) => [c.admin_id, c.n]));
  res.json(rows.map((a) => ({
    id: a.id, name: a.name, phone: a.phone, active: !!a.active, perms: parsePerms(a.perms),
    leadAccess: a.scope === "picked" ? "picked" : "all", sharedLeads: N[a.id] || 0,
    revenueAmount: a.revenue_amount, revenueNote: a.revenue_note || "", revenueUpdatedAt: a.revenue_updated_at, createdAt: a.created_at,
  })));
});

function readRevenue(b) {
  if (!("revenueAmount" in b)) return undefined;
  if (b.revenueAmount === "" || b.revenueAmount == null) return null;
  const n = +b.revenueAmount;
  if (!(n >= 0)) fail(400, "Revenue must be a number, or blank.");
  return n;
}

r.post("/manage/admins", async (req, res) => {
  const b = req.body || {}, name = personName(b.name), phone = normPhone(b.phone), pw = String(b.password || "");
  if (!name) fail(400, "Enter the admin's name.");
  if (phone.length !== 10) fail(400, "Enter a valid 10-digit mobile number.");
  if (pw.length < 6) fail(400, "Password must be at least 6 characters.");
  await phoneFree(phone);
  const rev = readRevenue(b) ?? null;
  await run(`INSERT INTO users (id, role, name, phone, password_hash, perms, scope, revenue_amount, revenue_note, revenue_updated_at, created_at)
             VALUES (?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), name, phone, await bcrypt.hash(pw, 10), JSON.stringify(cleanPerms(b.perms, defaultPerms())),
     b.leadAccess === "all" ? null : "picked", rev, str(b.revenueNote, 120), rev == null ? null : now(), now()]);
  res.status(201).json({ ok: true });
});

r.patch("/manage/admins/:id", async (req, res) => {
  const a = await getAdmin(req.params.id);
  const b = req.body || {}, sets = [], args = [];
  if ("name" in b) { const n = personName(b.name); if (!n) fail(400, "Enter the admin's name."); sets.push("name = ?"); args.push(n); }
  if ("phone" in b) { const p = normPhone(b.phone); if (p.length !== 10) fail(400, "Enter a valid 10-digit mobile number."); if (p !== a.phone) await phoneFree(p, a.id); sets.push("phone = ?"); args.push(p); }
  if (b.password) { if (String(b.password).length < 6) fail(400, "New password must be at least 6 characters."); sets.push("password_hash = ?", "pw_changed_at = ?"); args.push(await bcrypt.hash(String(b.password), 10), now()); }
  if ("active" in b) { sets.push("active = ?"); args.push(b.active ? 1 : 0); }
  if ("perms" in b) { sets.push("perms = ?"); args.push(JSON.stringify(cleanPerms(b.perms, parsePerms(a.perms)))); }
  if ("leadAccess" in b) { sets.push("scope = ?"); args.push(b.leadAccess === "all" ? null : "picked"); }
  const rev = readRevenue(b);
  if (rev !== undefined && rev !== a.revenue_amount) { sets.push("revenue_amount = ?", "revenue_updated_at = ?"); args.push(rev, rev == null ? null : now()); }
  if ("revenueNote" in b) { sets.push("revenue_note = ?"); args.push(str(b.revenueNote, 120)); }
  if (sets.length) await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...args, a.id]);
  res.json({ ok: true });
});

/** Show or hide leads for an admin: { action: "add" | "remove", ids: [...] } or { action, filter: {...} } */
r.post("/manage/admins/:id/leads", async (req, res) => {
  const a = await getAdmin(req.params.id);
  const add = req.body?.action !== "remove";
  const ids = await resolveIds(req.body);
  const changed = await shareLeads(a.id, ids, add);
  res.json({ changed });
});

/** Open an admin's portal exactly as they see it (2-hour session). */
r.post("/manage/admins/:id/view", async (req, res) => {
  const a = await one("SELECT id, role, active FROM users WHERE id = ? AND role = 'admin'", [req.params.id]);
  if (!a) fail(404, "Admin not found.");
  if (!a.active) fail(400, "Turn this admin's account on first.");
  res.json({ token: sign(a, { imp: req.user.id }, "2h") });
});

/* ---------------- Settings ---------------- */
r.get("/manage/settings", async (req, res) => res.json(await getSettings()));
r.patch("/manage/settings", async (req, res) => {
  const b = req.body || {}, patch = {};
  if ("businessName" in b) { const n = str(b.businessName, 80); if (!n) fail(400, "Enter a business name."); patch.businessName = n; }
  if ("callerRevenue" in b) patch.callerRevenue = !!b.callerRevenue;
  await setSettings(patch);
  res.json(await getSettings());
});

export default r;
