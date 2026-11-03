# DialDesk

A calling CRM for one business, with three kinds of login:

- **Super admin** (the owner) runs everything: imports leads from Excel/CSV, adds callers, assigns leads, logs expenses, sees every number and ROI. Also creates admin logins and decides exactly what each admin can see.
- **Admin** (for example a team lead who brings referrals through an affiliate link): view only. Sees only the leads the super admin shares with them, the calls on those leads, the sections switched on, and a revenue figure the super admin types. Never sees real sale values, expenses or ROI. Can't add, edit, assign or delete anything, and doesn't know other admins exist.
- **Caller**: taps **Call**, then reports how the call went (picked up or not, response, note, call-back date or sale value).

Stack: Node 20+, Express 5, Turso (libSQL), plain HTML/JS front end served by the same server. Deploys to Render.

## Run it on your computer

```bash
npm install
cp .env.example .env          # leave TURSO_DATABASE_URL empty to use a local file (local.db)
# in .env set SUPERADMIN_PHONE=9xxxxxxxxx and SUPERADMIN_PASSWORD=yourpass
npm run seed:demo             # optional: team-lead admins Rahul 9000000001 & Neha 9000000002, callers 9000000011-13, password demo123
npm run dev
```

Open http://localhost:3000 and log in with the super admin number and password.

## Deploy

### 1. Create the Turso database

```bash
turso db create dialdesk
turso db show dialdesk --url                # copy -> TURSO_DATABASE_URL
turso db tokens create dialdesk             # copy -> TURSO_AUTH_TOKEN
```

The tables are created automatically on the first start.

### Turso or local file

On start the app tries Turso. If `TURSO_DATABASE_URL` is empty, still the example value, or Turso can't be reached, it uses a local file `local.db` instead and prints why in the terminal. The super admin also sees a yellow warning bar with the reason. `GET /api/health` shows `"database": "turso"` or `"local"`.

On Render the local file is wiped every time the app redeploys or restarts, so treat the warning bar as "fix Turso now".

Common Turso errors:
- **HTTP 404**: the database in the URL doesn't exist. Run `turso db show <name> --url` again and paste it exactly.
- **401 / 403**: the token is wrong or expired. Run `turso db tokens create <name>` and paste the new token.

### 2. Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint**, pick the repo. It reads `render.yaml`.
3. Fill in the four secret values when asked: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SUPERADMIN_PHONE`, `SUPERADMIN_PASSWORD`. `JWT_SECRET` is generated for you.
4. Deploy. When the log shows `Super admin created`, log in at your Render URL.

The blueprint uses the free plan. Free instances sleep after 15 minutes without visits, so the first open after a quiet spell takes about a minute. Change to `plan: starter` in `render.yaml` to keep it always on.

Business name and whether callers see their own sale values are on the **Settings** tab.

**Forgot the super admin password?** Set `SUPERADMIN_PASSWORD` to a new one, add `SUPERADMIN_RESET=1`, redeploy, log in, then remove `SUPERADMIN_RESET`.

## Android app (Capacitor)

Copy `public/` into your Capacitor `www` folder, set `window.DIALDESK_API` in `public/config.js` to your Render URL, and set `CORS_ORIGINS=https://localhost,capacitor://localhost` on Render. The **Call** button uses `tel:` links, which open the phone dialer.

## What admins can see

For each admin the super admin sets three things on **Admins → Edit**.

**1. Which leads.** "Only leads I share with them" (default) or "All leads". Share leads by:
- picking the admin under **Show to admin** when importing a file of their referrals, or
- on **Leads**, filtering (for example Source = "Affiliate - Rahul"), ticking leads or **Select all matching**, and clicking **Show to admin**. **Hide from admin** takes them away again.

The admin then sees those leads and only the calls made on them. The Leads list has an **Admins who see it** column and a filter for each admin.

**2. Revenue.** Tick **Show a revenue figure**, type the amount and the label they see (for example "Revenue from your referrals (October)"). Admins only ever see this typed figure. Real sale values are never sent to them.

**3. Sections.**

| Section | When it's off |
|---|---|
| Leads list | No Leads tab |
| Customer phone numbers | Numbers show as 98XXXXX210 and can't be searched |
| Call notes | Callers' remarks and call history are hidden |
| Follow-ups due | No follow-ups list |
| Call stats | No calls made, pick-up rate or funnel |
| Caller performance | No per-caller table |
| Lead sources | No results by source |
| Export to Excel | No export button |

All of this is enforced by the server, not just hidden on screen. **View portal** opens any admin's portal exactly as they see it.

## API overview

| Route | Who |
|---|---|
| `POST /api/auth/login`, `GET /api/me`, `POST /api/me/password` | everyone |
| `GET /api/view/stats`, `/view/leads`, `/view/leads/:id/history`, `/view/expenses`, `/view/export`, `/view/callers` | super admin (everything) and admins (filtered) |
| `/api/manage/leads…`, `/manage/callers`, `/manage/expenses`, `/manage/admins`, `/manage/admins/:id/leads` (share/hide), `/manage/settings` | super admin only |
| `/api/caller/leads`, `/leads/:id/call`, `/stats`, `/log` | caller |
