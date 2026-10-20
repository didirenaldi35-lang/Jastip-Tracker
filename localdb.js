import { initialsAvatar } from "./avatar.js";
// Local demo database (browser localStorage). Same interface as lib/db.js.
// Used by `npm run dev` and by demo builds (VITE_DEMO=true). NOT shared between
// people or devices: it only exists to try the app without a Supabase project.

const TABLES = ["items", "shipments", "batches", "config"];
const KEY = t => "jcd.demo." + t;

export function createLocalDb() {
  const read = t => { try { return JSON.parse(localStorage.getItem(KEY(t)) || "{}"); } catch (e) { return {}; } };
  const write = (t, o) => { try { localStorage.setItem(KEY(t), JSON.stringify(o)); } catch (e) { /* storage full or blocked */ } };
  const subs = Object.fromEntries(TABLES.map(t => [t, new Set()]));
  const emitTo = (t, set) => { const o = read(t); for (const l of set) l.cb(l.doc ? { exists: l.doc in o, id: l.doc, data: () => (l.doc in o ? { ...o[l.doc] } : undefined) } : { docs: Object.entries(o).map(([id, d]) => ({ id, data: () => ({ ...d }) })) }); };
  const emit = t => emitTo(t, subs[t]);
  window.addEventListener("storage", e => { const t = TABLES.find(x => KEY(x) === e.key); if (t) emit(t); });
  const listen = (t, l) => { subs[t].add(l); queueMicrotask(() => { if (subs[t].has(l)) emitTo(t, [l]); }); return () => subs[t].delete(l); };
  const split = p => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };
  return {
    onStatus(cb) { cb("live"); return () => {}; },
    collection(t) { return { limit: () => ({ onSnapshot: (cb, err) => listen(t, { cb, err }) }) }; },
    doc(path) {
      const [t, id] = split(path);
      return {
        onSnapshot: (cb, err) => listen(t, { cb, err, doc: id }),
        async set(data) { const o = read(t); o[id] = JSON.parse(JSON.stringify(data)); write(t, o); emit(t); },
        async delete() { const o = read(t); delete o[id]; write(t, o); emit(t); },
      };
    },
  };
}

export function createDemoUser() {
  return {
    me: { id: "demo-user", name: "Demo owner", email: "demo@local", avatarUrl: initialsAvatar("Demo owner") },
    role: "owner",
    canEdit: true,
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: i === "demo-user" ? "Demo owner" : "someone" }])),
    listMembers: async () => [{ id: "demo-user", name: "Demo owner", email: "demo@local", role: "owner" }],
    setMemberRole: async () => {},
  };
}
