import "@fontsource-variable/archivo"; // weight axis. For the narrower heading width, use "@fontsource-variable/archivo/wdth.css" instead.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

import { env } from "./lib/env.js";
import { readUrlIntent } from "./lib/auth.js";
import { startApp } from "./app.js";
import * as ui from "./auth-ui.js";

// Read the invite / recovery marker in the URL BEFORE supabase-js consumes it.
const intent = readUrlIntent();
const o = { appName: env.appName, envLabel: env.envLabel, enableGoogle: env.enableGoogle };
document.title = env.appName + (env.envLabel ? " · " + env.envLabel : "");
const h1 = document.querySelector(".brand h1"); if (h1) h1.textContent = env.appName;

async function boot() {
  if (env.demo && !env.supabaseConfigured) return bootDemo();
  if (!env.supabaseConfigured) {
    return ui.showProblem(o, "Not configured yet", `<p style="margin:0">This build has no Supabase connection. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in Cloudflare Pages (Settings → Variables), then redeploy.</p><p class="muted small" style="margin:8px 0 0">See README.md, step 3.</p>`);
  }
  if (env.publicMode) return bootPublic();
  const [{ getClient }, { createAuth }, { createDb }] = await Promise.all([import("./lib/supabase.js"), import("./lib/auth.js"), import("./lib/db.js")]);
  const client = getClient();
  const auth = createAuth(client);
  const signOut = async () => { await auth.signOut(); location.replace(location.pathname); };
  const reload = () => location.replace(location.pathname);

  if (intent.error) {
    history.replaceState(null, "", location.pathname);
    return loginScreen({ notice: /expired|invalid/i.test(intent.error + intent.errorCode) ? "That link has expired. Ask the owner to send a new invite, or use “Forgot password”." : intent.error });
  }

  let session;
  try { session = await auth.getSession(); }
  catch (e) { return ui.showProblem(o, "Can't reach the server", `<p style="margin:0">${"Check your connection and try again."}</p>`, { onRetry: reload }); }

  function loginScreen(extra = {}) {
    ui.showLogin({ ...o, ...extra }, {
      onSignIn: async (email, pw) => { await auth.signIn(email, pw); await proceed(); },
      onSignupLink: email => signupScreen(email),
      onGoogle: o.enableGoogle ? () => auth.signInWithGoogle() : null,
      onForgot: email => ui.showForgot(o, { onBack: () => loginScreen(), onSend: e => auth.sendReset(e) }, email),
    });
  }
  function signupScreen(email = "") {
    ui.showSignup(o, {
      onBack: () => loginScreen(),
      onGoogle: o.enableGoogle ? () => auth.signInWithGoogle() : null,
      onSignUp: async (name, em, pw) => { const out = await auth.signUp(name, em, pw); if (!out.confirm) await proceed(); return out; },
    }, email);
  }
  async function proceed() {
    const s = await auth.getSession();
    if (!s) return loginScreen();
    if (intent.needsPassword && !proceed.pwDone) {
      return ui.showSetPassword(o, { onSet: async pw => { await auth.setPassword(pw); proceed.pwDone = true; history.replaceState(null, "", location.pathname); await proceed(); } }, intent.kind);
    }
    let profile;
    try { profile = await auth.loadProfile(s); }
    catch (e) { return ui.showProblem(o, "Can't load your profile", `<p style="margin:0">${"Try again in a moment."}</p>`, { onRetry: () => proceed(), onSignOut: signOut }); }
    if (profile.role === "missing") {
      return ui.showProblem(o, "Database not set up", `<p style="margin:0">Your account exists, but the database tables were not found. Run <code>supabase/migrations/0001_init.sql</code> in the Supabase SQL Editor, then sign in again.</p>`, { onRetry: () => proceed(), onSignOut: signOut });
    }
    if (profile.role === "pending") return ui.showPending(o, { onCheck: () => proceed(), onSignOut: signOut }, profile.email);
    const user = auth.buildUser(profile);
    const db = createDb(client, { canWrite: () => user.canEdit });
    auth.onSignedOut(reload);
    ui.hideAuth();
    startApp({ db, user, signOut, env: { label: env.envLabel } });
  }

  if (!session) return loginScreen();
  await proceed();
}

async function bootPublic() {
  const [{ getClient }, { createDb }, { initialsAvatar }] = await Promise.all([import("./lib/supabase.js"), import("./lib/db.js"), import("./lib/avatar.js")]);
  const db = createDb(getClient(), { canWrite: () => true });
  const user = {
    me: { id: "public", name: "Team", email: "", avatarUrl: initialsAvatar("Team") },
    role: "editor", canEdit: true, public: true,
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: "Team" }])),
  };
  ui.hideAuth();
  startApp({ db, user, signOut: async () => {}, env: { label: env.envLabel } });
}

async function bootDemo() {
  const { createLocalDb, createDemoUser } = await import("./lib/localdb.js");
  ui.hideAuth();
  startApp({ db: createLocalDb(), user: createDemoUser(), signOut: async () => { location.reload(); }, env: { label: env.envLabel || "Demo" } });
}

boot().catch(e => { console.error(e); ui.showProblem(o, "Something went wrong", `<p style="margin:0">${String(e && e.message || e).replace(/[<>&]/g, "")}</p>`, { onRetry: () => location.reload() }); });
