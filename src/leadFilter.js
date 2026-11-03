import { STATUS_SQL, scopeSql } from "./util.js";

/** Build the WHERE clause for a leads list from query filters, limited to what this viewer may see. */
export function leadFilter(q, view) {
  const P = view.perms;
  const s = scopeSql(view, "id");
  const where = [s.sql], args = [...s.args];
  if (q.caller === "none") where.push("assigned_to IS NULL");
  else if (q.caller) { where.push("assigned_to = ?"); args.push(String(q.caller)); }
  if (STATUS_SQL[q.status]) where.push(STATUS_SQL[q.status]);
  if (q.source) { where.push("COALESCE(source,'') = ?"); args.push(String(q.source)); }
  // Super admin only: leads shared with a given admin, or with nobody.
  if (view.real && q.admin === "none") where.push("id NOT IN (SELECT lead_id FROM admin_leads)");
  else if (view.real && q.admin) { where.push("id IN (SELECT lead_id FROM admin_leads WHERE admin_id = ?)"); args.push(String(q.admin)); }
  if (q.q) {
    const like = `%${String(q.q).slice(0, 60)}%`;
    const cols = ["name", "city", "source", P.phones && "phone_norm", P.notes && "remarks"].filter(Boolean);
    where.push(`(${cols.map((c) => `${c} LIKE ?`).join(" OR ")})`);
    args.push(...cols.map(() => like));
  }
  return { where: where.join(" AND "), args };
}
