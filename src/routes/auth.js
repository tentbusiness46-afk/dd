import { Router } from "express";
import bcrypt from "bcryptjs";
import { one, run, getSettings, dbInfo } from "../db.js";
import { sign, requireAuth } from "../auth.js";
import { normPhone, now, fail } from "../util.js";

const r = Router();

// Simple in-memory limiter: 10 failed attempts per phone+IP per 15 minutes.
const tries = new Map();
const WINDOW = 15 * 60 * 1000;

r.post("/auth/login", async (req, res) => {
  const phone = normPhone(req.body?.phone);
  const password = String(req.body?.password || "");
  const key = `${req.ip}|${phone}`;
  const t = tries.get(key);
  const fresh = t && Date.now() - t.at < WINDOW;
  if (fresh && t.n >= 10) fail(429, "Too many attempts. Try again in 15 minutes.");

  const u = phone ? await one("SELECT * FROM users WHERE phone = ?", [phone]) : null;
  const ok = u && (await bcrypt.compare(password, u.password_hash));
  if (!ok) {
    tries.set(key, { n: (fresh ? t.n : 0) + 1, at: fresh ? t.at : Date.now() });
    fail(401, "Wrong mobile number or password.");
  }
  tries.delete(key);
  if (!u.active) fail(401, "This account is disabled. Contact your administrator.");
  res.json({ token: sign(u) });
});

r.get("/me", requireAuth, async (req, res) => {
  const u = req.user, s = await getSettings();
  res.json({
    user: { id: u.id, role: u.role, name: u.name, phone: u.phone },
    business: s.businessName,
    perms: u.role === "caller" ? { callerRevenue: !!s.callerRevenue } : req.view.perms,
    manage: u.role === "superadmin",
    picked: u.role === "admin" && req.view.picked,
    impersonating: !!req.impersonatedBy,
    // Only the super admin is told when the app has fallen back to the local database file.
    dbWarning: u.role === "superadmin" && dbInfo.mode === "local" ? dbInfo.reason : undefined,
  });
});

r.post("/me/password", requireAuth, async (req, res) => {
  if (req.impersonatedBy) fail(403, "You can't change this password from their portal. Use Edit admin instead.");
  const { current, next } = req.body || {};
  if (String(next || "").length < 6) fail(400, "New password must be at least 6 characters.");
  const u = await one("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!(await bcrypt.compare(String(current || ""), u.password_hash))) fail(400, "Current password is wrong.");
  await run("UPDATE users SET password_hash = ?, pw_changed_at = ? WHERE id = ?", [await bcrypt.hash(String(next), 10), now(), req.user.id]);
  res.json({ token: sign({ id: req.user.id, role: req.user.role }) });
});

export default r;
