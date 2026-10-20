// Authentication + profile helpers on top of Supabase Auth.
// Email + password today. Google sign-in is wired (see signInWithGoogle) and only
// needs the provider switched on in Supabase + VITE_ENABLE_GOOGLE=true.
import { initialsAvatar } from "./avatar.js";

/** Reads what Supabase put in the URL after an invite / recovery / OAuth redirect. */
export function readUrlIntent(hash = (typeof location !== "undefined" ? location.hash : "")) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ""));
  const type = p.get("type");
  return {
    needsPassword: type === "invite" || type === "recovery",
    kind: type || "",
    error: p.get("error_description") || (p.get("error") ? "Sign-in failed." : ""),
    errorCode: p.get("error_code") || "",
  };
}

export function friendlyAuthError(err) {
  const m = String((err && err.message) || err || "");
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "This email isn't confirmed yet. Click the link in the confirmation email first.";
  if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
  if (/network|fetch/i.test(m)) return "Can't reach the server. Check your connection.";
  if (/signups? not allowed|not allowed for this instance/i.test(m)) return "Sign-ups are switched off in Supabase. Turn on \"Allow new users to sign up\" (README step 3).";
  if (/same password|different from the old/i.test(m)) return "Choose a password you haven't used before.";
  if (/already registered|already.*exists/i.test(m)) return "That email already has an account. Sign in instead.";
  if (/at least|weak|short/i.test(m)) return "That password is too short or too weak. Use at least 8 characters.";
  if (/otp_expired|expired|invalid.*(link|token)/i.test(m)) return "That link has expired. Ask the owner to send a new invite, or use “Forgot password”.";
  return m || "Something went wrong. Try again.";
}

export function createAuth(client, { redirectTo } = {}) {
  const redirect = redirectTo || (typeof location !== "undefined" ? location.origin + "/" : undefined);
  const nameCache = new Map();

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }
  async function loadProfile(session) {
    const uid = session.user.id;
    const { data, error } = await client.from("profiles").select("id,email,name,avatar_url,role").eq("id", uid).maybeSingle();
    if (error) throw error;
    // The profile row is created by a database trigger at sign-up; if it is
    // missing the SQL migration was not run on this project.
    if (!data) return { id: uid, email: session.user.email, name: "", avatar_url: "", role: "missing" };
    return data;
  }
  function buildUser(profile) {
    const name = profile.name || (profile.email || "").split("@")[0] || "You";
    const role = profile.role;
    const user = {
      me: { id: profile.id, name, email: profile.email || "", avatarUrl: profile.avatar_url || initialsAvatar(name) },
      role,
      canEdit: role === "owner" || role === "editor",
      async profiles(ids) {
        const need = ids.filter(i => !nameCache.has(i));
        if (need.length) {
          const { data } = await client.from("profiles").select("id,name,email").in("id", need);
          for (const r of data || []) nameCache.set(r.id, { name: r.name || (r.email || "").split("@")[0] });
        }
        return Object.fromEntries(ids.map(i => [i, nameCache.get(i)]));
      },
      async changePassword(pw) {
        const { error } = await client.auth.updateUser({ password: pw });
        if (error) throw new Error(friendlyAuthError(error));
      },
    };
    if (role === "owner") {
      user.listMembers = async () => {
        const { data, error } = await client.from("profiles").select("id,email,name,role,created_at").order("created_at");
        if (error) throw error;
        return data;
      };
      user.setMemberRole = async (id, newRole) => {
        const { error } = await client.rpc("set_member_role", { target: id, new_role: newRole });
        if (error) throw new Error(error.message || "Couldn't change access.");
      };
    }
    return user;
  }

  return {
    getSession, loadProfile, buildUser,
    onSignedOut(cb) { return client.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") cb(); }); },
    onPasswordRecovery(cb) { return client.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") cb(); }); },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(friendlyAuthError(error));
      return data.session;
    },
    /** Self sign-up. Resolves { confirm: true } when Supabase wants the email confirmed first. */
    async signUp(name, email, password) {
      const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { full_name: String(name || "").trim() }, emailRedirectTo: redirect } });
      if (error) throw new Error(friendlyAuthError(error));
      // Existing email: Supabase returns a user with no identities (no error, to avoid leaking accounts).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("That email already has an account. Sign in instead.");
      return { confirm: !data.session };
    },
    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect } });
      if (error) throw new Error(friendlyAuthError(error));
    },
    async sendReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
      if (error) throw new Error(friendlyAuthError(error));
    },
    async setPassword(pw) {
      const { error } = await client.auth.updateUser({ password: pw });
      if (error) throw new Error(friendlyAuthError(error));
    },
    async signOut() { try { await client.auth.signOut(); } catch (e) { /* still reload */ } },
  };
}
