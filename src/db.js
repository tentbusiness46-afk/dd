import { createClient } from "@libsql/client";

/* ---- Connection: Turso if it works, otherwise a local database file ---- */
const LOCAL_FILE = process.env.LOCAL_DB_FILE || "local.db";
export let db = null;
/** mode: "turso" | "local". reason: why Turso wasn't used (shown to the super admin). */
export const dbInfo = { mode: "local", reason: "" };

function explain(e) {
  const m = String(e?.message || e);
  if (/404/.test(m)) return "Turso couldn't find that database (HTTP 404). Check TURSO_DATABASE_URL: the database name or organisation in the URL is probably wrong.";
  if (/401|403|unauthori[sz]ed|forbidden/i.test(m)) return "Turso rejected the auth token. Make a new one with: turso db tokens create <database-name>, and put it in TURSO_AUTH_TOKEN.";
  if (/timed out/i.test(m)) return "Turso didn't respond within 10 seconds.";
  if (/ENOTFOUND|EAI_AGAIN|fetch failed|ECONNREFUSED|ECONNRESET|network/i.test(m)) return "Couldn't reach Turso. Check your internet connection and the URL.";
  if (/URL_INVALID|invalid url|URL_SCHEME/i.test(m)) return "TURSO_DATABASE_URL isn't a valid address. It should look like libsql://name-org.turso.io";
  return m;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

export async function connect() {
  if (db) return db;
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  if (!url) dbInfo.reason = "TURSO_DATABASE_URL is empty.";
  else if (/your-db-name|your-org/.test(url)) dbInfo.reason = "TURSO_DATABASE_URL is still the example value from .env.example.";
  else {
    try {
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
      await withTimeout(client.execute("SELECT 1"), 10000);
      db = client; dbInfo.mode = "turso"; dbInfo.reason = "";
      console.log("Database: connected to Turso.");
      return db;
    } catch (e) {
      dbInfo.reason = explain(e);
    }
  }
  db = createClient({ url: `file:${LOCAL_FILE}` });
  dbInfo.mode = "local";
  console.warn(`\n⚠  Database: Turso not connected. ${dbInfo.reason}\n   Using the local file "${LOCAL_FILE}" instead.\n`);
  return db;
}

const toObjects = (r) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));

export async function all(sql, args = []) { return toObjects(await db.execute({ sql, args })); }
export async function one(sql, args = []) { return (await all(sql, args))[0]; }
export async function run(sql, args = []) { return db.execute({ sql, args }); }
/** Run many write statements in transactions, in chunks. */
export async function batch(stmts, size = 300) {
  let affected = 0;
  for (let i = 0; i < stmts.length; i += size) {
    const res = await db.batch(stmts.slice(i, i + size), "write");
    res.forEach((r) => (affected += r.rowsAffected || 0));
  }
  return affected;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('superadmin','admin','caller')),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  perms         TEXT,                 -- admins: JSON of sections the super admin lets them see
  scope         TEXT,                 -- admins: NULL = all leads, 'picked' = only leads shared in admin_leads
  revenue_amount REAL,                -- admins: revenue figure the super admin types for them
  revenue_note  TEXT,                 -- admins: label shown with that figure
  revenue_updated_at INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  pw_changed_at INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_role ON users(role);

CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  phone        TEXT NOT NULL,
  phone_norm   TEXT NOT NULL UNIQUE,
  city         TEXT,
  source       TEXT,
  assigned_to  TEXT,
  called       INTEGER NOT NULL DEFAULT 0,
  picked       TEXT,
  outcome      TEXT,
  remarks      TEXT,
  follow_up    TEXT,
  deal_value   REAL NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  converted_at INTEGER,
  updated_at   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS leads_conv ON leads(converted_at);

CREATE TABLE IF NOT EXISTS call_logs (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL,
  caller_id   TEXT NOT NULL,
  picked      TEXT NOT NULL,
  outcome     TEXT,
  remarks     TEXT,
  follow_up   TEXT,
  deal_value  REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_time ON call_logs(created_at);
CREATE INDEX IF NOT EXISTS logs_lead ON call_logs(lead_id);
CREATE INDEX IF NOT EXISTS logs_caller ON call_logs(caller_id, created_at);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  amount      REAL NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date);

-- Which leads the super admin has shared with which admin
CREATE TABLE IF NOT EXISTS admin_leads (
  admin_id TEXT NOT NULL,
  lead_id  TEXT NOT NULL,
  PRIMARY KEY (admin_id, lead_id)
);
CREATE INDEX IF NOT EXISTS admin_leads_lead ON admin_leads(lead_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export async function migrate() {
  await connect();
  const cols = await all("SELECT name FROM pragma_table_info('leads')").catch(() => []);
  if (cols.some((c) => c.name === "admin_id")) {
    console.error("This database has tables from the earlier multi-business version of DialDesk.\n" +
      "Create a fresh Turso database (or drop the users, leads, call_logs and expenses tables) and restart.");
    process.exit(1);
  }
  await db.executeMultiple(SCHEMA);
  // Add columns that newer versions introduced, if this database is older.
  const have = new Set((await all("SELECT name FROM pragma_table_info('users')")).map((c) => c.name));
  for (const [col, type] of [["revenue_amount", "REAL"], ["revenue_note", "TEXT"], ["revenue_updated_at", "INTEGER"]])
    if (!have.has(col)) await db.execute(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  // Capitalise names saved before names were capitalised automatically.
  const { personName } = await import("./util.js");
  for (const u of await all("SELECT id, name FROM users")) {
    const fixed = personName(u.name);
    if (fixed && fixed !== u.name) await db.execute({ sql: "UPDATE users SET name = ? WHERE id = ?", args: [fixed, u.id] });
  }
  // Older builds stored a JSON list of callers in scope; treat that as "picked" with nothing shared yet.
  await db.execute("UPDATE users SET scope = 'picked' WHERE role = 'admin' AND scope IS NOT NULL AND scope <> 'picked'");
}

/* ---- business settings ---- */
export const DEFAULT_SETTINGS = { businessName: "DialDesk", callerRevenue: true };
export async function getSettings() {
  const rows = await all("SELECT key, value FROM settings");
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch {} }
  return out;
}
export async function setSettings(patch) {
  const stmts = Object.entries(patch)
    .filter(([k]) => k in DEFAULT_SETTINGS)
    .map(([k, v]) => ({ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [k, JSON.stringify(v)] }));
  if (stmts.length) await batch(stmts);
}
