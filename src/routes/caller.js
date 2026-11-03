import { Router } from "express";
import { all, one, batch, getSettings } from "../db.js";
import { requireAuth, role } from "../auth.js";
import { newId, now, str, fail, PICKED, OUTCOMES } from "../util.js";

const r = Router();
r.use("/caller", requireAuth, role("caller"));
r.use("/caller", async (req, res, next) => { req.showRevenue = !!(await getSettings()).callerRevenue; next(); });

const VIEWS = {
  todo: { where: "called = 0", order: "created_at" },
  retry: { where: "called = 1 AND picked NOT IN ('yes','wrong')", order: "updated_at" },
  cb: { where: "picked = 'yes' AND outcome = 'callback'", order: "COALESCE(follow_up,'9999'), updated_at" },
  int: { where: "picked = 'yes' AND outcome = 'interested'", order: "updated_at DESC" },
  all: { where: "1 = 1", order: "updated_at DESC" },
};
const COLS = "id, name, phone, city, source, called, picked, outcome, remarks, follow_up, deal_value, attempts, updated_at";

r.get("/caller/leads", async (req, res) => {
  const v = VIEWS[req.query.view] ? req.query.view : "todo";
  const counts = await one(
    `SELECT ${Object.entries(VIEWS).map(([k, x]) => `COALESCE(SUM(${x.where}),0) AS "${k}"`).join(", ")} FROM leads WHERE assigned_to = ?`, [req.user.id]);
  const rows = await all(`SELECT ${COLS} FROM leads WHERE assigned_to = ? AND ${VIEWS[v].where} ORDER BY ${VIEWS[v].order} LIMIT 300`, [req.user.id]);
  if (!req.showRevenue) rows.forEach((x) => delete x.deal_value);
  res.json({ counts, rows: rows.map((x) => ({ ...x, called: !!x.called })) });
});

r.get("/caller/stats", async (req, res) => {
  const [a, c] = await Promise.all([
    one(`SELECT COUNT(*) total, COALESCE(SUM(called = 0),0) pending, COALESCE(SUM(outcome = 'converted'),0) won,
                COALESCE(SUM(CASE WHEN outcome = 'converted' THEN deal_value END),0) rev
         FROM leads WHERE assigned_to = ?`, [req.user.id]),
    one("SELECT COUNT(*) made, COALESCE(SUM(picked = 'yes'),0) picked FROM call_logs WHERE caller_id = ?", [req.user.id]),
  ]);
  const out = { assigned: a.total, pending: a.pending, calls: c.made, picked: c.picked, sales: a.won };
  if (req.showRevenue) out.revenue = a.rev;
  res.json(out);
});

r.post("/caller/leads/:id/call", async (req, res) => {
  const lead = await one("SELECT id, converted_at FROM leads WHERE id = ? AND assigned_to = ?", [req.params.id, req.user.id]);
  if (!lead) fail(404, "This lead is no longer assigned to you.");
  const b = req.body || {};
  const picked = String(b.picked || "");
  if (!PICKED.includes(picked)) fail(400, "Choose whether they picked up.");
  const outcome = picked === "yes" ? String(b.outcome || "") : null;
  if (picked === "yes" && !OUTCOMES.includes(outcome)) fail(400, "Choose their response.");
  const followUp = outcome === "callback" && /^\d{4}-\d{2}-\d{2}$/.test(b.followUp || "") ? b.followUp : null;
  const deal = outcome === "converted" ? Math.max(0, +b.dealValue || 0) : 0;
  const remarks = str(b.remarks, 1000), t = now();
  const convertedAt = outcome === "converted" ? lead.converted_at || t : null;
  await batch([
    { sql: `UPDATE leads SET called = 1, picked = ?, outcome = ?, remarks = ?, follow_up = ?, deal_value = ?,
                 attempts = attempts + 1, converted_at = ?, updated_at = ? WHERE id = ?`,
      args: [picked, outcome, remarks, followUp, deal, convertedAt, t, lead.id] },
    { sql: `INSERT INTO call_logs (id, lead_id, caller_id, picked, outcome, remarks, follow_up, deal_value, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [newId(), lead.id, req.user.id, picked, outcome, remarks, followUp, deal, t] },
  ]);
  res.json({ ok: true });
});

r.get("/caller/leads/:id/history", async (req, res) => {
  const lead = await one("SELECT id FROM leads WHERE id = ? AND assigned_to = ?", [req.params.id, req.user.id]);
  if (!lead) fail(404, "Lead not found.");
  const rows = await all(
    `SELECT c.created_at, c.picked, c.outcome, c.remarks, c.follow_up, c.deal_value, u.name caller
     FROM call_logs c LEFT JOIN users u ON u.id = c.caller_id WHERE c.lead_id = ? ORDER BY c.created_at DESC`, [lead.id]);
  if (!req.showRevenue) rows.forEach((x) => delete x.deal_value);
  res.json(rows);
});

r.get("/caller/log", async (req, res) => {
  res.json(await all(
    `SELECT c.created_at, c.picked, c.outcome, c.remarks, l.name, l.phone
     FROM call_logs c JOIN leads l ON l.id = c.lead_id WHERE c.caller_id = ? ORDER BY c.created_at DESC LIMIT 300`, [req.user.id]));
});

export default r;
