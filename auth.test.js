import test from "node:test";
import assert from "node:assert/strict";
import { readUrlIntent, friendlyAuthError, createAuth } from "../src/lib/auth.js";

test("invite and recovery links ask for a new password", () => {
  assert.deepEqual(readUrlIntent("#access_token=x&type=invite").needsPassword, true);
  assert.equal(readUrlIntent("#access_token=x&type=recovery").needsPassword, true);
  assert.equal(readUrlIntent("#access_token=x&type=magiclink").needsPassword, false);
  assert.equal(readUrlIntent("").needsPassword, false);
});
test("expired links surface a message", () => {
  const i = readUrlIntent("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.match(i.error, /expired/);
  assert.equal(i.errorCode, "otp_expired");
});
test("friendly errors", () => {
  assert.equal(friendlyAuthError(new Error("Invalid login credentials")), "Wrong email or password.");
  assert.match(friendlyAuthError(new Error("Signups not allowed for this instance")), /Sign-ups are switched off/);
  assert.match(friendlyAuthError(new Error("Email rate limit exceeded")), /Too many/);
});

function fakeClient({ profile, members = [] } = {}) {
  const calls = [];
  const q = (table) => {
    const b = { select: () => b, eq: () => b, in: () => b, order: () => Promise.resolve({ data: members, error: null }), maybeSingle: () => Promise.resolve({ data: profile, error: null }) };
    b.then = undefined;
    return b;
  };
  return {
    calls,
    from: q,
    rpc: async (fn, args) => { calls.push([fn, args]); return { error: null }; },
    auth: { updateUser: async (a) => { calls.push(["updateUser", a]); return { error: null }; } },
  };
}

test("buildUser: owner gets team tools, editor/viewer do not", async () => {
  const mk = role => createAuth(fakeClient()).buildUser({ id: "u1", email: "a@b.c", name: "", avatar_url: "", role });
  const owner = mk("owner"), editor = mk("editor"), viewer = mk("viewer");
  assert.equal(owner.canEdit, true); assert.equal(typeof owner.setMemberRole, "function");
  assert.equal(editor.canEdit, true); assert.equal(editor.setMemberRole, undefined);
  assert.equal(viewer.canEdit, false); assert.equal(viewer.listMembers, undefined);
  assert.equal(owner.me.name, "a");
  assert.match(owner.me.avatarUrl, /^data:image\/svg/);
});
test("owner role change goes through the RPC", async () => {
  const cl = fakeClient();
  const u = createAuth(cl).buildUser({ id: "u1", email: "a@b.c", name: "A", role: "owner" });
  await u.setMemberRole("u2", "editor");
  assert.deepEqual(cl.calls[0], ["set_member_role", { target: "u2", new_role: "editor" }]);
  await u.changePassword("new-password-123");
  assert.deepEqual(cl.calls[1], ["updateUser", { password: "new-password-123" }]);
});
