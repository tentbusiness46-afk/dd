/* DialDesk front end: one script for the super admin, admin (view-only) and caller portals. */
(() => {
"use strict";
const API = (window.DIALDESK_API || "") + "/api";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const num = (n) => (n || 0).toLocaleString("en-IN");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDT = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const telOf = (p) => "tel:+91" + String(p).replace(/\D/g, "").slice(-10);

const PICK = [["yes", "Picked up"], ["no", "No answer"], ["busy", "Busy"], ["off", "Switched off"], ["wrong", "Wrong number"]];
const OUT = [["interested", "Interested"], ["callback", "Call back"], ["notint", "Not interested"], ["converted", "Converted"]];
const QR = ["Call after 6 pm", "Send brochure on WhatsApp", "Asked for price list", "Will decide this week", "Busy, call tomorrow", "Already bought elsewhere", "Budget issue"];
const STATUSES = [["new", "New"], ["np", "Not picked up"], ["int", "Interested"], ["cb", "Call back"], ["ni", "Not interested"], ["won", "Converted"]];
const PHONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';

/* ---------- storage + api ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let token = store.get("dd_token");
let ME = null;

async function api(path, { method = "GET", body } = {}) {
  let r;
  try {
    r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Can't reach the server. Check your internet connection."); }
  let data = null;
  try { data = await r.json(); } catch {}
  if (r.status === 401 && token && !path.startsWith("/auth")) { logout(data?.error); throw new Error(data?.error || "Please log in."); }
  if (!r.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data;
}

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }
const fail = (e) => toast(e.message || String(e));

function statusOf(l) {
  if (!l.called) return ["new", "New", "p-new"];
  if (l.picked !== "yes") return ["np", PICK.find((p) => p[0] === l.picked)?.[1] || "Not picked", "p-np"];
  return ({ interested: ["int", "Interested", "p-int"], callback: ["cb", "Call back", "p-cb"], notint: ["ni", "Not interested", "p-ni"], converted: ["won", "Converted", "p-won"] })[l.outcome] || ["int", "Picked up", "p-int"];
}
const pill = (l) => { const [, t, c] = statusOf(l); return `<span class="pill ${c}">${esc(t)}</span>`; };
const pickLabel = (k) => PICK.find((p) => p[0] === k)?.[1] || "—";
const outLabel = (k) => OUT.find((o) => o[0] === k)?.[1] || "";

/* ---------- session ---------- */
function logout(msg) {
  token = null; ME = null; store.set("dd_token", null); store.set("dd_super", null);
  showLogin(msg);
}
async function boot(startTab = null) {
  if (!token) return showLogin();
  try { ME = await api("/me"); } catch { return; }
  tab = startTab; sel.clear();
  render();
}

function showLogin(msg) {
  $("#header").hidden = true; $("#banner").innerHTML = ""; $("#drawerHost").innerHTML = "";
  $("#view").dataset.shown = "";
  $("#view").innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <div class="brand"><div class="mark">D</div><h1>DialDesk</h1></div>
    <h2 style="font-size:22px">Log in</h2>
    <label class="field"><span>Mobile number</span><input type="tel" id="lp" autocomplete="username" inputmode="numeric" required placeholder="10-digit mobile"></label>
    <label class="field"><span>Password</span><input type="password" id="lpw" autocomplete="current-password" required></label>
    <div class="err" id="lerr">${esc(msg || "")}</div>
    <button class="btn primary" id="lgo">Log in</button>
    <p class="note" style="margin:0">Forgot your password? Ask the business owner to reset it.</p>
  </form></div>`;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#lgo").disabled = true; $("#lerr").textContent = "";
    try {
      const r = await api("/auth/login", { method: "POST", body: { phone: $("#lp").value, password: $("#lpw").value } });
      token = r.token; store.set("dd_token", token); boot();
    } catch (err) { $("#lerr").textContent = err.message; $("#lgo").disabled = false; }
  };
}

/* ---------- shell ---------- */
let tab = null;
function tabsFor() {
  const r = ME.user.role, P = ME.perms || {};
  if (r === "superadmin") return [["overview", "Overview"], ["leads", "Leads"], ["import", "Import leads"], ["callers", "Callers"], ["expenses", "Expenses"], ["admins", "Admins"], ["settings", "Settings"]];
  if (r === "admin") return [["overview", "Overview"], P.leads && ["leads", "Leads"], P.expenses && ["expenses", "Expenses"]].filter(Boolean);
  return [["queue", "My leads"], ["log", "Call log"]];
}
function renderShell() {
  $("#header").hidden = false;
  const roleName = { superadmin: "Super Admin", admin: "Admin", caller: "Caller" }[ME.user.role];
  $("#who").innerHTML = ME.user.name.toLowerCase() === roleName.toLowerCase() ? `<b>${roleName}</b>` : `<b>${esc(ME.user.name)}</b><span>· ${roleName}</span>`;
  const t = tabsFor();
  if (!t.find((x) => x[0] === tab)) tab = t[0][0];
  $("#tabs").hidden = t.length < 2;
  $("#tabs").innerHTML = t.map(([k, v]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join("");
  $("#accountBtn").hidden = ME.impersonating;
  $("#banner").innerHTML = ME.impersonating
    ? `<div class="banner"><div class="wrap"><span>You're viewing ${esc(ME.user.name)}'s portal exactly as they see it.</span><button class="btn sm" id="backSuper">Back to Super Admin</button></div></div>`
    : ME.dbWarning ? `<div class="banner"><div class="wrap"><span>Turso isn't connected, so data is being saved to a local file on the server. ${esc(ME.dbWarning)}</span></div></div>` : "";
  if (ME.impersonating) $("#backSuper").onclick = () => { token = store.get("dd_super"); store.set("dd_token", token); store.set("dd_super", null); boot("admins"); };
}
/** On phones, tables marked .stack turn into cards; each cell needs its column name as a label. */
function labelTables(root = document) {
  $$("table.stack", root).forEach((t) => {
    const heads = $$("tr:first-child th, thead th", t).map((th) => th.textContent.trim());
    $$("tr", t).forEach((tr) => {
      if (tr.querySelector("th")) tr.classList.add("hdr");
      [...tr.children].forEach((td, i) => { if (td.tagName === "TD") td.dataset.label = heads[i] || ""; });
    });
  });
}
let renderSeq = 0;
async function render() {
  renderShell();
  const seq = ++renderSeq, v = $("#view");
  const fn = VIEWS[tab];
  if (!v.firstElementChild || v.dataset.shown !== tab) v.innerHTML = `<div class="loading">Loading…</div>`;
  v.dataset.shown = tab;
  try {
    const html = await fn.load();
    if (seq !== renderSeq) return;
    v.innerHTML = `<div style="display:grid;gap:20px;padding-block:22px 60px">${html}</div>`;
    fn.bind && fn.bind();
    labelTables(v);
    $("#tabs [aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  } catch (e) {
    if (seq !== renderSeq) return;
    v.innerHTML = `<div class="panel empty" style="margin-top:22px">${esc(e.message)} <button class="linkbtn" id="retry">Try again</button></div>`;
    $("#retry").onclick = render;
  }
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });
$("#logoutBtn").onclick = () => logout();
$("#accountBtn").onclick = () => openDrawer({
  title: "Account", body: `<p class="muted" style="margin:0">${esc(ME.user.name)} · ${esc(ME.user.phone)}</p>
    <h3 style="font-size:16px">Change password</h3>
    <label class="field"><span>Current password</span><input type="password" id="pc" autocomplete="current-password"></label>
    <label class="field"><span>New password</span><input type="password" id="pn" autocomplete="new-password" placeholder="At least 6 characters"></label>`,
  saveLabel: "Change password",
  onSave: async () => {
    const r = await api("/me/password", { method: "POST", body: { current: $("#pc").value, next: $("#pn").value } });
    token = r.token; store.set("dd_token", token); toast("Password changed");
  },
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

/* ---------- drawer ---------- */
function closeDrawer() { $("#drawerHost").innerHTML = ""; }
function openDrawer({ title, eyebrow = "", body, saveLabel = "Save", onSave, bind, focus = true }) {
  $("#drawerHost").innerHTML = `<div class="drawer-bg" id="dbg"></div><aside class="drawer" role="dialog" aria-label="${esc(title)}">
    <div class="hd"><div>${eyebrow}<h2 style="font-size:20px">${esc(title)}</h2></div><button class="btn ghost" id="dx" aria-label="Close">✕</button></div>
    <div class="bd" id="dbody">${body}</div>
    <div class="ft"><span class="err" id="derr" style="margin-right:auto"></span><button class="btn" id="dcancel">${onSave ? "Cancel" : "Close"}</button>${onSave ? `<button class="btn primary" id="dsave">${esc(saveLabel)}</button>` : ""}</div></aside>`;
  $("#dx").onclick = $("#dcancel").onclick = $("#dbg").onclick = closeDrawer;
  if (onSave) $("#dsave").onclick = async () => {
    $("#dsave").disabled = true; $("#derr").textContent = "";
    try { await onSave(); closeDrawer(); } catch (e) { $("#derr").textContent = e.message; $("#dsave").disabled = false; }
  };
  bind && bind();
  if (focus) { const first = $("#dbody input, #dbody select, #dbody textarea"); first && first.focus(); }
}

const VIEWS = {};

/* =====================================================================
   OVERVIEW (super admin sees all; admins see what they're allowed)
   ===================================================================== */
const PERIODS = [["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["month", "This month"], ["custom", "Custom"]];
let period = { key: "all", from: "", to: "" };
function periodRange() {
  const d = new Date(), t = localDate(d);
  if (period.key === "today") return { from: t, to: t };
  if (period.key === "7" || period.key === "30") { const x = new Date(d); x.setDate(x.getDate() - (+period.key - 1)); return { from: localDate(x), to: t }; }
  if (period.key === "month") return { from: t.slice(0, 8) + "01", to: t };
  if (period.key === "custom") return { from: period.from, to: period.to };
  return { from: "", to: "" };
}
const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null)).toString(); return s ? "?" + s : ""; };
function periodBar() {
  return `<div class="periods"><span class="label" style="margin-right:4px">Period</span>${PERIODS.map(([k, v]) => `<button class="chip" data-period="${k}" aria-pressed="${period.key === k}">${v}</button>`).join("")}
    ${period.key === "custom" ? `<input type="date" id="pf" value="${period.from}" aria-label="From"><input type="date" id="pt" value="${period.to}" aria-label="To">` : ""}</div>`;
}
function bindPeriod() {
  $$("[data-period]").forEach((b) => (b.onclick = () => { period.key = b.dataset.period; if (period.key === "custom" && !period.from) { period.from = localDate().slice(0, 8) + "01"; period.to = localDate(); } render(); }));
  if ($("#pf")) { $("#pf").onchange = (e) => { period.from = e.target.value; render(); }; $("#pt").onchange = (e) => { period.to = e.target.value; render(); }; }
}
const bars = (rows, fmt = (n) => num(n), labelW = 120) => {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="funnel">${rows.map(([k, v, extra]) => `<div class="fr" style="grid-template-columns:${labelW}px 1fr 110px"><span>${esc(k)}</span><div class="bar"><i style="width:${(v / max) * 100}%"></i></div><span class="n num">${fmt(v)}${extra ? ` · ${extra}` : ""}</span></div>`).join("")}</div>`;
};

VIEWS.overview = {
  async load() {
    const s = await api("/view/stats" + qs(periodRange()));
    const P = ME.perms;
    const k = [];
    if (s.roi) k.push(`<div class="kpi hero"><span class="label">Return on investment</span><span class="v">${s.roi.roi == null ? "—" : (s.roi.roi >= 0 ? "+" : "") + s.roi.roi.toFixed(0) + "%"}</span><span class="s">${inr(Math.abs(s.roi.profit))} ${s.roi.profit >= 0 ? "profit" : "loss"} on ${inr(s.roi.spend)} spent</span></div>`);
    if (s.revenue?.manual) k.push(`<div class="kpi hero"><span class="label">${esc(s.revenue.note || "Revenue")}</span><span class="v">${inr(s.revenue.total)}</span><span class="s">${s.revenue.updatedAt ? "Updated " + new Date(s.revenue.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}</span></div>`);
    if (s.revenue && !s.revenue.manual) k.push(`<div class="kpi"><span class="label">Revenue</span><span class="v">${inr(s.revenue.total)}</span><span class="s">${num(s.sales.won)} sales</span></div>`);
    if (!s.revenue || s.revenue.manual) k.push(`<div class="kpi"><span class="label">Sales</span><span class="v">${num(s.sales.won)}</span><span class="s">leads converted</span></div>`);
    if (s.roi) {
      k.push(`<div class="kpi"><span class="label">Cost per lead</span><span class="v">${s.roi.costPerLead == null ? "—" : inr(s.roi.costPerLead)}</span><span class="s">${num(s.leads.added)} leads added</span></div>`);
      k.push(`<div class="kpi"><span class="label">Cost per sale</span><span class="v">${s.roi.costPerSale == null ? "—" : inr(s.roi.costPerSale)}</span><span class="s">${s.roi.multiple == null ? "" : s.roi.multiple.toFixed(2) + "× return"}</span></div>`);
    } else if (s.expenses) k.push(`<div class="kpi"><span class="label">Spent</span><span class="v">${inr(s.expenses.total)}</span><span class="s">expenses in period</span></div>`);
    if (s.calls) k.push(`<div class="kpi"><span class="label">Calls made</span><span class="v">${num(s.calls.made)}</span><span class="s">${pct(s.calls.picked, s.calls.made)}% picked up</span></div>`);
    k.push(`<div class="kpi"><span class="label">${ME.manage ? "Waiting to be called" : "Your leads"}</span><span class="v">${num(ME.manage ? s.leads.pending : s.leads.total)}</span><span class="s">${ME.manage ? `${num(s.leads.unassigned)} not assigned` : `${num(s.leads.pending)} not called yet`}</span></div>`);

    const panels = [];
    if (s.calls) panels.push(`<section class="panel"><h2>Calling funnel</h2><p class="note" style="margin:-6px 0 12px">For leads added in this period</p>${bars(s.calls.funnel.map(([a, b]) => [a, b, pct(b, s.calls.funnel[0][1]) + "%"]))}</section>`);
    if (s.callers) panels.push(`<section class="panel"><h2>Caller performance</h2>${s.callers.length ? `<div class="tablebox"><table><tr><th>Caller</th><th class="n">Pending</th><th class="n">Calls</th><th class="n">Picked</th><th class="n">Sales</th>${ME.manage ? '<th class="n">Revenue</th>' : ""}</tr>
      ${s.callers.map((c) => `<tr class="${c.active ? "" : "dim"}"><td>${esc(c.name)}</td><td class="n">${num(c.pending)}</td><td class="n">${num(c.calls)}</td><td class="n">${num(c.picked)}</td><td class="n">${num(c.sales)}</td>${ME.manage ? `<td class="n">${inr(c.revenue)}</td>` : ""}</tr>`).join("")}</table></div>` : '<div class="empty">No callers yet.</div>'}</section>`);
    if (s.expenses && s.expenses.byCategory.length) panels.push(`<section class="panel"><h2>Spend by category</h2>${bars(s.expenses.byCategory.map((x) => [x.category, x.amount]), inr, 140)}</section>`);
    if (s.sources) panels.push(`<section class="panel"><h2>Results by lead source</h2><div class="tablebox"><table><tr><th>Source</th><th class="n">Leads</th><th class="n">Sales</th><th class="n">Conv.</th>${ME.manage ? '<th class="n">Revenue</th>' : ""}</tr>
      ${s.sources.map((x) => `<tr><td>${esc(x.source)}</td><td class="n">${num(x.leads)}</td><td class="n">${num(x.sales)}</td><td class="n">${x.leads ? pct(x.sales, x.leads) + "%" : "—"}</td>${ME.manage ? `<td class="n">${inr(x.revenue)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="5" class="empty">No leads in this period</td></tr>`}</table></div></section>`);

    const fu = s.followUps ? `<section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Follow-ups due</h2><span class="note">Call-backs due today or earlier</span></div>
      ${s.followUps.length ? `<div class="tablebox stackbox"><table class="stack"><tr><th>Lead</th><th>Phone</th><th>Caller</th><th>Due</th>${P.notes ? "<th>Last remark</th>" : ""}</tr>
      ${s.followUps.map((l) => `<tr><td><b>${esc(l.name)}</b><br><span class="note">${esc(l.city)}</span></td><td class="num">${esc(l.phone)}</td><td>${esc(l.caller || "Unassigned")}</td><td class="num">${esc(l.follow_up || "—")}</td>${P.notes ? `<td class="rm" title="${esc(l.remarks)}">${esc(l.remarks) || "—"}</td>` : ""}</tr>`).join("")}</table></div>` : '<div class="empty">No follow-ups due.</div>'}</section>` : "";

    return `${periodBar()}<div class="kpis">${k.join("")}</div>
      ${panels.length ? `<div class="grid2">${panels.join("")}</div>` : ""}${fu}`;
  },
  bind: bindPeriod,
};

/* =====================================================================
   LEADS (super admin manages; admins only view)
   ===================================================================== */
let lf = { caller: "", status: "", source: "", admin: "", q: "" }, leadRows = [], leadTotal = 0, CALLERS = [], ADMINS = [], SOURCES = [];
let selAllMatching = false;
const aname = (id) => ADMINS.find((a) => a.id === id)?.name || "";
const sel = new Set();
const cname = (id) => CALLERS.find((c) => c.id === id)?.name || "Unassigned";
const callerOpts = (selected, { blank = "Unassigned" } = {}) =>
  `<option value="">${blank}</option>` + CALLERS.filter((c) => c.active || c.id === selected).map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}${c.active ? "" : " (inactive)"}</option>`).join("");

function leadRowHtml(l) {
  const P = ME.perms, M = ME.manage;
  const name = P.notes ? `<button class="linkbtn" data-hist="${l.id}" style="color:var(--fg);text-decoration-style:dotted;text-align:left" title="See call history">${esc(l.name)}</button>` : `<b>${esc(l.name)}</b>`;
  return `<tr>${M ? `<td><input type="checkbox" class="sel" data-id="${l.id}" ${sel.has(l.id) ? "checked" : ""} aria-label="Select ${esc(l.name)}"></td>` : ""}
    <td>${name}</td><td class="num">${esc(l.phone)}</td><td>${esc(l.city)}</td><td>${esc(l.source)}</td>
    <td>${M ? `<select class="asg" data-id="${l.id}" aria-label="Assign caller">${callerOpts(l.assigned_to)}</select>` : esc(cname(l.assigned_to))}</td>
    <td>${pill(l)}${M && l.outcome === "converted" ? ` <span class="num note">${inr(l.deal_value)}</span>` : ""}</td>
    ${P.notes ? `<td class="rm" title="${esc(l.remarks)}">${esc(l.remarks) || "—"}</td>` : ""}<td class="note">${fmtDT(l.updated_at)}</td>
    ${M ? `<td>${l.sharedWith.length ? l.sharedWith.map((id) => `<span class="tag on">${esc(aname(id))}</span>`).join("") : '<span class="note">—</span>'}</td>` : ""}</tr>`;
}
VIEWS.leads = {
  async load() {
    const [callers, r, sources, admins] = await Promise.all([api("/view/callers"), api("/view/leads" + qs(lf)), api("/view/sources"), ME.manage ? api("/manage/admins") : []]);
    CALLERS = callers; leadRows = r.rows; leadTotal = r.total; SOURCES = sources; ADMINS = admins;
    const P = ME.perms, M = ME.manage;
    const actions = [
      M && '<button class="btn" id="distribute">Split unassigned evenly</button>',
      M && '<button class="btn" id="addLead">Add lead</button>',
      P.export && '<button class="btn" id="export">Export to Excel</button>',
      M && '<button class="btn primary" data-tab="import">Import Excel / CSV</button>',
    ].filter(Boolean).join("");
    return `<section class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:14px"><h2 style="margin:0">Leads <span class="muted num" style="font-size:15px">${num(leadTotal)}</span></h2>
      <div class="row">${actions}</div></div>
      <div class="row filters" style="margin-bottom:12px">
        <input type="search" id="lq" placeholder="Search ${["name", "city", P.phones && "phone", P.notes && "remark"].filter(Boolean).join(", ")}" value="${esc(lf.q)}">
        <select id="lc" aria-label="Filter by caller"><option value="">All callers</option>${M ? `<option value="none" ${lf.caller === "none" ? "selected" : ""}>Unassigned</option>` : ""}${CALLERS.map((c) => `<option value="${c.id}" ${lf.caller === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <select id="ls" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(([k, v]) => `<option value="${k}" ${lf.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="lsrc" aria-label="Filter by source"><option value="">All sources</option>${SOURCES.map((x) => `<option ${lf.source === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
        ${M ? `<select id="ladm" aria-label="Filter by admin"><option value="">Any admin access</option><option value="none" ${lf.admin === "none" ? "selected" : ""}>Not shared with any admin</option>${ADMINS.map((a) => `<option value="${a.id}" ${lf.admin === a.id ? "selected" : ""}>Shared with ${esc(a.name)}</option>`).join("")}</select>` : ""}
      </div>
      <div id="bulk"></div>
      ${M && leadRows.length ? `<label class="selall-m"><input type="checkbox" id="selAllM"> Select all on this page</label>` : ""}
      ${leadRows.length ? `<div class="tablebox stackbox"><table class="stack"><thead><tr>${M ? '<th><input type="checkbox" id="selAll" aria-label="Select all on this page"></th>' : ""}<th>Name</th><th>Phone</th><th>City</th><th>Source</th><th>Caller</th><th>Status</th>${P.notes ? "<th>Last remark</th>" : ""}<th>Updated</th>${M ? "<th>Admins who see it</th>" : ""}</tr></thead>
      <tbody id="lbody">${leadRows.map(leadRowHtml).join("")}</tbody></table></div>
      <div class="row" style="justify-content:center;margin-top:12px" id="moreBox">${leadRows.length < leadTotal ? `<button class="btn" id="more">Show more (${num(leadTotal - leadRows.length)} left)</button>` : ""}</div>`
      : `<div class="empty">No leads match.${M ? " Import a file to get started." : ""}</div>`}
    </section>`;
  },
  bind() {
    let qt; $("#lq").oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { lf.q = e.target.value; sel.clear(); selAllMatching = false; const p = e.target.selectionStart; await render(); const i = $("#lq"); if (i) { i.focus(); i.setSelectionRange(p, p); } }, 350); };
    const refilter = (k) => (e) => { lf[k] = e.target.value; sel.clear(); selAllMatching = false; render(); };
    $("#lc").onchange = refilter("caller"); $("#ls").onchange = refilter("status"); $("#lsrc").onchange = refilter("source");
    if ($("#ladm")) $("#ladm").onchange = refilter("admin");
    if ($("#distribute")) $("#distribute").onclick = async () => { try { const r = await api("/manage/leads/distribute", { method: "POST" }); toast(r.updated ? `${num(r.updated)} leads split between callers` : "No unassigned leads"); render(); } catch (e) { fail(e); } };
    if ($("#addLead")) $("#addLead").onclick = addLeadForm;
    if ($("#export")) $("#export").onclick = exportLeads;
    if ($("#more")) $("#more").onclick = loadMoreLeads;
    bindLeadRows(); bulkBar();
  },
};
async function loadMoreLeads() {
  try {
    const r = await api("/view/leads" + qs({ ...lf, offset: leadRows.length }));
    leadRows.push(...r.rows);
    $("#lbody").insertAdjacentHTML("beforeend", r.rows.map(leadRowHtml).join(""));
    $("#moreBox").innerHTML = leadRows.length < leadTotal ? `<button class="btn" id="more">Show more (${num(leadTotal - leadRows.length)} left)</button>` : "";
    if ($("#more")) $("#more").onclick = loadMoreLeads;
    bindLeadRows(); labelTables();
  } catch (e) { fail(e); }
}
function bindLeadRows() {
  $$(".sel").forEach((c) => (c.onchange = () => { selAllMatching = false; c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); bulkBar(); }));
  ["#selAll", "#selAllM"].forEach((id) => {
    const sa = $(id); if (!sa) return;
    sa.onchange = () => {
      selAllMatching = false;
      $$(".sel").forEach((c) => { c.checked = sa.checked; sa.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); });
      ["#selAll", "#selAllM"].forEach((o) => { if ($(o)) $(o).checked = sa.checked; });
      bulkBar();
    };
  });
  $$(".asg").forEach((s) => (s.onchange = async () => { try { await api("/manage/leads/assign", { method: "POST", body: { ids: [s.dataset.id], callerId: s.value || null } }); toast(`Assigned to ${cname(s.value)}`); } catch (e) { fail(e); } }));
  $$("[data-hist]").forEach((b) => (b.onclick = () => leadHistory(leadRows.find((l) => l.id === b.dataset.hist))));
}
/** The leads a bulk action applies to: the ticked rows, or every lead matching the filters. */
const target = () => (selAllMatching ? { filter: { ...lf } } : { ids: [...sel] });
const targetCount = () => (selAllMatching ? leadTotal : sel.size);
function bulkBar() {
  const b = $("#bulk"); if (!b || !ME.manage) return;
  const n = targetCount();
  if (!n) { b.innerHTML = ""; return; }
  const pageAll = sel.size && sel.size === leadRows.length && leadTotal > leadRows.length;
  b.innerHTML = `<div class="bulk" style="display:grid;gap:10px">
    <div class="row"><b>${num(n)} lead${n === 1 ? "" : "s"} selected</b>
      ${pageAll && !selAllMatching ? `<button class="linkbtn" id="selMatch">Select all ${num(leadTotal)} matching leads</button>` : ""}
      ${selAllMatching ? `<span class="note">All leads matching the current filters</span>` : ""}
      <button class="btn ghost sm" id="bulkClear">Clear</button></div>
    <div class="row">
      <span class="label">Admins</span>
      <select id="bulkAdm" aria-label="Admin">${ADMINS.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("") || "<option value=''>No admins yet</option>"}</select>
      <button class="btn primary sm" id="shareGo" ${ADMINS.length ? "" : "disabled"}>Show to admin</button>
      <button class="btn sm" id="unshareGo" ${ADMINS.length ? "" : "disabled"}>Hide from admin</button>
    </div>
    <div class="row">
      <span class="label">Caller</span>
      <select id="bulkTo" aria-label="Assign selected to">${callerOpts("", { blank: "Unassign" })}</select>
      <button class="btn sm" id="bulkGo">Assign</button>
      <button class="btn sm" id="bulkDel" style="color:var(--bad)">Delete</button><span id="delConfirm"></span>
    </div></div>`;
  const done = (msg) => { toast(msg); sel.clear(); selAllMatching = false; render(); };
  if ($("#selMatch")) $("#selMatch").onclick = () => { selAllMatching = true; bulkBar(); };
  $("#bulkClear").onclick = () => { sel.clear(); selAllMatching = false; $$(".sel").forEach((c) => (c.checked = false)); ["#selAll", "#selAllM"].forEach((o) => { if ($(o)) $(o).checked = false; }); bulkBar(); };
  const share = (action) => async () => {
    const id = $("#bulkAdm").value; if (!id) return;
    try {
      const r = await api(`/manage/admins/${id}/leads`, { method: "POST", body: { action, ...target() } });
      done(action === "add" ? `${num(r.changed)} lead${r.changed === 1 ? "" : "s"} now visible to ${aname(id)}` : `${num(r.changed)} lead${r.changed === 1 ? "" : "s"} hidden from ${aname(id)}`);
    } catch (e) { fail(e); }
  };
  $("#shareGo").onclick = share("add"); $("#unshareGo").onclick = share("remove");
  $("#bulkGo").onclick = async () => { const to = $("#bulkTo").value || null; try { const r = await api("/manage/leads/assign", { method: "POST", body: { ...target(), callerId: to } }); done(`${num(r.updated)} leads assigned to ${cname(to)}`); } catch (e) { fail(e); } };
  $("#bulkDel").onclick = () => {
    $("#delConfirm").innerHTML = `<button class="btn sm" style="color:var(--bad);border-color:var(--bad)" id="delYes">Yes, delete ${num(n)} leads and their call notes</button>`;
    $("#delYes").onclick = async () => { try { const r = await api("/manage/leads/delete", { method: "POST", body: target() }); done(`${num(r.deleted)} leads deleted`); } catch (e) { fail(e); } };
  };
}
function addLeadForm() {
  openDrawer({
    title: "Add lead", saveLabel: "Add lead",
    body: `<label class="field"><span>Name</span><input type="text" id="an"></label>
      <label class="field"><span>Mobile number</span><input type="tel" id="ap" inputmode="numeric" required></label>
      <label class="field"><span>City</span><input type="text" id="ac"></label>
      <label class="field"><span>Source</span><input type="text" id="as" placeholder="e.g. Meta Ads, Walk-in"></label>
      <label class="field"><span>Assign to</span><select id="aa">${callerOpts("")}</select></label>`,
    onSave: async () => { await api("/manage/leads", { method: "POST", body: { name: $("#an").value, phone: $("#ap").value, city: $("#ac").value, source: $("#as").value, assignedTo: $("#aa").value || null } }); toast("Lead added"); render(); },
  });
}
async function exportLeads() {
  if (!window.XLSX) return toast("Excel export couldn't load. Check your internet connection.");
  try {
    toast("Preparing file…");
    const rows = await api("/view/export" + qs(lf));
    const P = ME.perms;
    const data = rows.map((l) => {
      const o = { Name: l.name, Phone: l.phone, City: l.city, Source: l.source, Caller: l.caller || "", Status: statusOf(l)[1],
        "Pick-up": l.called ? pickLabel(l.picked) : "", Response: outLabel(l.outcome) };
      if (P.notes) o.Remarks = l.remarks || "";
      o["Follow-up"] = l.follow_up || ""; o.Attempts = l.attempts;
      if (P.revenue) o["Sale value"] = l.deal_value || 0;
      o["Added on"] = l.created_at ? new Date(l.created_at).toLocaleString("en-IN") : "";
      o["Last update"] = l.updated_at ? new Date(l.updated_at).toLocaleString("en-IN") : "";
      return o;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Leads");
    XLSX.writeFile(wb, `leads-${localDate()}.xlsx`);
  } catch (e) { fail(e); }
}
async function leadHistory(l) {
  openDrawer({ title: l.name, eyebrow: `<div class="label">Call history</div>`, body: `<div class="loading">Loading…</div>` });
  try {
    const h = await api(`/view/leads/${l.id}/history`);
    $("#dbody").innerHTML = `<div class="q"><span class="label">Number</span><span class="callnow">${esc(l.phone)}</span><span class="note">${esc(l.city)} · ${esc(l.source)}</span></div>
      <div class="hist">${histHtml(h, ME.perms.revenue)}</div>`;
  } catch (e) { $("#dbody").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
const histHtml = (h, showRev) => h.length ? h.map((x) => `<div><span class="note">${fmtDT(x.created_at)} · ${esc(x.caller || "")}</span><br>${esc(pickLabel(x.picked))}${x.outcome ? " · " + esc(outLabel(x.outcome)) : ""}${x.follow_up ? ` (call back ${esc(x.follow_up)})` : ""}${showRev && x.outcome === "converted" ? ` · ${inr(x.deal_value)}` : ""}${x.remarks ? `<br>${esc(x.remarks)}` : ""}</div>`).join("") : '<span class="note">Not called yet.</span>';

/* ----- import (super admin) ----- */
let pending = null;
VIEWS.import = {
  async load() {
    [CALLERS, ADMINS] = await Promise.all([api("/view/callers"), api("/manage/admins")]);
    return `<section class="panel"><h2>Import leads from Excel or CSV</h2>
      <div class="drop" id="drop"><b>Drop a .xlsx, .xls or .csv file here</b><span class="muted">or</span>
        <label class="btn primary" for="file">Choose file</label><input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
        <span class="note">The first row must be headers. Recognised columns: <code>Name</code> <code>Phone</code> or <code>Mobile</code> <code>City</code> <code>Source</code> <code>Caller</code> (optional, the caller's name). Numbers already in your leads are skipped.</span></div>
      <div id="preview"></div></section>`;
  },
  bind() {
    const d = $("#drop");
    $("#file").onchange = (e) => e.target.files[0] && parseFile(e.target.files[0]);
    d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); };
    d.ondragleave = () => d.classList.remove("over");
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove("over"); e.dataTransfer.files[0] && parseFile(e.dataTransfer.files[0]); };
    showPreview();
  },
};
function guess(h) {
  h = String(h).toLowerCase();
  if (/caller|agent|assign/.test(h)) return "caller";
  if (/name/.test(h)) return "name";
  if (/phone|mobile|contact|number|whatsapp/.test(h)) return "phone";
  if (/city|location|area|address/.test(h)) return "city";
  if (/source|campaign|platform/.test(h)) return "source";
  return "";
}
function parseFile(f) {
  if (!window.XLSX) return toast("The file reader couldn't load. Check your internet connection.");
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
      if (rows.length < 2) return toast("That file has no data rows.");
      const map = rows[0].map(guess);
      if (!map.includes("phone")) return toast("No Phone or Mobile column found in the first row.");
      const out = rows.slice(1).map((r) => { const o = {}; map.forEach((k, i) => { if (k && !o[k]) o[k] = String(r[i]).trim(); }); return o; }).filter((o) => o.phone);
      pending = { file: f.name, rows: out }; showPreview();
    } catch { toast("Could not read that file. Save it as .xlsx or .csv and try again."); }
  };
  r.readAsArrayBuffer(f);
}
function showPreview() {
  const p = $("#preview"); if (!p) return;
  if (!pending) { p.innerHTML = ""; return; }
  const active = CALLERS.filter((c) => c.active);
  p.innerHTML = `<div style="margin-top:18px;display:grid;gap:12px">
    <b>${esc(pending.file)}: ${num(pending.rows.length)} rows with a phone number</b>
    <div class="row"><span class="label">Assign to</span>
      <select id="impTo"><option value="rr">Split evenly across all callers</option><option value="file">Use the Caller column from the file</option><option value="">Leave unassigned</option>${active.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      </div>
    <div class="row"><span class="label">Show to admin</span>
      <select id="impShow"><option value="">No one yet</option>${ADMINS.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      <span class="note">Use this when the file is one team lead's referrals.</span></div>
    <div class="row"><button class="btn primary" id="impGo">Import leads</button><button class="btn ghost" id="impX">Cancel</button></div>
    <div class="tablebox stackbox"><table class="stack"><tr><th>Name</th><th>Phone</th><th>City</th><th>Source</th><th>Caller</th></tr>
    ${pending.rows.slice(0, 12).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${esc(r.phone)}</td><td>${esc(r.city)}</td><td>${esc(r.source)}</td><td>${esc(r.caller)}</td></tr>`).join("")}</table></div>
    ${pending.rows.length > 12 ? `<span class="note">Showing first 12 of ${num(pending.rows.length)}</span>` : ""}</div>`;
  labelTables(p);
  $("#impX").onclick = () => { pending = null; showPreview(); };
  $("#impGo").onclick = async () => {
    $("#impGo").disabled = true; $("#impGo").textContent = "Importing…";
    try {
      const r = await api("/manage/leads/import", { method: "POST", body: { rows: pending.rows, assign: $("#impTo").value, showTo: $("#impShow").value || null, defaultSource: pending.file.replace(/\.[^.]+$/, "") } });
      pending = null; lf = { caller: "", status: "", source: "", admin: "", q: "" }; tab = "leads"; await render();
      toast(`${num(r.added)} leads imported${r.duplicates ? `, ${num(r.duplicates)} already existed` : ""}${r.invalid ? `, ${num(r.invalid)} invalid numbers` : ""}${r.shared ? `, ${num(r.shared)} shared with admin` : ""}`);
    } catch (e) { fail(e); $("#impGo").disabled = false; $("#impGo").textContent = "Import leads"; }
  };
}

/* ----- callers (super admin) ----- */
let CALLER_ROWS = [];
VIEWS.callers = {
  async load() {
    CALLER_ROWS = await api("/manage/callers");
    const activeN = CALLER_ROWS.filter((c) => c.active).length;
    return `<section class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Callers <span class="muted" style="font-size:15px;font-weight:500">${activeN} active</span></h2>
      <button class="btn primary" id="addCaller">Add caller</button></div>
      ${CALLER_ROWS.length ? `<div class="tablebox stackbox"><table class="stack"><tr><th>Name</th><th>Mobile (login)</th><th>Status</th><th class="n">Assigned</th><th class="n">Not called yet</th><th></th></tr>
      ${CALLER_ROWS.map((c) => `<tr class="${c.active ? "" : "dim"}"><td><b>${esc(c.name)}</b></td><td class="num">${esc(c.phone)}</td><td>${c.active ? '<span class="pill p-won">Active</span>' : '<span class="pill p-ni">Disabled</span>'}</td>
        <td class="n">${num(c.assigned)}</td><td class="n">${num(c.pending)}</td><td><button class="btn sm" data-ced="${c.id}">Edit</button></td></tr>`).join("")}</table></div>`
      : `<div class="empty">No callers yet. Add a caller, then share their mobile number and password so they can log in.</div>`}
    </section>`;
  },
  bind() {
    $("#addCaller").onclick = () => callerForm(null);
    $$("[data-ced]").forEach((b) => (b.onclick = () => callerForm(CALLER_ROWS.find((c) => c.id === b.dataset.ced))));
  },
};
function callerForm(c) {
  openDrawer({
    title: c ? `Edit ${c.name}` : "Add caller", saveLabel: c ? "Save changes" : "Add caller",
    body: `<label class="field"><span>Name</span><input type="text" id="cn" value="${esc(c?.name || "")}"></label>
      <label class="field"><span>Mobile number (login)</span><input type="tel" id="cp" inputmode="numeric" value="${esc(c?.phone || "")}"></label>
      <label class="field"><span>${c ? "New password (leave blank to keep current)" : "Password"}</span><input type="text" id="cpw" autocomplete="new-password" placeholder="At least 6 characters"></label>
      ${c ? `<label class="tg" style="border:1px solid var(--line);border-radius:8px;padding:10px"><input type="checkbox" id="ca" ${c.active ? "checked" : ""}><b>Can log in</b><small>Disabling a caller logs them out and moves their open leads back to Unassigned.</small></label>` : ""}`,
    onSave: async () => {
      const body = { name: $("#cn").value, phone: $("#cp").value };
      if ($("#cpw").value) body.password = $("#cpw").value;
      if (c) {
        body.active = $("#ca").checked;
        const r = await api(`/manage/callers/${c.id}`, { method: "PATCH", body });
        toast(r.released ? `Caller disabled. ${num(r.released)} open leads are now unassigned.` : "Caller updated");
      } else {
        if (!body.password) throw new Error("Set a password for the caller.");
        await api("/manage/callers", { method: "POST", body }); toast(`${body.name} added`);
      }
      render();
    },
  });
}

/* ----- expenses ----- */
VIEWS.expenses = {
  async load() {
    const rng = periodRange(), M = ME.manage;
    const [e, s] = await Promise.all([api("/view/expenses" + qs(rng)), api("/view/stats" + qs(rng))]);
    const total = e.rows.reduce((a, x) => a + x.amount, 0);
    return `${periodBar()}<div class="kpis">
      <div class="kpi"><span class="label">Spent</span><span class="v">${inr(total)}</span><span class="s">${e.rows.length} entries</span></div>
      ${s.revenue ? `<div class="kpi"><span class="label">Revenue</span><span class="v">${inr(s.revenue.total)}</span><span class="s">${num(s.sales.won)} sales</span></div>` : ""}
      ${s.roi ? `<div class="kpi hero"><span class="label">Net ${s.roi.profit >= 0 ? "profit" : "loss"}</span><span class="v">${inr(Math.abs(s.roi.profit))}</span><span class="s">ROI ${s.roi.roi == null ? "—" : s.roi.roi.toFixed(1) + "%"}</span></div>` : ""}
    </div>
    <div class="grid2">
      ${M ? `<section class="panel"><h2>Add expense</h2><form id="addE" style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))">
        <input type="date" id="ed" value="${localDate()}" aria-label="Date"><select id="ec" aria-label="Category">${e.categories.map((c) => `<option>${c}</option>`).join("")}</select>
        <input type="number" id="ea" placeholder="Amount (₹)" min="1" step="any" required aria-label="Amount"><input type="text" id="en" placeholder="Note (optional)" aria-label="Note">
        <button class="btn primary" style="justify-self:start">Add expense</button></form></section>` : ""}
      <section class="panel"><h2>Spend by category</h2>${s.expenses?.byCategory.length ? bars(s.expenses.byCategory.map((x) => [x.category, x.amount]), inr, 140) : '<div class="empty">No expenses in this period</div>'}</section>
    </div>
    <section class="panel"><h2>Expense log</h2>${e.rows.length ? `<div class="tablebox stackbox"><table class="stack"><tr><th>Date</th><th>Category</th><th>Note</th><th class="n">Amount</th>${M ? "<th></th>" : ""}</tr>
      ${e.rows.map((x) => `<tr><td class="num">${esc(x.date)}</td><td>${esc(x.category)}</td><td class="muted">${esc(x.note)}</td><td class="n">${inr(x.amount)}</td>${M ? `<td><button class="btn ghost sm" data-dx="${x.id}">Delete</button></td>` : ""}</tr>`).join("")}</table></div>` : '<div class="empty">No expenses in this period.</div>'}</section>`;
  },
  bind() {
    bindPeriod();
    if ($("#addE")) $("#addE").onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api("/manage/expenses", { method: "POST", body: { date: $("#ed").value, category: $("#ec").value, amount: $("#ea").value, note: $("#en").value } }); toast(`${inr($("#ea").value)} added`); render(); } catch (e) { fail(e); }
    };
    $$("[data-dx]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Confirm delete"; b.style.color = "var(--bad)"; return; }
      try { await api(`/manage/expenses/${b.dataset.dx}`, { method: "DELETE" }); toast("Expense deleted"); render(); } catch (e) { fail(e); }
    }));
  },
};

/* ----- admins (super admin): view-only accounts ----- */
let PERM_DEFS = [];
VIEWS.admins = {
  async load() {
    const [admins, defs] = await Promise.all([api("/manage/admins"), PERM_DEFS.length ? PERM_DEFS : api("/manage/perm-defs")]);
    ADMINS = admins; PERM_DEFS = defs;
    return `<section class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><h2 style="margin:0">Admins</h2><button class="btn primary" id="addAdmin">Add admin</button></div>
      <p class="note" style="margin:0 0 14px">Admins can only view. Each one sees the leads you share with them, the sections you switch on, and the revenue figure you type. They never see real sale values, expenses or ROI, and they don't see each other.</p>
      ${admins.length ? `<div class="tablebox stackbox"><table class="stack"><tr><th>Admin</th><th>Status</th><th>Leads they see</th><th>Revenue they see</th><th>Sections</th><th></th></tr>
      ${admins.map((a) => `<tr class="${a.active ? "" : "dim"}">
        <td><b>${esc(a.name)}</b><br><span class="note num">${esc(a.phone)}</span></td>
        <td>${a.active ? '<span class="pill p-won">Active</span>' : '<span class="pill p-ni">Disabled</span>'}</td>
        <td style="white-space:nowrap">${a.leadAccess === "all" ? "All leads" : `<button class="linkbtn" data-leadsof="${a.id}">${num(a.sharedLeads)} shared lead${a.sharedLeads === 1 ? "" : "s"}</button>`}</td>
        <td>${a.perms.revenue && a.revenueAmount != null ? `<b class="num">${inr(a.revenueAmount)}</b><br><span class="note">${esc(a.revenueNote || "Revenue")}</span>` : '<span class="note">Not shown</span>'}</td>
        <td style="min-width:220px">${PERM_DEFS.filter((p) => a.perms[p.key]).map((p) => `<span class="tag on">${esc(p.label)}</span>`).join("") || '<span class="note">Overview only</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-edit="${a.id}">Edit</button> <button class="btn ghost sm" data-view="${a.id}" ${a.active ? "" : "disabled"}>View portal</button></td></tr>`).join("")}
      </table></div>` : `<div class="empty">No admins yet. Add a team lead, then share their referral leads with them from the Leads tab.</div>`}
    </section>
    <section class="panel"><h2>How to share leads with an admin</h2>
      <ol style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>When importing a team lead's referrals, pick them under <b>Show to admin</b>. Their leads are shared as they're imported.</li>
        <li>For leads already in the system, open <b>Leads</b>, filter (for example by source "Affiliate - Rahul"), tick the leads or <b>Select all matching</b>, then click <b>Show to admin</b>.</li>
        <li>To take leads away, filter by <b>Shared with</b> that admin, select them and click <b>Hide from admin</b>.</li>
      </ol></section>`;
  },
  bind() {
    $("#addAdmin").onclick = () => adminForm(null);
    $$("[data-edit]").forEach((b) => (b.onclick = () => adminForm(ADMINS.find((a) => a.id === b.dataset.edit))));
    $$("[data-leadsof]").forEach((b) => (b.onclick = () => { lf = { caller: "", status: "", source: "", admin: b.dataset.leadsof, q: "" }; tab = "leads"; render(); }));
    $$("[data-view]").forEach((b) => (b.onclick = async () => {
      try {
        const r = await api(`/manage/admins/${b.dataset.view}/view`, { method: "POST" });
        store.set("dd_super", token); token = r.token; store.set("dd_token", token); boot();
      } catch (e) { fail(e); }
    }));
  },
};
function adminForm(a) {
  const P = a ? a.perms : Object.fromEntries(PERM_DEFS.map((p) => [p.key, ["leads", "followUps", "calls"].includes(p.key)]));
  const access = a ? a.leadAccess : "picked";
  openDrawer({
    title: a ? `Edit ${a.name}` : "Add admin",
    saveLabel: a ? "Save changes" : "Create admin",
    body: `
      <label class="field"><span>Name</span><input type="text" id="fn" value="${esc(a?.name || "")}" placeholder="e.g. Rahul Chopra"></label>
      <label class="field"><span>Mobile number (login)</span><input type="tel" id="fp" inputmode="numeric" value="${esc(a?.phone || "")}"></label>
      <label class="field"><span>${a ? "New password (leave blank to keep current)" : "Password"}</span><input type="text" id="fpw" autocomplete="new-password" placeholder="At least 6 characters"></label>
      ${a ? `<label class="tg" style="border:1px solid var(--line);border-radius:8px;padding:10px"><input type="checkbox" id="fa" ${a.active ? "checked" : ""}><b>Account active</b><small>Turning this off logs the admin out straight away.</small></label>` : ""}
      <div><div class="label" style="margin-bottom:6px">Which leads can they see?</div>
        <div class="toggles">
          <label class="tg"><input type="radio" name="access" value="picked" ${access === "picked" ? "checked" : ""}><b>Only leads I share with them</b><small>${a ? `${num(a.sharedLeads)} shared now. ` : ""}Share leads from the Leads tab or while importing. They see the calls on those leads only.</small></label>
          <label class="tg"><input type="radio" name="access" value="all" ${access === "all" ? "checked" : ""}><b>All leads</b><small>Every lead and call in the business</small></label>
        </div></div>
      <div><div class="label" style="margin-bottom:6px">Revenue they see</div>
        <label class="tg" style="padding-top:0"><input type="checkbox" id="frv" ${P.revenue ? "checked" : ""}><b>Show a revenue figure</b><small>They see only the amount you type here, never real sale values.</small></label>
        <div id="revBox" style="display:${P.revenue ? "grid" : "none"};gap:10px;padding-left:30px">
          <label class="field"><span>Amount (₹)</span><input type="number" id="fra" min="0" step="any" value="${a?.revenueAmount ?? ""}" placeholder="e.g. 39000"></label>
          <label class="field"><span>Label they see</span><input type="text" id="frn" value="${esc(a?.revenueNote || "Revenue from your referrals")}" maxlength="120"></label>
        </div></div>
      <div><div class="label" style="margin-bottom:4px">Sections they see</div>
      <div class="toggles">${PERM_DEFS.map((p) => `<label class="tg"><input type="checkbox" data-perm="${p.key}" ${P[p.key] ? "checked" : ""}><b>${esc(p.label)}</b><small>${esc(p.help)}</small></label>`).join("")}</div>
      <p class="note">Admins can never add, edit, assign or delete anything.</p></div>`,
    bind() { $("#frv").onchange = () => { $("#revBox").style.display = $("#frv").checked ? "grid" : "none"; }; },
    onSave: async () => {
      const perms = Object.fromEntries($$("[data-perm]").map((c) => [c.dataset.perm, c.checked]));
      perms.revenue = $("#frv").checked;
      if (perms.revenue && $("#fra").value === "") throw new Error("Enter the revenue amount to show, or untick Show a revenue figure.");
      const body = { name: $("#fn").value, phone: $("#fp").value, perms, leadAccess: $("input[name=access]:checked").value,
        revenueAmount: perms.revenue ? $("#fra").value : (a?.revenueAmount ?? ""), revenueNote: perms.revenue ? $("#frn").value : (a?.revenueNote ?? "") };
      if ($("#fpw").value) body.password = $("#fpw").value;
      if (a) { body.active = $("#fa").checked; await api(`/manage/admins/${a.id}`, { method: "PATCH", body }); toast("Admin updated"); }
      else { if (!body.password) throw new Error("Set a password for the admin."); await api("/manage/admins", { method: "POST", body }); toast("Admin created. Share their leads from the Leads tab."); }
      render();
    },
  });
}

/* ----- settings (super admin) ----- */
VIEWS.settings = {
  async load() {
    const s = await api("/manage/settings");
    return `<section class="panel" style="max-width:640px"><h2>Settings</h2>
      <form id="setForm" style="display:grid;gap:16px">
        <label class="tg" style="border:1px solid var(--line);border-radius:8px;padding:10px"><input type="checkbox" id="scr" ${s.callerRevenue ? "checked" : ""}><b>Callers see their own sale values</b><small>When off, callers see how many sales they made but not the amounts.</small></label>
        <button class="btn primary" style="justify-self:start">Save settings</button>
      </form></section>`;
  },
  bind() {
    $("#setForm").onsubmit = async (e) => {
      e.preventDefault();
      try { const s = await api("/manage/settings", { method: "PATCH", body: { callerRevenue: $("#scr").checked } }); toast("Settings saved"); render(); } catch (err) { fail(err); }
    };
  },
};

/* =====================================================================
   CALLER
   ===================================================================== */
let cView = "todo", qRows = [];
const CVIEWS = [["todo", "To call"], ["retry", "Retry"], ["cb", "Call back"], ["int", "Interested"], ["all", "All"]];
VIEWS.queue = {
  async load() {
    const [st, q] = await Promise.all([api("/caller/stats"), api("/caller/leads?view=" + cView)]);
    qRows = q.rows;
    const showRev = ME.perms?.callerRevenue;
    return `<div class="kpis">
      <div class="kpi"><span class="label">Assigned to you</span><span class="v">${num(st.assigned)}</span><span class="s">${num(st.pending)} not called yet</span></div>
      <div class="kpi"><span class="label">Picked up</span><span class="v">${num(st.picked)}</span><span class="s">of ${num(st.calls)} calls made</span></div>
      <div class="kpi hero"><span class="label">Your sales</span><span class="v">${num(st.sales)}</span><span class="s">${showRev ? inr(st.revenue) + " closed" : "leads converted"}</span></div></div>
    <div class="chips" role="group" aria-label="Filter leads">${CVIEWS.map(([k, t]) => `<button class="chip" data-cv="${k}" aria-pressed="${k === cView}">${t}<b>${num(q.counts[k])}</b></button>`).join("")}</div>
    <div class="queue">${qRows.map((l) => `<div class="lead"><span class="nm">${esc(l.name)}</span>${pill(l)}<span class="ph">${esc(l.phone)}</span><span class="note">${esc(l.city)}</span>
      <span class="meta">${l.follow_up && l.outcome === "callback" ? `Call back ${esc(l.follow_up)} · ` : ""}${esc(l.remarks) || esc(l.source)}</span>
      <div class="acts"><a class="btn primary callbtn" href="${telOf(l.phone)}" data-call="${l.id}">${PHONE_ICON}Call</a><button class="btn" data-open="${l.id}">Add note</button></div></div>`).join("")
      || '<div class="panel empty">Nothing in this list.</div>'}</div>
    ${qRows.length >= 300 ? '<p class="note">Showing the first 300. Finish these to see more.</p>' : ""}`;
  },
  bind() {
    $$("[data-cv]").forEach((b) => (b.onclick = () => { cView = b.dataset.cv; render(); }));
    $$("[data-open]").forEach((b) => (b.onclick = () => callReport(qRows.find((l) => l.id === b.dataset.open), false)));
    $$("[data-call]").forEach((a) => (a.onclick = () => { const l = qRows.find((x) => x.id === a.dataset.call); setTimeout(() => callReport(l, true), 300); }));
  },
};
function callReport(l, afterCall) {
  const d = { picked: l.picked || "", outcome: l.outcome || "", remarks: "", followUp: l.follow_up || "", dealValue: l.deal_value || "" };
  const showRev = ME.perms?.callerRevenue;
  let hist = null;
  const draw = () => {
    const keep = () => { if ($("#rm")) d.remarks = $("#rm").value; if ($("#fu")) d.followUp = $("#fu").value; if ($("#dv")) d.dealValue = $("#dv").value; };
    openDrawer({
      title: l.name, saveLabel: "Save call", focus: false,
      eyebrow: afterCall ? `<div class="label" style="color:var(--accent)">How did the call go?</div>` : "",
      body: `<div class="q"><span class="label">Number</span><div class="row"><span class="callnow">${esc(l.phone)}</span><a class="btn primary sm callbtn" style="flex:0" href="${telOf(l.phone)}">${PHONE_ICON}Call</a></div>
          ${afterCall ? `<div class="after">Call started. Fill this in when you hang up.</div>` : ""}</div>
        <div class="q"><span class="label">Did they pick up?</span><div class="opts" id="op">${PICK.map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${d.picked === k}">${v}</button>`).join("")}</div></div>
        ${d.picked === "yes" ? `<div class="q"><span class="label">Response</span><div class="opts" id="oo">${OUT.map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${d.outcome === k}">${v}</button>`).join("")}</div></div>` : ""}
        ${d.picked === "yes" && d.outcome === "callback" ? `<div class="q"><label class="label" for="fu">Call back on</label><input type="date" id="fu" value="${esc(d.followUp || localDate())}"></div>` : ""}
        ${d.picked === "yes" && d.outcome === "converted" ? `<div class="q"><label class="label" for="dv">Sale value (₹)</label><input type="number" id="dv" min="0" value="${esc(d.dealValue)}" placeholder="e.g. 15000"></div>` : ""}
        <div class="q"><label class="label" for="rm">Note on how the call went</label><textarea id="rm" placeholder="What did they say?">${esc(d.remarks)}</textarea>
          <div class="qr">${QR.map((q) => `<button type="button" data-q="${esc(q)}">+ ${esc(q)}</button>`).join("")}</div></div>
        <div class="q"><span class="label">Earlier calls</span><div class="hist" id="hist">${hist == null ? '<span class="note">Loading…</span>' : histHtml(hist, showRev)}</div></div>`,
      bind() {
        $$("#op button").forEach((b) => (b.onclick = () => { keep(); d.picked = b.dataset.v; if (d.picked !== "yes") d.outcome = ""; draw(); }));
        $$("#oo button").forEach((b) => (b.onclick = () => { keep(); d.outcome = b.dataset.v; draw(); }));
        $$("[data-q]").forEach((b) => (b.onclick = () => { const t = $("#rm"); t.value = (t.value.trim() ? t.value.trim() + ". " : "") + b.dataset.q; t.focus(); }));
      },
      onSave: async () => {
        keep();
        if (!d.picked) throw new Error("Choose whether they picked up.");
        if (d.picked === "yes" && !d.outcome) throw new Error("Choose their response.");
        await api(`/caller/leads/${l.id}/call`, { method: "POST", body: d });
        toast("Call saved"); render();
      },
    });
  };
  draw();
  api(`/caller/leads/${l.id}/history`).then((h) => { hist = h; const el = $("#hist"); if (el) el.innerHTML = histHtml(h, showRev); }).catch(() => { const el = $("#hist"); if (el) el.innerHTML = '<span class="note">Could not load earlier calls.</span>'; });
}

VIEWS.log = {
  async load() {
    const rows = await api("/caller/log");
    return `<section class="panel"><h2>Your call log</h2>${rows.length ? `<div class="tablebox stackbox"><table class="stack"><tr><th>When</th><th>Lead</th><th>Pick-up</th><th>Response</th><th>Note</th></tr>
      ${rows.map((x) => `<tr><td class="note">${fmtDT(x.created_at)}</td><td><b>${esc(x.name)}</b><br><span class="num note">${esc(x.phone)}</span></td><td>${esc(pickLabel(x.picked))}</td><td>${esc(outLabel(x.outcome) || "—")}</td><td class="muted">${esc(x.remarks)}</td></tr>`).join("")}</table></div>`
      : '<div class="empty">No calls logged yet.</div>'}</section>`;
  },
};

boot();
})();
