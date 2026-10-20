import test from "node:test";
import assert from "node:assert/strict";
import { createDb, mapError } from "../src/lib/db.js";

// A tiny in-memory stand-in for supabase-js: same from()/channel() surface.
function fakeSupabase({ failWrite = null, deleteReturnsNothing = false } = {}) {
  let rev = 0;
  const tables = { items: new Map(), shipments: new Map(), batches: new Map(), config: new Map() };
  const handlers = []; let statusCb = null;
  const emit = (table, ev) => handlers.filter(h => h.table === table).forEach(h => h.cb(ev));
  const stats = { selects: 0 };
  const client = {
    tables, stats,
    from(t) {
      return {
        select: () => { const o = {}; let r = [];
          o.order = () => o; o.range = (a, b) => { stats.selects++; const all = [...tables[t].entries()].map(([id, v]) => ({ id, ...v })).sort((x, y) => (x.id < y.id ? -1 : 1)); return Promise.resolve({ data: all.slice(a, b + 1), error: null }); };
          return o; },
        upsert: (row) => ({ select: () => ({ single: async () => {
          if (failWrite) return { data: null, error: failWrite };
          const v = { data: row.data, rev: ++rev }; const had = tables[t].has(row.id); tables[t].set(row.id, v);
          emit(t, { eventType: had ? "UPDATE" : "INSERT", new: { id: row.id, ...v } });
          return { data: { id: row.id, rev: v.rev }, error: null }; } }) }),
        delete: () => ({ eq: (_, id) => ({ select: async () => { if (failWrite) return { data: null, error: failWrite }; if (deleteReturnsNothing) return { data: [], error: null }; const had = tables[t].delete(id); if (had) emit(t, { eventType: "DELETE", old: { id } }); return { data: had ? [{ id }] : [], error: null }; } }) }),
      };
    },
    channel() { const ch = { on(_, f, cb) { handlers.push({ table: f.table, cb }); return ch; }, subscribe(cb) { statusCb = cb; queueMicrotask(() => cb("SUBSCRIBED")); return ch; } }; return ch; },
    removeChannel() {},
    remote(t, id, data) { const v = { data, rev: ++rev }; const had = tables[t].has(id); tables[t].set(id, v); emit(t, { eventType: had ? "UPDATE" : "INSERT", new: { id, ...v } }); },
    raw(t, id, data, r) { emit(t, { eventType: "UPDATE", new: { id, data, rev: r } }); },
    remoteDelete(t, id) { tables[t].delete(id); emit(t, { eventType: "DELETE", old: { id } }); },
    drop() { statusCb && statusCb("CLOSED"); },
    up() { statusCb && statusCb("SUBSCRIBED"); },
  };
  return client;
}
const tick = () => new Promise(r => setTimeout(r, 5));

test("initial snapshot lists rows; realtime changes arrive", async () => {
  const sb = fakeSupabase(); sb.tables.items.set("a", { data: { name: "A" }, rev: 1 });
  const db = createDb(sb); const seen = [];
  db.collection("items").limit(100).onSnapshot(s => seen.push(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  await tick();
  assert.deepEqual(seen.at(-1), [{ id: "a", name: "A" }]);
  sb.remote("items", "b", { name: "B" }); await tick();
  assert.deepEqual(seen.at(-1).map(x => x.id).sort(), ["a", "b"]);
  sb.remote("items", "a", { name: "A2" }); await tick();
  assert.equal(seen.at(-1).find(x => x.id === "a").name, "A2");
  sb.remoteDelete("items", "b"); await tick();
  assert.deepEqual(seen.at(-1).map(x => x.id), ["a"]);
});
test("set() is optimistic and persists", async () => {
  const sb = fakeSupabase(); const db = createDb(sb); const seen = [];
  db.collection("items").limit(1).onSnapshot(s => seen.push(s.docs.length)); await tick();
  const p = db.doc("items/x").set({ name: "X" });
  assert.equal(seen.at(-1), 1, "visible before the server answers");
  await p;
  assert.equal(sb.tables.items.get("x").data.name, "X");
});
test("doc snapshot for config/main", async () => {
  const sb = fakeSupabase(); const db = createDb(sb); const seen = [];
  db.doc("config/main").onSnapshot(d => seen.push(d.exists ? d.data() : null)); await tick();
  assert.equal(seen.at(-1), null);
  await db.doc("config/main").set({ kursEveDidi: 2800 }); await tick();
  assert.deepEqual(seen.at(-1), { kursEveDidi: 2800 });
});
test("failed write rolls back and reports permission_denied", async () => {
  const sb = fakeSupabase({ failWrite: { code: "42501", message: "new row violates row-level security policy" } });
  sb.tables.items.set("a", { data: { name: "A" }, rev: 1 });
  const db = createDb(sb); const seen = [];
  db.collection("items").limit(1).onSnapshot(s => seen.push(s.docs.map(d => d.data().name))); await tick();
  await assert.rejects(db.doc("items/a").set({ name: "HACK" }), e => e.code === "permission_denied");
  await tick();
  assert.deepEqual(seen.at(-1), ["A"]);
  await assert.rejects(db.doc("items/new").set({ name: "N" }), e => e.code === "permission_denied");
  await tick();
  assert.deepEqual(seen.at(-1), ["A"]);
});
test("delete restores the row if the server refused it", async () => {
  const sb = fakeSupabase({ deleteReturnsNothing: true });
  sb.tables.items.set("a", { data: { name: "A" }, rev: 1 });
  const db = createDb(sb, { canWrite: () => false }); const seen = [];
  db.collection("items").limit(1).onSnapshot(s => seen.push(s.docs.length)); await tick();
  await assert.rejects(db.doc("items/a").delete(), e => e.code === "permission_denied");
  assert.equal(seen.at(-1), 1);
});
test("stale realtime events (older rev) are ignored", async () => {
  const sb = fakeSupabase(); const db = createDb(sb); const seen = [];
  db.collection("items").limit(1).onSnapshot(s => seen.push(s.docs.map(d => d.data().v))); await tick();
  await db.doc("items/a").set({ v: 2 }); await tick();
  const n = seen.length;
  sb.remote("items", "a", { v: 3 }); await tick();
  assert.equal(seen.at(-1)[0], 3);
  assert.ok(seen.length > n);
  const m = seen.length;
  sb.raw("items", "a", { v: 1 }, 1); await tick();   // an old event arriving late
  assert.equal(seen.at(-1)[0], 3);
  assert.equal(seen.length, m, "no re-render for a stale event");
});
test("status: live after subscribe, offline when the socket drops, refetch on reconnect", async () => {
  const sb = fakeSupabase(); const db = createDb(sb); const st = [];
  db.onStatus(s => st.push(s));
  db.collection("items").limit(1).onSnapshot(() => {}); await tick();
  assert.equal(st.at(-1), "live");
  sb.drop(); assert.equal(st.at(-1), "offline");
  sb.tables.items.set("missed", { data: { n: 1 }, rev: 99 });
  const seen = []; db.collection("items").limit(1).onSnapshot(s => seen.push(s.docs.map(d => d.id)));
  sb.up(); await tick(); await tick();
  assert.equal(st.at(-1), "live");
  assert.ok(seen.at(-1).includes("missed"), "rows written while offline appear after reconnect");
});
test("pages through more than 1000 rows", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 2300; i++) sb.tables.items.set("k" + String(i).padStart(5, "0"), { data: { i }, rev: 1 });
  const db = createDb(sb); let n = 0;
  db.collection("items").limit(5000).onSnapshot(s => { n = s.docs.length; }); await tick(); await tick();
  assert.equal(n, 2300);
});
test("mapError", () => {
  assert.equal(mapError({ code: "42501", message: "x" }).code, "permission_denied");
  assert.equal(mapError({ status: 401, message: "x" }).code, "permission_denied");
  assert.equal(mapError({ message: "Failed to fetch" }).code, "unavailable");
});
