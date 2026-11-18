// Read-only routes shared by the super admin (sees everything) and admins (see only what's shared with them).
import { Router } from "express";
import { all, one, batch } from "../db.js";
import { requireAuth, role, can } from "../auth.js";
import { fail, range, todayLocal, maskPhone, scopeSql, parseDetails, newId, now, str, PICKED, OUTCOMES } from "../util.js";
import { leadFilter } from "../leadFilter.js";

const r = Router();
r.use("/view", requireAuth, role("superadmin", "admin"));

export const EXP_CATS = ["Meta Ads", "Google Ads", "Lead data purchase", "Caller salaries", "Telecom / SIM", "Software", "Other"];

/** Remove whatever this viewer isn't allowed to see from a lead-like row. Admins never get real sale values. */
function shape(row, view) {
  const P = view.perms, o = { ...row };
  if ("called" in o) o.called = !!o.called;
  if (!P.phones && o.phone) o.phone = maskPhone(o.phone);
  delete o.phone_norm;
  if (!P.notes) delete o.remarks;
  // Form answers (e.g. from Meta lead forms) count as call notes for admins.
  if ("details" in o) { o.details = P.notes ? parseDetails(o.details) : null; if (o.details && !P.phones && o.details.WhatsApp) o.details.WhatsApp = maskPhone(o.details.WhatsApp); }
  if (!view.real) delete o.deal_value;
  return o;
}

r.get("/view/callers", async (req, res) => {
  if (req.view.real) return res.json(await all("SELECT id, name, active FROM users WHERE role = 'caller' ORDER BY active DESC, name"));
  const s = scopeSql(req.view, "id");
  res.json(await all(`SELECT id, name, active FROM users WHERE role = 'caller' AND id IN (SELECT assigned_to FROM leads WHERE ${s.sql}) ORDER BY name`, s.args));
});

/* ---------------- Overview ---------------- */
r.get("/view/stats", async (req, res) => {
  const V = req.view, P = V.perms, { from, to, fromD, toD } = range(req.query);
  const L = scopeSql(V, "id"), C = scopeSql(V, "lead_id");

  const [cohort, current, sales] = await Promise.all([
    one(`SELECT COUNT(*) total, COALESCE(SUM(called = 1),0) called, COALESCE(SUM(picked = 'yes'),0) picked,
                COALESCE(SUM(outcome IN ('interested','callback','converted')),0) warm, COALESCE(SUM(outcome = 'converted'),0) won
         FROM leads WHERE created_at BETWEEN ? AND ? AND ${L.sql}`, [from, to, ...L.args]),
    one(`SELECT COUNT(*) total, COALESCE(SUM(assigned_to IS NULL),0) unassigned, COALESCE(SUM(called = 0),0) pending
         FROM leads WHERE ${L.sql}`, L.args),
    one(`SELECT COUNT(*) won, COALESCE(SUM(deal_value),0) rev FROM leads
         WHERE outcome = 'converted' AND converted_at BETWEEN ? AND ? AND ${L.sql}`, [from, to, ...L.args]),
  ]);
  const out = {
    leads: { added: cohort.total, total: current.total, pending: current.pending },
    sales: { won: sales.won },
  };
  if (V.real) out.leads.unassigned = current.unassigned;

  if (P.followUps) {
    const F = scopeSql(V, "l.id");
    const rows = await all(
      `SELECT l.id, l.name, l.phone, l.city, l.remarks, l.follow_up, u.name caller
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.picked = 'yes' AND l.outcome = 'callback' AND COALESCE(l.follow_up,'') <= ? AND ${F.sql}
       ORDER BY l.follow_up LIMIT 50`, [todayLocal(), ...F.args]);
    out.followUps = rows.map((x) => shape(x, V));
  }
  if (P.calls) {
    const c = await one(`SELECT COUNT(*) made, COALESCE(SUM(picked = 'yes'),0) picked FROM call_logs WHERE is_call = 1 AND created_at BETWEEN ? AND ? AND ${C.sql}`, [from, to, ...C.args]);
    out.calls = {
      made: c.made, picked: c.picked,
      funnel: [["Leads added", cohort.total], ["Called", cohort.called], ["Picked up", cohort.picked], ["Interested+", cohort.warm], ["Converted", cohort.won]],
    };
  }

  // Money. Super admin: real figures. Admin: only the figure the super admin typed for them.
  if (V.real) {
    const spend = (await one("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date BETWEEN ? AND ?", [fromD, toD])).s;
    const rev = sales.rev;
    out.revenue = { total: rev };
    out.expenses = {
      total: spend,
      byCategory: await all("SELECT category, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC", [fromD, toD]),
    };
    out.roi = {
      spend, profit: rev - spend,
      roi: spend ? ((rev - spend) / spend) * 100 : null,
      multiple: spend ? rev / spend : null,
      costPerLead: cohort.total ? spend / cohort.total : null,
      costPerSale: sales.won ? spend / sales.won : null,
    };
  } else if (P.revenue && req.user.revenue_amount != null) {
    out.revenue = { total: req.user.revenue_amount, note: req.user.revenue_note || "", updatedAt: req.user.revenue_updated_at, manual: true };
  }

  if (P.callerPerformance) {
    const [logs, won, load] = await Promise.all([
      all(`SELECT caller_id, COUNT(*) made, SUM(picked = 'yes') picked FROM call_logs WHERE is_call = 1 AND created_at BETWEEN ? AND ? AND ${C.sql} GROUP BY caller_id`, [from, to, ...C.args]),
      all(`SELECT assigned_to, COUNT(*) won, SUM(deal_value) rev FROM leads WHERE outcome = 'converted' AND converted_at BETWEEN ? AND ? AND ${L.sql} GROUP BY assigned_to`, [from, to, ...L.args]),
      all(`SELECT assigned_to, COUNT(*) assigned, SUM(called = 0) pending FROM leads WHERE assigned_to IS NOT NULL AND ${L.sql} GROUP BY assigned_to`, L.args),
    ]);
    const ids = [...new Set([...logs.map((x) => x.caller_id), ...won.map((x) => x.assigned_to), ...load.map((x) => x.assigned_to)])];
    const callers = V.real
      ? await all("SELECT id, name, active FROM users WHERE role = 'caller' ORDER BY name")
      : ids.length ? await all(`SELECT id, name, active FROM users WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY name`, ids) : [];
    const Lg = Object.fromEntries(logs.map((x) => [x.caller_id, x]));
    const W = Object.fromEntries(won.map((x) => [x.assigned_to, x]));
    const D = Object.fromEntries(load.map((x) => [x.assigned_to, x]));
    out.callers = callers
      .filter((c) => (V.real ? c.active : true) || Lg[c.id] || W[c.id])
      .map((c) => {
        const row = { id: c.id, name: c.name, active: !!c.active, assigned: D[c.id]?.assigned || 0, pending: D[c.id]?.pending || 0,
          calls: Lg[c.id]?.made || 0, picked: Lg[c.id]?.picked || 0, sales: W[c.id]?.won || 0 };
        if (V.real) row.revenue = W[c.id]?.rev || 0;
        return row;
      });
  }
  if (P.sources) {
    const [src, srcWon] = await Promise.all([
      all(`SELECT COALESCE(NULLIF(source,''),'Unknown') source, COUNT(*) leads FROM leads WHERE created_at BETWEEN ? AND ? AND ${L.sql} GROUP BY 1`, [from, to, ...L.args]),
      all(`SELECT COALESCE(NULLIF(source,''),'Unknown') source, COUNT(*) won, SUM(deal_value) rev FROM leads WHERE outcome = 'converted' AND converted_at BETWEEN ? AND ? AND ${L.sql} GROUP BY 1`, [from, to, ...L.args]),
    ]);
    const map = {};
    src.forEach((s) => (map[s.source] = { source: s.source, leads: s.leads, sales: 0, revenue: 0 }));
    srcWon.forEach((s) => { map[s.source] ||= { source: s.source, leads: 0, sales: 0, revenue: 0 }; map[s.source].sales = s.won; map[s.source].revenue = s.rev; });
    out.sources = Object.values(map).sort((a, b) => b.leads - a.leads).map((s) => { if (!V.real) delete s.revenue; return s; });
  }
  res.json(out);
});

/* ---------------- Leads (read) ---------------- */
const LEAD_COLS = "id, name, phone, city, source, assigned_to, called, picked, outcome, remarks, follow_up, deal_value, details, attempts, updated_at, created_at";

r.get("/view/leads", can("leads"), async (req, res) => {
  const { where, args } = leadFilter(req.query, req.view);
  const offset = Math.max(0, Math.floor(+req.query.offset || 0));
  const [rows, count] = await Promise.all([
    all(`SELECT ${LEAD_COLS} FROM leads WHERE ${where} ORDER BY created_at DESC, id LIMIT 100 OFFSET ?`, [...args, offset]),
    one(`SELECT COUNT(*) n FROM leads WHERE ${where}`, args),
  ]);
  const out = rows.map((l) => shape(l, req.view));
  if (req.view.real && out.length) {
    // Super admin: which admins each lead is shared with.
    const ids = out.map((l) => l.id);
    const shares = await all(`SELECT lead_id, admin_id FROM admin_leads WHERE lead_id IN (${ids.map(() => "?").join(",")})`, ids);
    const by = {};
    shares.forEach((s) => (by[s.lead_id] ||= []).push(s.admin_id));
    out.forEach((l) => (l.sharedWith = by[l.id] || []));
  }
  res.json({ total: count.n, rows: out });
});

r.get("/view/leads/:id/history", can("notes"), async (req, res) => {
  const s = scopeSql(req.view, "id");
  const lead = await one(`SELECT id FROM leads WHERE id = ? AND ${s.sql}`, [req.params.id, ...s.args]);
  if (!lead) fail(404, "Lead not found.");
  const rows = await all(
    `SELECT c.created_at, c.picked, c.outcome, c.remarks, c.follow_up, c.deal_value, c.is_call, u.name caller
     FROM call_logs c LEFT JOIN users u ON u.id = c.caller_id WHERE c.lead_id = ? ORDER BY c.created_at DESC`, [lead.id]);
  res.json(rows.map((x) => shape(x, req.view)));
});

/* ---------------- Change a lead's status (super admin, and admins with "Change lead status") ---------------- */
r.post("/view/leads/:id/status", async (req, res) => {
  const V = req.view;
  if (!V.real && !V.perms.editStatus) fail(403, "Changing lead status isn't enabled for your account.");
  const s = scopeSql(V, "id");
  const lead = await one(`SELECT id, remarks, deal_value, outcome, converted_at FROM leads WHERE id = ? AND ${s.sql}`, [req.params.id, ...s.args]);
  if (!lead) fail(404, "Lead not found.");
  const b = req.body || {};
  const picked = String(b.picked || "");
  if (!PICKED.includes(picked)) fail(400, "Choose whether they picked up.");
  const outcome = picked === "yes" ? String(b.outcome || "") : null;
  if (picked === "yes" && !OUTCOMES.includes(outcome)) fail(400, "Choose their response.");
  const followUp = outcome === "callback" && /^\d{4}-\d{2}-\d{2}$/.test(b.followUp || "") ? b.followUp : null;
  // Only the super admin enters sale values; an admin's change keeps whatever value was there.
  const deal = outcome !== "converted" ? 0 : V.real ? Math.max(0, +b.dealValue || 0) : lead.outcome === "converted" ? lead.deal_value : 0;
  const note = str(b.remarks, 1000), t = now();
  const remarks = note || lead.remarks || "";   // a blank note keeps the caller's last note
  const convertedAt = outcome === "converted" ? lead.converted_at || t : null;
  await batch([
    { sql: `UPDATE leads SET called = 1, picked = ?, outcome = ?, remarks = ?, follow_up = ?, deal_value = ?, converted_at = ?, updated_at = ? WHERE id = ?`,
      args: [picked, outcome, remarks, followUp, deal, convertedAt, t, lead.id] },
    { sql: `INSERT INTO call_logs (id, lead_id, caller_id, picked, outcome, remarks, follow_up, deal_value, is_call, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)`,
      args: [newId(), lead.id, req.user.id, picked, outcome, note, followUp, deal, t] },
  ]);
  res.json({ ok: true });
});

r.get("/view/export", can("leads"), can("export"), async (req, res) => {
  const { where, args } = leadFilter(req.query, req.view);
  const rows = await all(
    `SELECT x.*, u.name caller FROM (SELECT * FROM leads WHERE ${where} ORDER BY created_at DESC LIMIT 50000) x
     LEFT JOIN users u ON u.id = x.assigned_to ORDER BY x.created_at DESC`, args);
  res.json(rows.map((l) => shape(l, req.view)));
});

r.get("/view/sources", can("leads"), async (req, res) => {
  const s = scopeSql(req.view, "id");
  res.json((await all(`SELECT DISTINCT COALESCE(source,'') source FROM leads WHERE ${s.sql} ORDER BY 1`, s.args)).map((x) => x.source).filter(Boolean));
});

/* ---------------- Expenses (super admin only) ---------------- */
r.get("/view/expenses", can("expenses"), async (req, res) => {
  const { fromD, toD } = range(req.query);
  res.json({
    categories: EXP_CATS,
    rows: await all("SELECT id, date, category, amount, note FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, created_at DESC LIMIT 1000", [fromD, toD]),
  });
});

export default r;
