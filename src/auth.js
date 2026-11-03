import jwt from "jsonwebtoken";
import { one } from "./db.js";
import { parsePerms, allPerms } from "./perms.js";

const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? null : "dev-only-secret-change-me");
if (!SECRET) { console.error("JWT_SECRET is not set. Add it in your Render environment."); process.exit(1); }

export const sign = (user, extra = {}, expiresIn = "30d") =>
  jwt.sign({ sub: user.id, role: user.role, ...extra }, SECRET, { expiresIn });

const deny = (res, msg) => res.status(401).json({ error: msg });

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return deny(res, "Please log in.");
  let p;
  try { p = jwt.verify(token, SECRET); } catch { return deny(res, "Your session has expired. Please log in again."); }

  const u = await one("SELECT id, role, name, phone, perms, scope, revenue_amount, revenue_note, revenue_updated_at, active, pw_changed_at FROM users WHERE id = ?", [p.sub]);
  if (!u || !u.active) return deny(res, "This account is disabled. Contact your administrator.");
  if (!p.imp && p.iat < Math.floor(u.pw_changed_at / 1000)) return deny(res, "Your password was changed. Please log in again.");

  req.user = u;
  req.impersonatedBy = p.imp || null;
  // What this person may see. Super admin sees everything; admins see what the super admin allowed.
  if (u.role === "superadmin") req.view = { perms: allPerms(), picked: false, adminId: null, real: true };
  if (u.role === "admin") req.view = { perms: parsePerms(u.perms), picked: u.scope === "picked", adminId: u.id, real: false };
  next();
}

export const role = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You don't have access to this." });

export const can = (key) => (req, res, next) =>
  req.view?.perms[key] ? next() : res.status(403).json({ error: "This section isn't enabled for your account." });
