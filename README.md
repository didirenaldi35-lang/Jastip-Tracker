# Jastip China Desk

Shared desk for buying from China (Taobao / 1688 / WeChat suppliers) through jastippers to Jakarta and the end buyer: research, orders, shipments, location tracking and finance.

- **Frontend:** Vite (plain JavaScript, no framework), deployed on **Cloudflare Pages**
- **Database + login + realtime:** **Supabase** (Postgres with row-level security)
- **Code:** **GitHub**
- **Login:** email + password with a "Create an account" form. Google sign-in/sign-up is built in and switched on later (see "Google sign-in").
- **Starts empty.** No data is seeded.

```
index.html            page shell
src/main.js           boot: login screens, then the app
src/app.js            the desk itself
src/auth-ui.js        sign-in, forgot password, set password, waiting-for-approval screens
src/lib/              pure helpers (calc, format), Supabase adapter (db.js), auth, demo database
supabase/migrations/  0001_init.sql: tables, roles, row-level security
public/_headers       Cloudflare security headers (CSP etc.)
.github/workflows/    CI (tests + build) and optional deploy
```

## Quick start: put it live (V.1.0)

Follow in order. Details for each step are further down.

1. **Supabase:** create a project. SQL Editor → run `supabase/migrations/0001_init.sql` (just this one; run `0002_public_mode.sql` only if you want no login at all).
2. **Supabase → Authentication → Sign In / Providers → Email:** keep it on and keep **Allow new users to sign up** ON. For the fastest first test, switch **Confirm email** off (you can turn it on later).
3. **Supabase → Project Settings → API Keys:** copy the **Project URL** and the **Publishable key** (`sb_publishable_…`; the legacy `anon` key `eyJ…` also works). Never use the `secret` / `service_role` key.
4. **GitHub:** put all the files from inside this folder at the top level of your repo (so `package.json` sits at the root). Easiest is **GitHub Desktop**: clone the repo, copy everything in (Ctrl+A, so hidden files come along), Commit, Push. The browser uploader skips the hidden `.github` folder; the site does not need it.
5. **Cloudflare Pages → Settings → Variables and Secrets** (Production), exactly these names:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the Publishable key (use type **Text** so you can see what you pasted; no quotes, no spaces)
   - Build command `npm run build`, output directory `dist`.
6. **Trigger a build.** Variables only apply to a new build, and a Git-connected project has no manual deploy button: commit any small change (for example edit `README.md` on GitHub). Wait for **Success**.
7. **Supabase → Authentication → URL Configuration:** set **Site URL** to your `https://….pages.dev` address and add it under **Redirect URLs**.
8. **Open the live site in a private window and Create an account.** You must be the first person to sign up: the first account becomes the **Owner**.
9. Add a test order. Then sign up a second account in another browser: it should see nothing until you approve it in **Settings → Team**.
10. Share the link with your team.

If something goes wrong, see **Troubleshooting** at the end.

## Roles

| Role | Can do |
|---|---|
| **Owner** | Everything, plus Settings → Team (approve people, change access) |
| **Editor** | Read and change all data |
| **Viewer** | Read only |
| **Pending** | Signed in but not approved yet: sees nothing |

The first person to sign in becomes the **Owner**. People you invite from Supabase start as **Editor**. Anyone who signs up on their own starts as **Pending** until the owner approves them in Settings → Team.

---

## Step 0. Try it on your computer (2 minutes, no accounts)

```bash
npm install
npm run dev
```

Open the address it prints. With no `.env` file the app runs in **demo mode**: data is stored only in your browser, and there is no login. Good for looking around; not shared with anyone.

---

## Step 1. Supabase (database + login)

1. Go to <https://supabase.com> → **New project**. Pick a region close to Jakarta (Singapore). Save the database password somewhere safe (you will not need it for the app).
2. **SQL Editor → New query**, paste the whole file `supabase/migrations/0001_init.sql`, press **Run**. You should see "Success". (It is safe to run twice.)
3. **Authentication → Sign In / Providers → Email**: keep Email enabled and keep **"Allow new users to sign up" ON** (needed for the Create account form). "Confirm email" is your choice: on = people must click an email link first (Supabase's built-in sender is rate-limited to a few emails per hour), off = instant sign-up. **Sign up yourself first**: the first account becomes the Owner.
4. **Authentication → URL Configuration**: set **Site URL** to your final Cloudflare address (you get it in step 3; you can come back and fill it in then). Add the same address, and `http://localhost:5173`, under **Redirect URLs**. Invite and reset-password emails return people to this address.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key. You need them in step 3. (Never use the `service_role` key anywhere in this project.)
6. **Create the owner account**: **Authentication → Users → Add user → Create new user**. Enter your email and a password and tick **Auto Confirm User**. Because you are the first account, you become the Owner.

> Supabase's built-in email sender is rate-limited (a few emails per hour). That is fine for a small team. If you invite many people at once, add a custom SMTP provider under Authentication → SMTP.

## Step 2. GitHub (code)

```bash
git init
git add .
git commit -m "Jastip China Desk"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/jastip-china-desk.git
git push -u origin main
```

Create the (private is fine) repository on github.com first. Run `npm install` once before committing so `package-lock.json` is created, and commit that file too. `.env` files are ignored by git, on purpose.

The workflow in `.github/workflows/ci.yml` runs the tests and a build on every push.

## Step 3. Cloudflare Pages (hosting)

### Option A: connect the GitHub repo (simplest, recommended)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** and choose the repository.
2. Build settings:
   - Framework preset: **Vite** (or None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable `NODE_VERSION` = `22`
3. **Settings → Variables and Secrets** (Production), add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Save and deploy. Every push to `main` redeploys.
5. Copy your `https://….pages.dev` address into Supabase (step 1.4).

### Option B: deploy from GitHub Actions

Use this instead if you prefer deploys controlled by GitHub. In the repo: **Settings → Secrets and variables → Actions**.

- Secrets: `CLOUDFLARE_API_TOKEN` (permission: Cloudflare Pages → Edit), `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Variable: `CF_PAGES_PROJECT` = the Pages project name (create it once with `npx wrangler pages project create jastip-china-desk`)

The deploy workflow stays dormant until `CF_PAGES_PROJECT` exists. Do not use A and B at the same time.

### Custom domain (optional)

Pages project → **Custom domains**. Then update the Site URL and Redirect URLs in Supabase.

---

## Go-live checklist (V.1.0)

Do these in order. Tick each before you share the link.

1. **Build once on your computer:** `npm install && npm run build` (should end without errors), then commit the `package-lock.json` it creates.
2. **Supabase:** `0001_init.sql` ran without errors (SQL Editor). Authentication → Email: sign-ups ON (or OFF if you want invite-only), Site URL and Redirect URLs set to your Cloudflare address.
3. **Cloudflare Pages variables** (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Leave `VITE_DEMO` and `VITE_PUBLIC_MODE` unset or `false`. If a variable is missing the build now fails with a clear message instead of publishing a broken site.
4. **Deploy**, open the live link, and **sign up first** so you become the Owner.
5. **Check:** Settings → Team shows you as Owner; add a test order; open the link in a private window, sign up a second account and confirm it sees nothing until you approve it.
6. **Then invite your team** and share the link.
7. **Backups:** Supabase free has none, so export the tables from the Table Editor now and then. Free projects pause after a week with no activity, so open the site at least weekly.
8. **Optional later:** custom domain (Cloudflare Pages → Custom domains; add it to Supabase Redirect URLs too) and Google sign-in.

## First login checklist

1. Open the site, sign in with the owner email and password from step 1.6. Your role chip should say **Owner**.
2. **Settings**: set kurs, ongkir rates and the team names.
3. Invite your team: Supabase → **Authentication → Users → Invite user**. They get an email, click the link, choose a password and land in the desk as **Editor**.
4. To make someone read-only, or to approve someone who shows as "Waiting for approval", use **Settings → Team**.
5. Test with a second browser or phone: change something in one, watch it appear in the other.

If the page says "Database not set up", step 1.2 was not run. If it says "Not configured yet", the two `VITE_` variables are missing in Cloudflare (add them, then redeploy: Vite reads them at build time).

## A separate sandbox (optional)

To practise without touching real data, create a second Supabase project and a second Cloudflare Pages project (same repo), with `VITE_ENV_LABEL=Sandbox`. A "Sandbox" chip then appears next to the title. For a no-account sandbox, set `VITE_DEMO=true` and leave the Supabase variables out: data then lives only in each visitor's browser.

## Google sign-in (already built, switched off until you enable it)

The code is ready: the sign-in and sign-up screens both show a Google button as soon as you flip one setting. Google sign-in and Google sign-up are the same thing (a new Google email creates the account automatically).

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: set it up once (External, app name, your email).
2. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add the callback shown in Supabase under **Authentication → Sign In / Providers → Google** (it looks like `https://YOUR-REF.supabase.co/auth/v1/callback`). Copy the Client ID and Client secret.
3. Paste both into that Supabase page and switch the Google provider on.
4. Supabase → **Authentication → URL Configuration**: Site URL and Redirect URLs must include your Cloudflare address (same as step 4 of the setup).
5. Cloudflare Pages → Variables → `VITE_ENABLE_GOOGLE` = `true`, then redeploy.

Who gets in with Google:

- The first account ever created is the Owner, whether by email or Google.
- Anyone after that starts as **Pending** and sees no data until the owner approves them in Settings → Team. Their Google name and photo are used automatically.
- With **"Allow new users to sign up" off** in Supabase, only emails that already have an account can use Google.
- If someone signs up by email and later uses Google with the same email, Supabase links them to the same account.

## Day-to-day notes

- **Backups:** Supabase free projects have no automatic backups. In **Database → Backups** you can use a paid plan, or periodically run `pg_dump` / export the tables from the Table Editor. Also note: free projects pause after a week of inactivity.
- **Security:** the anon key in the browser is public by design. What protects the data is row-level security in `0001_init.sql`: logged-out visitors, pending people and viewers cannot write; roles can only be changed through the owner-only function `set_member_role`.
- **Changing the database later:** add a new file `supabase/migrations/0004_….sql` and run it in the SQL Editor. Do not edit the existing files.
- **Tests:** `npm test` (calculations, parsing, the Supabase adapter, auth helpers) and `npm run test:rls` (runs the SQL against a throwaway local PostgreSQL and checks every role).

## Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon public key |
| `VITE_APP_NAME` | no | Title (default "Jastip China Desk") |
| `VITE_ENV_LABEL` | no | Chip next to the title, e.g. `Sandbox` |
| `VITE_ENABLE_GOOGLE` | no | `true` shows the Google button |
| `VITE_DEMO` | no | `true` = local browser-only data, no login |

---

## Public mode (no login, no owner account)

Anyone with your site link can view **and edit or delete** everything. There is no Team panel, no Log out and no per-person history names (all changes show as "Team"). Only use a link you share with people you trust.

1. Do README steps 1-3 as usual (Supabase project, run `supabase/migrations/0001_init.sql`, GitHub, Cloudflare Pages). You can skip creating any user in Supabase → Authentication.
2. Supabase → SQL Editor → New query → paste `supabase/migrations/0002_public_mode.sql` → Run.
3. Cloudflare Pages → your project → Settings → Variables and Secrets → add `VITE_PUBLIC_MODE` = `true` (next to `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
4. Deployments → Retry deployment (or push any commit). Variables only take effect on a new build.
5. Open the site: it goes straight to the desk. To check it works, add an item, then open the same link in a private window and confirm it appears.

Back to private: set `VITE_PUBLIC_MODE` to `false`, redeploy, and run `supabase/migrations/0003_private_mode.sql`.


## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Cloudflare: `Could not read package.json` | The project files are not at the top level of the GitHub repo. Move them there (not inside a subfolder). |
| Build: `Missing VITE_SUPABASE_URL` or `…ANON_KEY` | Variable missing, misspelled, or not under **Production**. Names must match exactly, in capitals. Then commit a small change to trigger a new build. |
| Site shows **Invalid API key** on sign-in, sign-up or reset | The key built into the site is wrong or old. Re-copy the **Publishable key** from the same Supabase project as the URL, paste it again, trigger a new build, and test in a private window. A paused Supabase project can also cause this (click Restore). |
| Sign-up says sign-ups are switched off | Supabase → Authentication → Email → turn **Allow new users to sign up** ON. |
| Sign-up works but no email arrives | Confirm email is on and Supabase's built-in mailer is rate-limited. Turn Confirm email off for now, or set up your own SMTP later. |
| New account sees "waiting for approval" | Expected. The owner approves it in Settings → Team. If *you* are stuck here, someone else signed up first: in Supabase SQL Editor run `update public.profiles set role = 'owner' where email = 'you@example.com';` (use your own email; the roles are pending, viewer, editor, owner). |
| GitHub Actions test fails | The tests are in `tests/`. They do not affect the Cloudflare deploy. |
| Changes in Cloudflare variables have no effect | They only apply to a **new** build. Commit something to trigger one. |
