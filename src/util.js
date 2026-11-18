import crypto from "node:crypto";

/** Random, non-sequential IDs so no one can guess how many other records or accounts exist. */
export const newId = () => crypto.randomBytes(12).toString("base64url");
export const normPhone = (p) => String(p ?? "").replace(/\D/g, "").slice(-10);
export const now = () => Date.now();
export const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
/** Capitalise the first letter of each word in a person's name: "rahul chopra" -> "Rahul Chopra". */
export const personName = (v) => str(v, 80).replace(/\s+/g, " ").replace(/(^|[\s.'-])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

// Business timezone (India by default) for "today" and date ranges.
const TZ = process.env.TZ_OFFSET || "+05:30";
const offMin = (() => { const m = TZ.match(/([+-])(\d\d):(\d\d)/); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 330; })();
export const todayLocal = () => new Date(Date.now() + offMin * 60000).toISOString().slice(0, 10);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
/** Turn ?from=YYYY-MM-DD&to=YYYY-MM-DD into ms bounds + date strings. Missing = all time. */
export function range(q) {
  const fromD = isDate(q.from) ? q.from : "0000-01-01";
  const toD = isDate(q.to) ? q.to : "9999-12-31";
  const from = isDate(q.from) ? Date.parse(`${q.from}T00:00:00${TZ}`) : 0;
  const to = isDate(q.to) ? Date.parse(`${q.to}T23:59:59.999${TZ}`) : 8.64e15;
  return { from, to, fromD, toD };
}

export const PICKED = ["yes", "no", "busy", "off", "wrong"];
export const OUTCOMES = ["interested", "callback", "notint", "converted"];

/** SQL fragment for a lead status filter. */
export const STATUS_SQL = {
  new: "called = 0",
  np: "called = 1 AND picked <> 'yes'",
  int: "picked = 'yes' AND outcome = 'interested'",
  cb: "picked = 'yes' AND outcome = 'callback'",
  ni: "picked = 'yes' AND outcome = 'notint'",
  won: "picked = 'yes' AND outcome = 'converted'",
};
/** Keep a lead's extra form answers safe and small: up to 30 short text fields. */
export function cleanDetails(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 30)) {
    const key = String(k).trim().slice(0, 60), val = String(v ?? "").trim().slice(0, 300);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
export const parseDetails = (s) => { try { const o = JSON.parse(s || "null"); return o && typeof o === "object" ? o : null; } catch { return null; } };
/** "p:+917649964672" -> "+917649964672" (Meta prefixes phone numbers with "p:"). */
export const cleanPhoneText = (v) => str(v, 30).replace(/^[^\d+]+/, "");

/** Partly hide a phone number: 9876543210 -> 98XXXXX210 */
export const maskPhone = (p) => { const d = String(p ?? "").replace(/\D/g, "").slice(-10); return d.length < 6 ? "XXXXXXXXXX" : d.slice(0, 2) + "X".repeat(d.length - 5) + d.slice(-3); };

/** SQL that limits rows to the leads an admin may see. col = a column holding a lead id. */
export function scopeSql(view, col) {
  if (!view?.picked) return { sql: "1 = 1", args: [] };
  return { sql: `${col} IN (SELECT lead_id FROM admin_leads WHERE admin_id = ?)`, args: [view.adminId] };
}

/** Leads that still need work (used when a caller is removed). */
export const OPEN_SQL = "NOT (COALESCE(outcome,'') IN ('converted','notint') OR COALESCE(picked,'') = 'wrong')";

export const placeholders = (n) => Array(n).fill("?").join(",");
export function chunk(arr, n = 400) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
