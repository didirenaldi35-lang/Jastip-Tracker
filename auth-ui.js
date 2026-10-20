// Sign-in screens. Plain DOM, rendered into #auth. Shown before the app starts.
import { esc } from "./lib/format.js";

const root = () => document.getElementById("auth");

function frame(appName, envLabel, sub, inner) {
  document.body.classList.add("authing");
  root().innerHTML = `<div class="authwrap"><div class="authbox">
    <div class="brand"><div class="chop" aria-hidden="true">JS</div><div><h1 style="font-size:20px">${esc(appName)}${envLabel ? ` <span class="chip warn" style="vertical-align:3px;font-family:var(--sans)">${esc(envLabel)}</span>` : ""}</h1><div class="sub">${esc(sub)}</div></div></div>
    ${inner}
  </div></div>`;
  return root();
}
const msg = () => `<p class="authmsg" id="authmsg" role="alert" hidden></p>`;
function setMsg(text, ok) {
  const m = document.getElementById("authmsg"); if (!m) return;
  m.textContent = text || ""; m.hidden = !text; m.className = "authmsg" + (ok ? " ok" : "");
}
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = on ? "Please wait…" : label; }

/** Email + password sign in. handlers: { onSignIn(email,pw), onGoogle?, onForgot() } */
export function showLogin(o, h) {
  const r = frame(o.appName, o.envLabel, "Sign in to your desk", `
    <form id="loginform" class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="a-email">Email</label><input class="in" id="a-email" type="email" autocomplete="username" inputmode="email" required autofocus></div>
      <div class="field"><label for="a-pw">Password</label><input class="in" id="a-pw" type="password" autocomplete="current-password" required></div>
      ${msg()}
      <button class="btn primary" type="submit" style="justify-content:center">Sign in</button>
      ${o.enableGoogle ? `<div class="author"><span>or</span></div><button class="btn" type="button" id="a-google" style="justify-content:center">Continue with Google</button>` : ""}
      <button class="btn ghost" type="button" id="a-forgot" style="justify-content:center">Forgot password?</button>
    </form>
    <p class="muted small" style="margin:0">New here? <button type="button" class="btn ghost" id="a-signup" style="padding:2px 6px;min-height:0">Create an account</button></p>`);
  if (o.notice) setMsg(o.notice, o.noticeOk);
  r.querySelector("#loginform").addEventListener("submit", async e => {
    e.preventDefault(); const b = e.target.querySelector("button[type=submit]"); busy(b, true, "Sign in"); setMsg("");
    try { await h.onSignIn(r.querySelector("#a-email").value, r.querySelector("#a-pw").value); }
    catch (err) { setMsg(err.message); busy(b, false, "Sign in"); }
  });
  r.querySelector("#a-forgot").addEventListener("click", () => h.onForgot(r.querySelector("#a-email").value));
  r.querySelector("#a-signup").addEventListener("click", () => h.onSignupLink(r.querySelector("#a-email").value));
  const g = r.querySelector("#a-google");
  if (g) g.addEventListener("click", async () => { try { await h.onGoogle(); } catch (err) { setMsg(err.message); } });
}

/** Self sign-up. h.onSignUp(name,email,pw) -> { confirm: boolean }, h.onBack() */
export function showSignup(o, h, email = "") {
  const r = frame(o.appName, o.envLabel, "Create your account", `
    <form id="sform" class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="a-name">Your name</label><input class="in" id="a-name" type="text" autocomplete="name" maxlength="80" required autofocus></div>
      <div class="field"><label for="a-email">Email</label><input class="in" id="a-email" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></div>
      <div class="field"><label for="a-p1">Password</label><input class="in" id="a-p1" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
      <div class="field"><label for="a-p2">Repeat password</label><input class="in" id="a-p2" type="password" autocomplete="new-password" minlength="8" required></div>
      ${msg()}
      <button class="btn primary" type="submit" style="justify-content:center">Sign up</button>
      ${o.enableGoogle ? `<div class="author"><span>or</span></div><button class="btn" type="button" id="a-google" style="justify-content:center">Sign up with Google</button>` : ""}
      <button class="btn ghost" type="button" id="a-back" style="justify-content:center">I already have an account</button>
    </form>`);
  r.querySelector("#a-back").addEventListener("click", h.onBack);
  const g = r.querySelector("#a-google");
  if (g) g.addEventListener("click", async () => { try { await h.onGoogle(); } catch (err) { setMsg(err.message); } });
  r.querySelector("#sform").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = r.querySelector("#a-p1").value, p2 = r.querySelector("#a-p2").value;
    if (p1.length < 8) return setMsg("Use at least 8 characters.");
    if (p1 !== p2) return setMsg("The two passwords don't match.");
    const b = e.target.querySelector("button[type=submit]"); busy(b, true, "Sign up"); setMsg("");
    try {
      const out = await h.onSignUp(r.querySelector("#a-name").value, r.querySelector("#a-email").value, p1);
      if (out && out.confirm) { setMsg("Account created. Check your email and click the confirmation link, then sign in.", true); }
    } catch (err) { setMsg(err.message); }
    busy(b, false, "Sign up");
  });
}

export function showForgot(o, h, email = "") {
  const r = frame(o.appName, o.envLabel, "Reset your password", `
    <form id="fform" class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="a-email">Email</label><input class="in" id="a-email" type="email" autocomplete="username" required value="${esc(email)}"></div>
      ${msg()}
      <button class="btn primary" type="submit" style="justify-content:center">Send reset link</button>
      <button class="btn ghost" type="button" id="a-back" style="justify-content:center">Back to sign in</button>
    </form>`);
  r.querySelector("#a-back").addEventListener("click", h.onBack);
  r.querySelector("#fform").addEventListener("submit", async e => {
    e.preventDefault(); const b = e.target.querySelector("button[type=submit]"); busy(b, true, "Send reset link"); setMsg("");
    try { await h.onSend(r.querySelector("#a-email").value); setMsg("If that email has an account, a reset link is on its way.", true); }
    catch (err) { setMsg(err.message); }
    busy(b, false, "Send reset link");
  });
}

/** Shown after an invite or password-reset link. h.onSet(password) */
export function showSetPassword(o, h, kind) {
  const r = frame(o.appName, o.envLabel, kind === "invite" ? "Welcome! Choose a password" : "Choose a new password", `
    <form id="pform" class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="a-p1">New password</label><input class="in" id="a-p1" type="password" autocomplete="new-password" minlength="8" required autofocus><span class="hint">At least 8 characters.</span></div>
      <div class="field"><label for="a-p2">Repeat password</label><input class="in" id="a-p2" type="password" autocomplete="new-password" minlength="8" required></div>
      ${msg()}
      <button class="btn primary" type="submit" style="justify-content:center">Save password &amp; continue</button>
    </form>`);
  r.querySelector("#pform").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = r.querySelector("#a-p1").value, p2 = r.querySelector("#a-p2").value;
    if (p1.length < 8) return setMsg("Use at least 8 characters.");
    if (p1 !== p2) return setMsg("The two passwords don't match.");
    const b = e.target.querySelector("button[type=submit]"); busy(b, true, "Save password & continue"); setMsg("");
    try { await h.onSet(p1); } catch (err) { setMsg(err.message); busy(b, false, "Save password & continue"); }
  });
}

export function showPending(o, h, email) {
  const r = frame(o.appName, o.envLabel, "Waiting for approval", `
    <p style="margin:0">You're signed in as <b>${esc(email || "")}</b>, but the owner hasn't given you access yet.</p>
    <p class="muted small" style="margin:0">Ask the owner to open <b>Settings → Team</b> and set you as Editor or Viewer, then check again.</p>
    ${msg()}
    <button class="btn primary" id="a-check" style="justify-content:center">Check again</button>
    <button class="btn ghost" id="a-out" style="justify-content:center">Sign out</button>`);
  r.querySelector("#a-check").addEventListener("click", h.onCheck);
  r.querySelector("#a-out").addEventListener("click", h.onSignOut);
}

export function showProblem(o, title, body, h = {}) {
  const r = frame(o.appName, o.envLabel, title, `<div class="authprob">${body}</div>
    ${h.onRetry ? `<button class="btn primary" id="a-retry" style="justify-content:center">Try again</button>` : ""}
    ${h.onSignOut ? `<button class="btn ghost" id="a-out" style="justify-content:center">Sign out</button>` : ""}`);
  if (h.onRetry) r.querySelector("#a-retry").addEventListener("click", h.onRetry);
  if (h.onSignOut) r.querySelector("#a-out").addEventListener("click", h.onSignOut);
}

export function hideAuth() { document.body.classList.remove("authing"); root().innerHTML = ""; }
