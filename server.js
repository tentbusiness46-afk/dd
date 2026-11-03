import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { migrate, one, run, dbInfo } from "./src/db.js";
import { newId, normPhone, now, personName, HttpError } from "./src/util.js";
import authRoutes from "./src/routes/auth.js";
import viewRoutes from "./src/routes/view.js";
import manageRoutes from "./src/routes/manage.js";
import callerRoutes from "./src/routes/caller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy

const origins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, database: dbInfo.mode }));
app.use("/api", authRoutes, viewRoutes, manageRoutes, callerRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "That file is too large. Split it into smaller files." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

async function ensureSuperAdmin() {
  const phone = normPhone(process.env.SUPERADMIN_PHONE);
  const pw = process.env.SUPERADMIN_PASSWORD;
  const existing = await one("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (existing && process.env.SUPERADMIN_RESET === "1" && pw) {
    await run("UPDATE users SET password_hash = ?, pw_changed_at = ? WHERE id = ?", [await bcrypt.hash(pw, 10), now(), existing.id]);
    console.log("Super admin password reset from SUPERADMIN_PASSWORD. Remove SUPERADMIN_RESET now.");
  }
  if (existing) return;
  if (phone.length !== 10 || !pw || pw.length < 6) {
    console.warn("No super admin yet. Set SUPERADMIN_PHONE (10 digits) and SUPERADMIN_PASSWORD (6+ chars) and restart.");
    return;
  }
  await run("INSERT INTO users (id, role, name, phone, password_hash, created_at) VALUES (?, 'superadmin', ?, ?, ?, ?)",
    [newId(), personName(process.env.SUPERADMIN_NAME || "Super Admin"), phone, await bcrypt.hash(pw, 10), now()]);
  console.log(`Super admin created for ${phone}.`);
}

await migrate();
await ensureSuperAdmin();
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`DialDesk running on http://localhost:${port}`));
