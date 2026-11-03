// Adds demo callers, leads, calls, expenses and two view-only admins so you can try the app.
// Usage: npm run seed:demo   (skips if demo data already exists)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { migrate, one, batch } from "../src/db.js";
import { newId, now } from "../src/util.js";
import { defaultPerms } from "../src/perms.js";

await migrate();
if (await one("SELECT id FROM users WHERE phone = '9000000011'")) { console.log("Demo data already exists."); process.exit(0); }

const t = now(), hash = await bcrypt.hash("demo123", 10);
const callers = [["Priya Sharma", "9000000011"], ["Rohit Verma", "9000000012"], ["Ankit Yadav", "9000000013"]].map(([name, phone]) => ({ id: newId(), name, phone }));
const stmts = callers.map((c) => ({ sql: "INSERT INTO users (id, role, name, phone, password_hash, created_at) VALUES (?, 'caller', ?, ?, ?, ?)", args: [c.id, c.name, c.phone, hash, t] }));

// Admin 1: Rahul, a team lead who brings referrals through his affiliate link. Sees only his shared leads + a typed revenue figure.
const rahul = newId(), neha = newId();
stmts.push({ sql: `INSERT INTO users (id, role, name, phone, password_hash, perms, scope, revenue_amount, revenue_note, revenue_updated_at, created_at)
                   VALUES (?, 'admin', ?, ?, ?, ?, 'picked', ?, ?, ?, ?)`,
  args: [rahul, "Rahul Chopra", "9000000001", hash, JSON.stringify({ ...defaultPerms(), notes: true, callerPerformance: true, revenue: true }), 39000, "Revenue from your referrals (October)", t, t] });
// Admin 2: Neha, another team lead. Leads shared, no phone numbers, no revenue.
stmts.push({ sql: "INSERT INTO users (id, role, name, phone, password_hash, perms, scope, created_at) VALUES (?, 'admin', ?, ?, ?, ?, 'picked', ?)",
  args: [neha, "Neha Bhatia", "9000000002", hash, JSON.stringify(defaultPerms()), t] });
const shareWith = { 0: rahul, 1: rahul, 3: rahul, 7: rahul, 10: rahul, 15: rahul, 2: neha, 5: neha, 9: neha, 12: neha };

const people = ["Suresh Gupta|Karol Bagh|Affiliate - Rahul", "Neha Kapoor|Rohini|Affiliate - Rahul", "Amit Bansal|Noida|Affiliate - Neha", "Pooja Arora|Gurugram|Affiliate - Rahul", "Vikas Malhotra|Dwarka|Website", "Ritu Saini|Faridabad|Affiliate - Neha", "Manoj Tiwari|Laxmi Nagar|Google Ads", "Sneha Jain|Pitampura|Affiliate - Rahul", "Deepak Chauhan|Ghaziabad|Referral", "Kavita Rawat|Janakpuri|Affiliate - Neha", "Rahul Mehra|Saket|Affiliate - Rahul", "Anjali Singh|Mayur Vihar|Meta Ads", "Sanjay Kumar|Uttam Nagar|Affiliate - Neha", "Meena Joshi|Rajouri Garden|Meta Ads", "Arjun Khanna|Gurugram|Google Ads", "Divya Aggarwal|Model Town|Affiliate - Rahul", "Harish Negi|Noida|Meta Ads", "Sunita Devi|Narela|Referral"];
const results = [["yes", "converted", "Took Gold plan, paid via UPI", 24000], ["yes", "interested", "Wants brochure on WhatsApp"], ["no", null, "Rang out twice"], ["yes", "callback", "Call after 6 pm"], ["yes", "notint", "Already using a competitor"], null, ["busy", null, "Line busy"], ["yes", "converted", "Silver plan, 2 units", 15500], null, ["off", null, "Switched off"], ["yes", "interested", "Asked for price list"], null, ["wrong", null, "Wrong number"], ["yes", "converted", "Advance paid, balance next week", 31000], null, ["yes", "callback", "Call tomorrow morning"], null, null];
const today = new Date(t + 330 * 60000).toISOString().slice(0, 10);
people.forEach((p, i) => {
  const [name, city, source] = p.split("|"), id = newId(), c = i < 16 ? callers[i % 3].id : null, r = results[i];
  const when = t - (18 - i) * 3 * 3600e3, phone = `98${String(10000000 + i * 734521).slice(0, 8)}`;
  stmts.push({ sql: `INSERT INTO leads (id, name, phone, phone_norm, city, source, assigned_to, called, picked, outcome, remarks, follow_up, deal_value, attempts, converted_at, updated_at, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [id, name, phone, phone, city, source, c, r ? 1 : 0, r?.[0] ?? null, r?.[1] ?? null, r?.[2] ?? null, r?.[1] === "callback" ? today : null,
      r?.[3] || 0, r ? 1 : 0, r?.[1] === "converted" ? when : null, r ? when : null, when - 86400e3] });
  if (shareWith[i]) stmts.push({ sql: "INSERT INTO admin_leads (admin_id, lead_id) VALUES (?, ?)", args: [shareWith[i], id] });
  if (r) stmts.push({ sql: "INSERT INTO call_logs (id, lead_id, caller_id, picked, outcome, remarks, follow_up, deal_value, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [newId(), id, c, r[0], r[1], r[2], r[1] === "callback" ? today : null, r[3] || 0, when] });
});
[["Meta Ads", 18000, "October lead campaign", 20], ["Google Ads", 9500, "Search – Delhi NCR", 18], ["Lead data purchase", 4000, "500 verified numbers", 15], ["Telecom / SIM", 1800, "3 unlimited plans", 10], ["Caller salaries", 27000, "Part-time, 3 callers", 2]]
  .forEach(([cat, amt, note, d]) => stmts.push({ sql: "INSERT INTO expenses (id, date, category, amount, note, created_at) VALUES (?,?,?,?,?,?)",
    args: [newId(), new Date(t - d * 864e5 + 330 * 60000).toISOString().slice(0, 10), cat, amt, note, t] }));
await batch(stmts);
console.log("Demo admins (view-only): Rahul 9000000001 / demo123, Neha 9000000002 / demo123");
console.log("Demo callers: 9000000011–13 / demo123");
