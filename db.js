// Supabase-backed database adapter.
//
// The app talks to a tiny Firestore-like interface:
//   db.collection(name).limit(n).onSnapshot(cb, errCb)   -> unsubscribe
//   db.doc("items/abc").onSnapshot(cb, errCb)           -> unsubscribe
//   db.doc("items/abc").set(data) / .delete()            -> Promise
//   db.onStatus(cb)   cb("live" | "offline")
//
// Every table is { id text, data jsonb, rev bigint }. `rev` comes from a global
// sequence bumped by a database trigger, so "newer wins" is just rev comparison.

const TABLES = ["items", "shipments", "batches", "config"];
const PAGE = 1000;

export function mapError(err) {
  const status = err && err.status;
  const code = err && err.code;
  const msg = (err && err.message) || "";
  let out = "unknown";
  if (code === "42501" || status === 401 || status === 403 || /row-level security|permission denied/i.test(msg)) out = "permission_denied";
  else if (code === "PGRST301" || /jwt/i.test(msg)) out = "unauthenticated";
  else if (/Failed to fetch|NetworkError|network/i.test(msg)) out = "unavailable";
  else if (code === "54000" || code === "23514" || /check constraint|too large/i.test(msg)) out = "invalid_argument_size";
  const e = new Error(out === "permission_denied" ? "You don't have permission to change this." : msg || "Connection problem");
  e.code = out;
  return e;
}

/**
 * @param client       a supabase-js client (or anything with the same from()/channel() surface)
 * @param opts.canWrite () => boolean   used only to explain silently-blocked deletes
 */
export function createDb(client, opts = {}) {
  const cache = Object.fromEntries(TABLES.map(t => [t, new Map()])); // id -> { data, rev, pending }
  const subs = Object.fromEntries(TABLES.map(t => [t, new Set()]));  // listeners: { cb, err, limit }
  const loaded = Object.fromEntries(TABLES.map(t => [t, false]));
  const statusCbs = new Set();
  let status = "connecting", channel = null, started = false, fetching = {};

  const setStatus = s => { if (s === status) return; status = s; statusCbs.forEach(cb => { try { cb(s); } catch (e) { /* ignore */ } }); };
  const snapshotOf = t => ({ docs: [...cache[t].entries()].map(([id, v]) => ({ id, data: () => ({ ...v.data }) })) });
  const notify = t => {
    for (const l of subs[t]) {
      if (!loaded[t]) continue;
      try { l.cb(l.doc ? docSnap(t, l.doc) : snapshotOf(t)); } catch (e) { console.error(e); }
    }
  };
  const docSnap = (t, id) => { const v = cache[t].get(id); return { exists: !!v, id, data: () => (v ? { ...v.data } : undefined) }; };
  const fail = (t, e) => { const m = mapError(e); for (const l of subs[t]) if (l.err) l.err(m); return m; };

  async function fetchTable(t) {
    if (fetching[t]) { fetching[t].again = true; return fetching[t].p; }
    const job = { again: false };
    job.p = (async () => {
      try {
        const rows = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await client.from(t).select("id,data,rev").order("id").range(from, from + PAGE - 1);
          if (error) throw error;
          rows.push(...data);
          if (data.length < PAGE) break;
        }
        const seen = new Set();
        let changed = !loaded[t];
        for (const r of rows) {
          seen.add(r.id);
          const cur = cache[t].get(r.id);
          if (cur && (cur.pending || cur.rev >= r.rev)) continue;
          cache[t].set(r.id, { data: r.data, rev: r.rev, pending: 0 });
          changed = true;
        }
        for (const [id, v] of cache[t]) if (!seen.has(id) && !v.pending) { cache[t].delete(id); changed = true; }
        loaded[t] = true;
        if (changed) notify(t);
      } catch (e) { fail(t, e); }
    })();
    fetching[t] = job;
    await job.p;
    const again = job.again; delete fetching[t];
    if (again) return fetchTable(t);
  }

  function onChange(t, payload) {
    if (payload.eventType === "DELETE") {
      const id = payload.old && payload.old.id;
      const cur = id != null && cache[t].get(id);
      if (cur && !cur.pending) { cache[t].delete(id); notify(t); }
      return;
    }
    const row = payload.new; if (!row || row.id == null) return;
    const cur = cache[t].get(row.id);
    if (cur && cur.rev >= row.rev) return;
    cache[t].set(row.id, { data: row.data, rev: row.rev, pending: cur ? cur.pending : 0 });
    notify(t);
  }

  function start() {
    if (started) return; started = true;
    TABLES.forEach(t => fetchTable(t));
    channel = client.channel("desk");
    for (const t of TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table: t }, p => onChange(t, p));
    channel.subscribe(st => {
      if (st === "SUBSCRIBED") { setStatus("live"); TABLES.forEach(t => fetchTable(t)); }
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") setStatus("offline");
    });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") TABLES.forEach(t => fetchTable(t)); });
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => TABLES.forEach(t => fetchTable(t)));
      window.addEventListener("offline", () => setStatus("offline"));
    }
  }

  function listen(t, l) {
    start();
    subs[t].add(l);
    if (loaded[t]) queueMicrotask(() => { if (subs[t].has(l)) l.cb(l.doc ? docSnap(t, l.doc) : snapshotOf(t)); });
    return () => subs[t].delete(l);
  }

  const parse = path => {
    const i = path.indexOf("/"); const t = path.slice(0, i), id = path.slice(i + 1);
    if (!TABLES.includes(t) || !id) throw new Error("Bad path: " + path);
    return [t, id];
  };

  return {
    onStatus(cb) { statusCbs.add(cb); cb(status); return () => statusCbs.delete(cb); },
    collection(t) {
      if (!TABLES.includes(t)) throw new Error("Unknown collection " + t);
      return { limit: () => ({ onSnapshot: (cb, err) => listen(t, { cb, err }) }), onSnapshot: (cb, err) => listen(t, { cb, err }) };
    },
    doc(path) {
      const [t, id] = parse(path);
      return {
        onSnapshot: (cb, err) => listen(t, { cb, err, doc: id }),
        async set(data) {
          const prev = cache[t].get(id);
          cache[t].set(id, { data: { ...data }, rev: prev ? prev.rev : 0, pending: (prev ? prev.pending : 0) + 1 });
          notify(t);
          try {
            const { data: out, error } = await client.from(t).upsert({ id, data }, { onConflict: "id" }).select("id,rev").single();
            if (error) throw error;
            const cur = cache[t].get(id);
            if (cur) { cur.pending = Math.max(0, cur.pending - 1); if (out && out.rev > cur.rev) cur.rev = out.rev; }
          } catch (e) {
            const cur = cache[t].get(id); if (cur) cur.pending = Math.max(0, cur.pending - 1);
            if (prev) cache[t].set(id, { ...prev, pending: cur ? cur.pending : 0 }); else if (cur && !cur.pending) cache[t].delete(id);
            notify(t); fetchTable(t);
            throw mapError(e);
          }
        },
        async delete() {
          const prev = cache[t].get(id);
          if (prev) { cache[t].delete(id); notify(t); }
          try {
            const { data: gone, error } = await client.from(t).delete().eq("id", id).select("id");
            if (error) throw error;
            if (prev && (!gone || gone.length === 0) && opts.canWrite && !opts.canWrite()) { const e = new Error("blocked"); e.code = "42501"; throw e; }
          } catch (e) {
            if (prev) { cache[t].set(id, prev); notify(t); }
            fetchTable(t);
            throw mapError(e);
          }
        },
      };
    },
    close() { if (channel) client.removeChannel(channel); },
  };
}
