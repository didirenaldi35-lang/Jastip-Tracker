import { STAGES, STAGE, SHIP_STAGES, METHODS, ROUTES, DECISIONS, SAMPLE, HASSLE, HASSLE_X, TABS, TAB_GROUPS, TAB_HINT, DEFAULT_RATES } from "./lib/constants.js";
import { esc, nf0, nf2, num, numOrNull, numId, numIdOrNull, idrIn, safeUrl, idr, idrC, cny, qtyf, nowISO, fmtDate, fmtDT, monthLabel, todayStr, daysUntil, uid } from "./lib/format.js";
import { buildCfg, lineKgVol, shipQuote, itemShip as calcItemShip, goodsCNY, deriveData } from "./lib/calc.js";

/**
 * Starts the desk.
 * ctx = { db, user, signOut, env }
 *  db      Firestore-like adapter (see lib/db.js / lib/localdb.js)
 *  user    { me:{id,name,email,avatarUrl}, role:"owner|editor|viewer", canEdit, profiles(ids), changePassword(pw), listMembers(), setMemberRole(id, role) }
 *  signOut () => Promise
 *  env     { label?: string }
 */
export function startApp(ctx) {
"use strict";
const cfg = () => buildCfg(S.config);
const derive = (items = S.items) => deriveData(items, S.shipments, S.batches, cfg());
const itemShip = (it, c = cfg()) => calcItemShip(it, c);
const $ = (s, r = document) => r.querySelector(s);

// ---------- state ----------
const S = {
  db: null, live: false, failed: false, offline: false, readOnly: false, members: null,
  config: null, batches: [], shipments: [], items: [],
  loaded: { items: false, shipments: false, batches: false, config: false },
  tab: "overview",
  f: { batch: "all", client: "all", q: "", flag: "all", stage: "all", showPaid: false, rstatus: "open", shipView: "active", rverdict: "all", rsample: "all", rclient: "all", rpic: "all", rhassle: "all", rsortkey: "seq", rdir: "asc" },
  sel: new Set(),
  drawer: null,
};
try { const t = localStorage.getItem("jcd.tab"); if (t && TABS.some(x => x[0] === t)) S.tab = t; } catch (e) {}
if (location.hash && TABS.some(x => x[0] === location.hash.slice(1))) S.tab = location.hash.slice(1);


const stageChip = id => { const s = STAGE[id] || STAGE.to_buy; return `<span class="chip stage" style="--dot:var(${s.dot})">${esc(s.label)}</span>`; };
const ARRIVED = ["jakarta", "delivering", "delivered", "paid"];
const itemEta = (it, shipById) => it.etaJkt || (it.shipmentId && shipById && shipById[it.shipmentId] ? shipById[it.shipmentId].eta || "" : "");
const etaText = ds => { const n = daysUntil(ds); if (n == null) return ""; return n > 1 ? `${n} hari lagi` : n === 1 ? "besok" : n === 0 ? "hari ini" : `telat ${-n} hari`; };
function etaChip(it, shipById) {
  const ds = itemEta(it, shipById); if (!ds) return "";
  if (ARRIVED.includes(it.stage)) return `<span class="chip">ETA ${esc(fmtDate(ds))}</span>`;
  const n = daysUntil(ds);
  return `<span class="chip ${n < 0 ? "bad" : n <= 3 ? "warn" : "acc"}">ETA JKT ${esc(fmtDate(ds))} · ${etaText(ds)}</span>`;
}

function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 5200 : 2200);
}



function sortedBatches() {
  return [...S.batches].sort((a, b) => (b.month || "").localeCompare(a.month || "") || (b.name || "").localeCompare(a.name || ""));
}
function clientNames() {
  const set = new Set((cfg().clients || []).map(c => c.name));
  for (const it of S.items) if (it.client) set.add(it.client);
  return [...set].sort();
}
function filteredItems(opts = {}) {
  const f = S.f, q = f.q.trim().toLowerCase();
  const D = opts.D;
  return S.items.filter(it => {
    if (f.batch !== "all" && it.batch !== f.batch) return false;
    if (f.client !== "all" && it.client !== f.client) return false;
    if (opts.stage !== false && f.stage !== "all" && it.stage !== f.stage) return false;
    if (opts.flags !== false && f.flag !== "all") {
      if (f.flag === "review" && !it.review) return false;
      if (f.flag === "unpaid" && (it.paid || (D && D.X.get(it.id)?.isInt))) return false;
      if (f.flag === "noprice" && it.priceCNY) return false;
      if (f.flag === "nosell" && (it.sellIDR != null || (D && D.X.get(it.id)?.isInt))) return false;
      if (f.flag === "late" && !(D && !ARRIVED.includes(it.stage) && daysUntil(itemEta(it, D.shipById)) < 0)) return false;
      if (f.flag === "soon" && !(D && !ARRIVED.includes(it.stage) && (x => x != null && x >= 0 && x <= 3)(daysUntil(itemEta(it, D.shipById))))) return false;
      if (f.flag === "noship" && (!D || D.X.get(it.id)?.alloc > 0)) return false;
    }
    if (q) {
      const hay = [it.name, it.variant, it.client, it.shop, it.holder, it.notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

// ---------- db ----------
const queues = {};
function clean(o) { const c = { ...o }; delete c.id; for (const k in c) if (c[k] === undefined) delete c[k]; return c; }
function write(path, data) {
  if (S.readOnly) { toast("View only: ask the owner to make you an editor.", true); return Promise.resolve(false); }
  if (!S.db) { toast("Live data isn't connected in this view, so changes can't be saved.", true); return Promise.resolve(false); }
  const prev = queues[path] || Promise.resolve();
  const p = prev.then(() => S.db.doc(path).set(clean(data))).then(() => true).catch(e => { handleErr(e); return false; });
  queues[path] = p; return p;
}
function remove(path) {
  if (S.readOnly) { toast("View only: ask the owner to make you an editor.", true); return Promise.resolve(false); }
  if (!S.db) return Promise.resolve(false);
  const prev = queues[path] || Promise.resolve();
  const p = prev.then(() => S.db.doc(path).delete()).then(() => true).catch(e => { handleErr(e); return false; });
  queues[path] = p; return p;
}
function handleErr(e) {
  const code = e && e.code;
  if (code === "permission_denied" || code === "invalid_argument") { S.readOnly = true; schedule(); toast("You can view this desk but not edit it. Ask the owner to make you an editor.", true); }
  else if (code === "quota_exceeded") toast("The database is full. Delete old items, then try again.", true);
  else if (code === "resource_exhausted") toast("Too many changes at once. Wait a few seconds and try again.", true);
  else toast("Couldn't save: " + (e && e.message || "connection problem") + ". Try again.", true);
}
async function writeMany(list) { // list of [path, data]
  let ok = 0;
  for (let i = 0; i < list.length; i += 8) {
    const res = await Promise.all(list.slice(i, i + 8).map(([p, d]) => write(p, d)));
    ok += res.filter(Boolean).length;
  }
  return ok;
}
function pushHistory(it, stage, note, holder) {
  const h = Array.isArray(it.history) ? it.history.slice(-29) : [];
  h.push({ stage, at: nowISO(), note: note || "", holder: holder || "", by: myId() });
  return h;
}

async function connect() {
  const db = ctx.db;
  if (!db) { S.failed = true; render(); return; }
  S.db = db; S.live = true;
  if (db.onStatus) db.onStatus(st => { S.live = st === "live"; S.offline = st === "offline"; schedule(); });
  const sub = (coll, key) => db.collection(coll).limit(5000).onSnapshot(snap => {
    S[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.loaded[key] = true; schedule();
  }, err => { if (err && err.code === "revoked") { S.live = false; S.db = null; } if (err && err.code === "permission_denied") S.readOnly = true; schedule(); });
  sub("items", "items"); sub("shipments", "shipments"); sub("batches", "batches");
  db.doc("config/main").onSnapshot(d => { S.config = d.exists ? d.data() : null; S.loaded.config = true; schedule(); }, () => {});
  render();
}

let raf = 0;
function schedule() { if (S.dragging) { S.pendingRender = true; return; } if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

// ---------- render ----------
function render() {
  const ae = document.activeElement, aid = ae && ae.id, sel = ae && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const D = derive();
  renderHeader(D);
  const m = $("#main");
  let html = "";
  if (S.failed) html += `<div class="banner">The database isn't connected, so the desk is empty. Check your Supabase settings.</div>`;
  else if (S.readOnly) html += `<div class="banner">View only: you can look around but not change anything. Ask the owner to make you an editor.</div>`;
  else if (!S.loaded.items) html += `<div class="banner">Loading your jastip data…</div>`;
  html += ({ overview: vOverview, tracker: vTracker, orders: vOrders, shipments: vShipments, finance: vFinance, research: vResearch, settings: vSettings }[S.tab])(D);
  m.innerHTML = html;
  renderBulk(D);
  initRSlide();
  fillSettingsNames();
  if (S.tab === "settings" && S.role === "Owner" && S.members === null) loadMembers();
  if (aid) { const el = document.getElementById(aid); if (el && el !== document.activeElement && !el.closest("#drawer")) { el.focus(); if (sel && "setSelectionRange" in el) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

// ---------- profile, theme, log out ----------
const myId = () => (S.me && S.me.id) || "";
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
function applyTheme(t) {
  const r = document.documentElement;
  if (t === "light" || t === "dark") { r.setAttribute("data-theme", t); r.style.colorScheme = t; }
  else if (t === "system") { r.removeAttribute("data-theme"); r.style.colorScheme = ""; }
}
S.theme = lsGet("jcd.theme") || "system";
if (lsGet("jcd.theme")) applyTheme(S.theme);
function setTheme(t) { S.theme = t; lsSet("jcd.theme", t); applyTheme(t); renderMenu(); if (S.tab === "settings") render(); }
const themeSeg = () => `<div class="seg" role="group" aria-label="Appearance">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button data-act="theme" data-id="${k}" aria-pressed="${S.theme === k}">${l}</button>`).join("")}</div>`;
function connectUser() {
  const u = ctx.user;
  S.user = u;
  if (u) {
    S.me = u.me;
    S.role = u.role === "owner" ? "Owner" : u.role === "editor" ? "Editor" : "Viewer · read only";
    S.readOnly = !u.canEdit;
  }
  renderMe(); schedule();
}
function renderMe() {
  const me = S.me;
  const name = (me && me.name) || "You";
  $("#mebtn").innerHTML = `<button class="me-btn" data-act="menu" aria-haspopup="true" aria-expanded="${!!S.menuOpen}" title="Profile & settings">${me ? `<img alt="" src="${esc(me.avatarUrl)}">` : `<img alt="">`}<span class="nm"></span></button>`;
  $("#mebtn .nm").textContent = name;
}
function renderMenu() {
  const m = $("#menu");
  if (!S.menuOpen) { m.innerHTML = ""; renderMe(); return; }
  const me = S.me;
  m.innerHTML = `<div class="menu" role="menu">
    <div class="sec"><div class="me-card">${me ? `<img alt="" src="${esc(me.avatarUrl)}">` : ""}<div class="who"><b id="mname"></b><span id="memail"></span></div></div>
      <div><span class="chip acc">${esc(S.role || "Signed in")}</span></div></div>
    <div class="sec"><span class="eyebrow">Appearance</span>${themeSeg()}</div>
    <div class="sec" style="padding:6px">
      <button class="mitem" data-act="menu-settings" role="menuitem">Settings</button>
      ${S.user && S.user.public ? "" : `<button class="mitem out" data-act="logout" role="menuitem">Log out</button>`}
    </div></div>`;
  $("#mname").textContent = (me && me.name) || "Signed in";
  $("#memail").textContent = (me && me.email) || "";
  renderMe();
}
async function resolveWho(root) {
  const els = [...root.querySelectorAll("[data-uid]")]; if (!els.length || !S.user) return;
  const ids = [...new Set(els.map(e => e.dataset.uid))];
  const ps = await S.user.profiles(ids);
  for (const e of els) { const p = ps[e.dataset.uid]; e.textContent = " · by " + ((p && p.name) || "someone"); }
}
const byTag = h => h && h.by ? `<span class="who-by" data-uid="${esc(h.by)}"></span>` : "";

function renderHeader(D) {
  const c = cfg();
  $("#kurs").innerHTML = `
    <span class="kchip">Kurs Eve/Didi <b>${nf0.format(c.kursEveDidi)}</b></span>
    <span class="kchip">Market <b>${nf0.format(c.marketRate)}</b></span>
    <span class="live ${S.live ? "on" : ""}"><i></i>${S.live ? "Live · shared" : S.failed || S.offline ? "Offline" : "Connecting"}</span>`;
  const active = S.items.filter(i => !["research", "delivered", "paid"].includes(i.stage)).length;
  const openQ = S.items.filter(i => i.stage === "research" && (i.research || {}).decision !== "nogo").length;
  const label = Object.fromEntries(TABS);
  const toBuy = S.items.filter(i => i.stage === "to_buy").length;
  const unpaid = S.items.filter(i => i.stage === "delivered" && !i.paid).length;
  const count = { research: openQ, orders: toBuy, shipments: S.shipments.filter(s => s.stage !== "delivered").length, tracker: active, finance: unpaid };
  const btn = (id, n) => `<button class="tab" role="tab" data-act="tab" data-id="${id}" aria-selected="${S.tab === id}" title="${esc(TAB_HINT[id] || label[id])}">${n ? `<span class="step">${n}</span>` : ""}${label[id]}${count[id] ? `<span class="count">${count[id]}</span>` : ""}</button>`;
  $("#tabs").innerHTML = TAB_GROUPS.map(g => g.flow
    ? `<div class="tabgroup flow" role="presentation">${g.tabs.map((id, i) => (i ? `<span class="chev" aria-hidden="true">›</span>` : "") + btn(id, i + 1)).join("")}</div>`
    : `<div class="tabgroup ${g.end ? "end" : ""}" role="presentation">${g.tabs.map(id => btn(id)).join("")}</div>`).join(`<span class="tabsep" aria-hidden="true"></span>`);
}

// ---- Overview ----
function vOverview(D) {
  const items = S.items;
  const X = id => D.X.get(id) || {};
  const OI = items.filter(i => i.stage !== "research");
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const moving = OI.filter(i => !["delivered", "paid"].includes(i.stage));
  const pipeVal = sum(moving, i => X(i.id).landed);
  const outstanding = OI.filter(i => !i.paid && !X(i.id).isInt);
  const outVal = sum(outstanding, i => X(i.id).billed);
  const research = items.filter(i => i.stage === "research" && (i.research || {}).decision !== "nogo");
  const worth = research.filter(i => rCalc(i).verdict === "good");
  const thisMonth = todayStr().slice(0, 7);
  const monthBatches = new Set(S.batches.filter(b => b.month === thisMonth).map(b => b.id));
  const monthSpend = sum(OI.filter(i => monthBatches.has(i.batch)), i => X(i.id).landed);
  const kpis = `
  <div class="kpis">
    <div class="kpi"><span class="eyebrow">In research</span><span class="v">${research.length}</span><span class="d">${worth.length} look worth it · ${research.filter(i => rCalc(i).verdict === "incomplete").length} need data</span></div>
    <div class="kpi"><span class="eyebrow">Goods on the way</span><span class="v">${idrC(pipeVal)}</span><span class="d">${moving.length} lines between To buy and To buyer</span></div>
    <div class="kpi"><span class="eyebrow">Owed by clients</span><span class="v">${idrC(outVal)}</span><span class="d">${new Set(outstanding.map(i => i.client)).size} clients · ${outstanding.length} unpaid lines</span></div>
    <div class="kpi"><span class="eyebrow">Spend · ${esc(monthLabel(thisMonth))}</span><span class="v">${idrC(monthSpend)}</span><span class="d">Modal + ongkir, ${monthBatches.size} PO${monthBatches.size === 1 ? "" : "s"}</span></div>
  </div>`;

  const byStage = Object.fromEntries(STAGES.map(s => [s.id, { n: 0, pcs: 0, val: 0 }]));
  for (const it of items) {
    if (it.stage === "research" && (it.research || {}).decision === "nogo") continue;
    const b = byStage[it.stage] || byStage.to_buy; b.n++; b.pcs += it.qty || 0;
    b.val += it.stage === "research" ? (rCalc(it).total || 0) : it.stage === "paid" ? (X(it.id).isInt ? 0 : X(it.id).billed) : (X(it.id).landed || 0);
  }
  const valNote = id => id === "research" ? "est. profit" : id === "paid" ? "collected" : "";
  const route = `
  <section class="panel">
    <div class="panel-h"><div><div class="eyebrow">Where everything is</div><h2>Route board</h2></div><span class="muted small">Tap a stop to open it</span></div>
    <div class="route">
      <div class="zones"><div class="zone rs">Sourcing</div><div class="zone cn">China</div><div class="zone tr">Crossing</div><div class="zone id">Indonesia</div><div class="zone done">Closed</div></div>
      <div class="route-inner">
        ${STAGES.map(s => { const b = byStage[s.id]; return `
        <button class="node ${b.n ? "" : "zero"}" style="--dot:var(${s.dot})" data-act="gostage" data-id="${s.id}">
          <span class="pin"></span>
          <span class="lbl">${esc(s.label)}</span>
          <span class="place">${esc(s.place)}</span>
          <span class="big">${b.n}</span>
          <span class="val">${qtyf(b.pcs)} pcs · ${idrC(b.val)}${valNote(s.id) ? " " + valNote(s.id) : ""}</span>
        </button>`; }).join("")}
      </div>
    </div>
  </section>`;

  // completed orders
  const done = OI.filter(i => i.stage === "paid");
  const doneExt = done.filter(i => !X(i.id).isInt);
  const collected = sum(doneExt, i => X(i.id).billed);
  const doneMargin = sum(doneExt.filter(i => X(i.id).hasSell), i => X(i.id).profit);
  const ownSpend = sum(done.filter(i => X(i.id).isInt), i => X(i.id).landed);
  const awaiting = OI.filter(i => i.stage === "delivered" && !i.paid && !X(i.id).isInt);
  const awaitVal = sum(awaiting, i => X(i.id).billed);
  const dc = {};
  for (const i of done) { const c = dc[i.client] = dc[i.client] || { n: 0, pcs: 0, val: 0, margin: 0, isInt: X(i.id).isInt, last: "" }; c.n++; c.pcs += i.qty || 0; c.val += c.isInt ? X(i.id).landed : X(i.id).billed; if (!c.isInt && X(i.id).hasSell) c.margin += X(i.id).profit; const m = D.batchById[i.batch]?.month || ""; if (m > c.last) c.last = m; }
  const completed = `
  <section class="panel">
    <div class="panel-h"><div><div class="eyebrow">Delivered and paid</div><h2>Completed orders</h2></div><button class="btn sm" data-act="gostage" data-id="paid">Open in Tracker</button></div>
    <div class="minis">
      <div class="mini"><span class="eyebrow">Closed lines</span><span class="v">${done.length}</span><span class="muted small">${qtyf(sum(done, i => i.qty))} pcs</span></div>
      <div class="mini"><span class="eyebrow">Collected</span><span class="v">${idrC(collected)}</span><span class="muted small">from ${new Set(doneExt.map(i => i.client)).size} clients</span></div>
      <div class="mini"><span class="eyebrow">Margin</span><span class="v">${idrC(doneMargin)}</span><span class="muted small">lines with a sell price</span></div>
      <div class="mini"><span class="eyebrow">Own business</span><span class="v">${idrC(ownSpend)}</span><span class="muted small">Empire / Kard Avenue stock</span></div>
      <div class="mini"><span class="eyebrow">Awaiting payment</span><span class="v ${awaitVal ? "neg" : ""}">${idrC(awaitVal)}</span><span class="muted small">${awaiting.length} delivered, not paid</span></div>
    </div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Client</th><th class="r">Lines</th><th class="r">Pcs</th><th class="r">Collected</th><th class="r">Margin</th><th>Latest PO</th></tr></thead><tbody>
      ${Object.entries(dc).sort((a, b) => (a[1].isInt - b[1].isInt) || b[1].val - a[1].val).map(([n, c]) => `<tr class="click" data-act="att-done" data-id="${esc(n)}"><td>${esc(n)}${c.isInt ? ` <span class="chip int">own</span>` : ""}</td><td class="r num">${c.n}</td><td class="r num">${qtyf(c.pcs)}</td><td class="r num">${c.isInt ? `<span class="muted">${idr(c.val)} cost</span>` : idr(c.val)}</td><td class="r num">${c.isInt ? "—" : idr(c.margin)}</td><td>${esc(monthLabel(c.last))}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No completed orders yet.</td></tr>`}
    </tbody></table></div>
  </section>`;

  // attention
  const today = todayStr();
  const att = [];
  if (awaiting.length) att.push({ tone: "bad", t: `${idr(awaitVal)} delivered but not paid`, d: `${awaiting.length} lines · ${[...new Set(awaiting.map(i => i.client))].join(", ")}`, act: "stage", id: "delivered" });
  const rev = items.filter(i => i.review);
  if (rev.length) att.push({ tone: "warn", t: `${rev.length} lines need a check`, d: "Stage, price or client was guessed during import", act: "flag", id: "review" });
  const late = S.shipments.filter(s => s.stage === "departed" && s.eta && s.eta < today);
  const lateItems = moving.filter(i => !ARRIVED.includes(i.stage) && daysUntil(itemEta(i, D.shipById)) < 0);
  if (lateItems.length) att.push({ tone: "bad", t: `${lateItems.length} lines are past their ETA Jakarta`, d: [...new Set(lateItems.map(i => i.client))].join(", "), act: "flag", id: "late" });
  const soon = moving.filter(i => !ARRIVED.includes(i.stage) && (d => d != null && d >= 0 && d <= 3)(daysUntil(itemEta(i, D.shipById))));
  if (soon.length) att.push({ tone: "", t: `${soon.length} lines should reach Jakarta in the next 3 days`, d: "Get the Jakarta team ready", act: "flag", id: "soon" });
  for (const s of late) att.push({ tone: "bad", t: `${s.name} is past its ETA`, d: `ETA ${fmtDate(s.eta)} · ${METHODS[s.method] || s.method}`, act: "ship", id: s.id });
  const noPrice = moving.filter(i => !i.priceCNY);
  if (noPrice.length) att.push({ tone: "warn", t: `${noPrice.length} active lines have no ¥ price`, d: "Totals for these POs are incomplete", act: "flag", id: "noprice" });
  const noShip = moving.filter(i => !X(i.id).alloc);
  if (noShip.length) att.push({ tone: "warn", t: `${noShip.length} lines on the way have no ongkir in their modal`, d: "Add weight & size, a route, or put them in a shipment with its cost", act: "flag", id: "noship" });
  if (worth.length) att.push({ tone: "", t: `${worth.length} research requests look worth buying`, d: "Margin and profit clear your targets — approve them", act: "research", id: "worth" });
  const needData = research.filter(i => rCalc(i).verdict === "incomplete").length;
  if (needData) att.push({ tone: "", t: `${needData} requests still need a price`, d: "Waiting on harga modal or harga jual", act: "research", id: "open" });
  const byClient = {};
  for (const i of outstanding) if (i.stage !== "delivered") byClient[i.client] = (byClient[i.client] || 0) + (X(i.id).billed || 0);
  Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([c, v]) => att.push({ tone: "", t: `${c} will owe ${idr(v)}`, d: "Unpaid lines still on the way", act: "client", id: c }));
  const attention = `
  <section class="panel">
    <div class="panel-h"><h3>Needs attention</h3></div>
    <div class="list">${att.length ? att.map(a => `
      <div class="li"><span class="chip ${a.tone === "bad" ? "bad" : a.tone === "warn" ? "warn" : "acc"}">${a.tone === "bad" ? "Act" : a.tone === "warn" ? "Check" : "Info"}</span>
      <div class="grow"><button class="linkish" data-act="att-${a.act}" data-id="${esc(a.id)}"><b>${esc(a.t)}</b></button><div class="muted small">${esc(a.d)}</div></div></div>`).join("") : `<div class="empty">Nothing needs attention.</div>`}
    </div>
  </section>`;

  const byMonth = {};
  for (const it of OI) { const b = D.batchById[it.batch]; const m = b?.month || "—"; byMonth[m] = (byMonth[m] || 0) + (X(it.id).landed || 0); }
  const months = Object.keys(byMonth).filter(m => m !== "—").sort();
  const chart = `
  <section class="panel">
    <div class="panel-h"><div><h3>Spend per month</h3><div class="muted small">Modal (¥ × kurs) plus ongkir, by PO month</div></div></div>
    <div class="panel-b chart">${barChart(months.map(m => ({ label: monthLabel(m).replace(" 20", " ’"), value: byMonth[m], tip: `<b>${idr(byMonth[m])}</b><br>${esc(monthLabel(m))}` })))}</div>
  </section>`;

  const activeShips = S.shipments.filter(s => s.stage !== "delivered");
  const ships = `
  <section class="panel">
    <div class="panel-h"><h3>Open shipments</h3><button class="btn sm" data-act="tab" data-id="shipments">All shipments</button></div>
    <div class="list">${activeShips.length ? activeShips.map(s => { const n = S.items.filter(i => i.shipmentId === s.id).length; return `
      <div class="li"><span class="chip acc">${esc((SHIP_STAGES.find(x => x.id === s.stage) || SHIP_STAGES[0]).label)}</span>
      <div class="grow"><button class="linkish" data-act="edit-ship" data-id="${s.id}"><b>${esc(s.name)}</b></button>
      <div class="muted small">${esc(METHODS[s.method] || s.method || "")}${s.carrier ? " · " + esc(s.carrier) : ""} · ${n} lines${s.eta ? " · ETA " + fmtDate(s.eta) : ""}</div></div>
      <span class="num small">${idrC(s.costIDR)}</span></div>`; }).join("") : `<div class="empty">No open shipments.</div>`}</div>
  </section>`;

  const start = (S.loaded.items && !S.items.length) ? `
  <section class="panel"><div class="panel-h"><div><div class="eyebrow">Empty desk</div><h2>Start here</h2></div></div>
    <div class="list">
      <div class="li"><span class="chip acc">1</span><div class="grow"><b>Set your kurs and ongkir rates</b><div class="muted small">Kurs Eve/Didi, air / sea / jastipper rates, and mark your own businesses as internal.</div></div><button class="btn sm" data-act="tab" data-id="settings">Settings</button></div>
      <div class="li"><span class="chip acc">2</span><div class="grow"><b>Log a buyer request</b><div class="muted small">Modal ¥, harga jual, ongkir and sample — the app tells you if it's worth it.</div></div><button class="btn sm" data-act="new-research">+ Research request</button></div>
      <div class="li"><span class="chip acc">3</span><div class="grow"><b>Create a PO</b><div class="muted small">One PO per buying round, e.g. "October PO 1 2026".</div></div><button class="btn sm" data-act="new-batch">+ New PO</button></div>
      <div class="li"><span class="chip acc">4</span><div class="grow"><b>Add items and a shipment</b><div class="muted small">Approve research or add items straight to the buy list, then group them into a shipment to track location.</div></div><button class="btn sm" data-act="new-ship">+ New shipment</button></div>
    </div></section>` : "";
  return start + kpis + route + `<div class="grid2">${attention}${ships}</div>` + completed + chart;
}

function barChart(data) {
  if (!data.length) return `<div class="empty">No data yet.</div>`;
  const W = chartW(), H = 240, pl = 64, pr = 8, pt = 12, pb = 28;
  const max = Math.max(...data.map(d => d.value), 1);
  const step = niceStep(max / 4); const top = Math.ceil(max / step) * step;
  const bw = (W - pl - pr) / data.length, barW = Math.min(56, bw * 0.62);
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  let g = "";
  for (let v = 0; v <= top + 1e-6; v += step) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${esc(idrC(v).replace("Rp ", ""))}</text>`;
  const bars = data.map((d, i) => {
    const x = pl + bw * i + (bw - barW) / 2, yy = y(d.value), h = Math.max(0, y(0) - yy);
    const r = Math.min(4, h);
    const path = h > 0 ? `M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${y(0)} Z` : "";
    return `<g data-tip="${esc(d.tip)}"><rect x="${pl + bw * i}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent"/>${path ? `<path d="${path}" fill="var(--accent)"/>` : ""}
      <text class="axis" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(bw < 64 ? d.label.split(" ")[0] : d.label)}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of spend per month">${g}${bars}</svg>`;
}
function chartW() { const m = document.getElementById("main"); return Math.max(300, Math.min(1240, ((m && m.clientWidth) || 800) - 66)); }
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function lineChart(data) {
  if (data.length < 2) return `<div class="empty">Need two POs to draw a trend.</div>`;
  const W = chartW(), H = 200, pl = 52, pr = 16, pt = 16, pb = 28;
  const vals = data.map(d => d.value);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(20, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = i => pl + (W - pl - pr) * (i / (data.length - 1));
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let g = "";
  for (let v = lo; v <= hi + 1e-6; v += step) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${nf0.format(v)}</text>`;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `M${x(0)},${y(lo)} L${pts.split(" ").join(" L")} L${x(data.length - 1)},${y(lo)} Z`;
  const dots = data.map((d, i) => `<g data-tip="${esc(d.tip)}"><circle cx="${x(i)}" cy="${y(d.value)}" r="14" fill="transparent"/><circle cx="${x(i)}" cy="${y(d.value)}" r="${i === data.length - 1 ? 5 : 3.5}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    ${(W > 640 || i === 0 || i === data.length - 1) ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}">${esc(d.label)}</text>` : ""}</g>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kurs per PO">${g}<path d="${area}" fill="var(--accent)" opacity=".10"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}</svg>`;
}

// ---- shared filters ----
function filterBar(opts = {}) {
  const f = S.f;
  const bs = sortedBatches();
  return `<div class="filters">
    <input class="in" id="f-q" type="search" placeholder="Search item, client, holder…" value="${esc(f.q)}" data-act="f" data-k="q">
    <select class="in" id="f-batch" data-act="f" data-k="batch"><option value="all">All POs</option>${bs.map(b => `<option value="${b.id}" ${f.batch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
    <select class="in" id="f-client" data-act="f" data-k="client"><option value="all">All clients</option>${clientNames().map(c => `<option ${f.client === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    ${opts.stage ? `<select class="in" id="f-stage" data-act="f" data-k="stage"><option value="all">All stages</option>${STAGES.map(s => `<option value="${s.id}" ${f.stage === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select>` : ""}
    ${opts.flags ? `<select class="in" id="f-flag" data-act="f" data-k="flag">
      ${[["all", "All lines"], ["review", "Needs check"], ["unpaid", "Unpaid by client"], ["noprice", "No ¥ price"], ["nosell", "No sell price"], ["noship", "No ongkir yet"], ["late", "Past ETA Jakarta"], ["soon", "Arriving ≤ 3 days"]].map(([v, l]) => `<option value="${v}" ${f.flag === v ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
    ${(f.batch !== "all" || f.client !== "all" || f.q || f.flag !== "all" || f.stage !== "all") ? `<button class="btn ghost sm" data-act="clear-f">Clear filters</button>` : ""}
  </div>`;
}

// ---- Tracker ----
function vTracker(D) {
  const list = filteredItems({ D, stage: false }).filter(i => !(i.stage === "research" && (i.research || {}).decision === "nogo"));
  const cols = STAGES.map(s => {
    const its = list.filter(i => (i.stage || "to_buy") === s.id);
    const pcs = its.reduce((a, i) => a + (i.qty || 0), 0);
    const val = its.reduce((a, i) => a + (D.X.get(i.id)?.landed || 0), 0);
    let body;
    if (s.id === "paid" && !S.f.showPaid && its.length) body = `<div class="collapsed">${its.length} lines paid and closed.<button class="btn sm" data-act="show-paid">Show them</button></div>`;
    else body = its.map(i => card(i, D)).join("") || `<div class="collapsed">Empty</div>`;
    return `<div class="col" style="--dot:var(${s.dot})">
      <div class="col-h"><span class="t1"><i></i>${esc(s.label)}</span><span class="t2">${its.length} lines · ${qtyf(pcs)} pcs · ${idrC(val)}</span></div>
      <div class="col-b">${body}</div></div>`;
  }).join("");
  return `<section class="row"><div><div class="eyebrow">Location tracking</div><h2>Tracker</h2></div><span class="spacer"></span>
      <button class="btn" data-act="new-research">+ Research request</button><button class="btn" data-act="new-item">+ Add item</button></section>
    ${filterBar({ flags: true })}
    <div class="muted small">Tick cards to move several lines at once. Tap a card to edit it or see its location history.</div>
    <div class="board"><div class="cols">${cols}</div></div>`;
}
function card(i, D) {
  const b = D.batchById[i.batch];
  const sh = i.shipmentId && D.shipById[i.shipmentId];
  const sel = S.sel.has(i.id);
  return `<div class="card ${sel ? "sel" : ""}" data-act="edit-item" data-id="${i.id}" role="button" tabindex="0">
    <input type="checkbox" data-act="sel" data-id="${i.id}" ${sel ? "checked" : ""} aria-label="Select ${esc(i.name)}">
    <div class="ct">${esc(i.name || "Untitled")}${i.variant ? `<div class="muted small" style="font-weight:400">${esc(i.variant)}</div>` : ""}</div>
    <div class="cm"><span class="chip">${esc(i.client || "—")}</span><span class="num">${qtyf(i.qty)} pcs</span>${b ? `<span>${esc(b.name)}</span>` : ""}</div>
    ${i.stage !== "research" && D.X.get(i.id)?.perPc ? `<div class="cm"><span class="num">${idr(D.X.get(i.id).perPc)}/pc</span><span>incl. ongkir${D.X.get(i.id).shipSrc === "est" ? " (est.)" : D.X.get(i.id).shipSrc === "none" ? " — none yet" : ""}</span></div>` : ""}
    ${(i.holder || sh) ? `<div class="cm">${i.holder ? `At ${esc(i.holder)}` : ""}${sh ? `<span>· ${esc(METHODS[sh.method] ? ROUTES[sh.method] || sh.method : sh.method)}</span>` : ""}</div>` : ""}
    ${itemEta(i, D.shipById) && i.stage !== "paid" ? `<div class="cm">${etaChip(i, D.shipById)}</div>` : ""}
    ${i.stage === "research" ? `<div class="cm">${verdictChip(rCalc(i))}${(i.research || {}).decision === "hold" ? `<span class="chip warn">On hold</span>` : ""}</div>` : ""}
    ${(i.review || (i.stage !== "research" && !i.paid && !D.X.get(i.id)?.isInt)) ? `<div class="cm">${i.review ? `<span class="chip warn">Check</span>` : ""}${i.stage !== "research" && !i.paid && !D.X.get(i.id)?.isInt ? `<span class="chip bad">Unpaid</span>` : ""}</div>` : ""}
  </div>`;
}

// ---- Orders ----
function vOrders(D) {
  const list = filteredItems({ D }).filter(i => S.f.stage === "research" || i.stage !== "research");
  const byBatch = {};
  for (const it of list) (byBatch[it.batch] = byBatch[it.batch] || []).push(it);
  const bs = sortedBatches().filter(b => byBatch[b.id]);
  const orphan = Object.keys(byBatch).filter(k => !D.batchById[k]);
  const allSel = list.length && list.every(i => S.sel.has(i.id));
  const rows = [];
  const groups = [...bs.map(b => [b.id, b]), ...orphan.map(k => [k, { id: k, name: "No PO" }])];
  const tot = { goods: 0, modal: 0, alloc: 0, landed: 0, billed: 0, profit: 0 };
  for (const [bid, b] of groups) {
    const its = byBatch[bid];
    const t = { goods: 0, modal: 0, alloc: 0, landed: 0, billed: 0, profit: 0 };
    rows.push(`<tr class="group"><td colspan="15"><div class="row"><span>${esc(b.name)}</span><span class="muted small" style="font-weight:400">${esc(monthLabel(b.month))}</span>${b.note ? `<span class="muted small" style="font-weight:400;flex:1 1 300px">${esc(b.note)}</span>` : ""}${b.month ? `<button class="btn sm" data-act="edit-batch" data-id="${b.id}">Edit PO</button>` : ""}</div></td></tr>`);
    for (const it of its) {
      const x = D.X.get(it.id);
      for (const k in t) t[k] += (k === "goods" ? x.goods : x[k] || 0);
      rows.push(`<tr class="click" data-act="edit-item" data-id="${it.id}">
        <td><input type="checkbox" data-act="sel" data-id="${it.id}" ${S.sel.has(it.id) ? "checked" : ""} aria-label="Select"></td>
        <td>${esc(it.client)}${x.isInt ? ` <span class="chip int">own</span>` : ""}</td>
        <td><div class="nm">${esc(it.name)}${it.review ? ` <span class="chip warn">Check</span>` : ""}</div>${it.variant ? `<div class="vr">${esc(it.variant)}</div>` : ""}${(() => { const u = safeUrl(it.link); return it.shop ? `<div class="vr">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener" data-stop="1">${esc(it.shop)}</a>` : esc(it.shop)}</div>` : u ? `<div class="vr"><a href="${esc(u)}" target="_blank" rel="noopener" data-stop="1">Link</a></div>` : ""; })()}</td>
        <td class="r num">${qtyf(it.qty)}</td>
        <td class="r num">${cny(it.priceCNY)}</td>
        <td class="r num">${nf0.format(it.rate || 0)}</td>
        <td class="r num">${idr(x.modal)}</td>
        <td class="r num" title="${esc(x.shipNote)}">${x.alloc ? idr(x.alloc) : "—"}${x.shipSrc === "est" ? `<div class="vr">estimate</div>` : x.shipSrc === "manual" ? `<div class="vr">typed in</div>` : ""}</td>
        <td class="r num">${idr(x.landed)}</td>
        <td class="r num"><b>${idr(x.perPc)}</b></td>
        <td class="r num">${it.sellIDR != null ? idr(it.sellIDR) : "—"}</td>
        <td class="r num">${x.isInt ? "—" : idr(x.billed)}</td>
        <td class="r num ${x.profit < 0 ? "neg" : x.profit > 0 ? "pos" : ""}">${x.isInt ? "—" : idr(x.profit)}</td>
        <td>${stageChip(it.stage)}${itemEta(it, D.shipById) && !ARRIVED.includes(it.stage) ? `<div style="margin-top:4px">${etaChip(it, D.shipById)}</div>` : ""}</td>
        <td>${x.isInt ? "" : it.paid ? `<span class="chip ok">Paid</span>` : `<span class="chip bad">Unpaid</span>`}</td></tr>`);
    }
    rows.push(`<tr class="sub"><td></td><td colspan="3">Subtotal · ${its.length} lines</td><td class="r num">Σ ${cny(t.goods)}</td><td></td><td class="r num">${idr(t.modal)}</td><td class="r num">${idr(t.alloc)}</td><td class="r num">${idr(t.landed)}</td><td></td><td></td><td class="r num">${idr(t.billed)}</td><td class="r num">${idr(t.profit)}</td><td colspan="2"></td></tr>`);
    for (const k in tot) tot[k] += t[k];
  }
  return `<section class="row"><div><div class="eyebrow">Buy lists &amp; POs</div><h2>Orders</h2></div><span class="spacer"></span>
      <button class="btn" data-act="new-batch">+ New PO</button><button class="btn primary" data-act="new-item">+ Add item</button></section>
    ${filterBar({ stage: true, flags: true })}
    <div class="kpis">
      <div class="kpi"><span class="eyebrow">Total ¥</span><span class="v">${cny(tot.goods)}</span><span class="d">${list.length} lines shown</span></div>
      <div class="kpi"><span class="eyebrow">Modal barang</span><span class="v">${idrC(tot.modal)}</span><span class="d">¥ × kurs per line</span></div>
      <div class="kpi"><span class="eyebrow">Ongkir</span><span class="v">${idrC(tot.alloc)}</span><span class="d">Actual shipment cost or estimate</span></div>
      <div class="kpi"><span class="eyebrow">Total modal</span><span class="v">${idrC(tot.landed)}</span><span class="d">Barang + ongkir</span></div>
      <div class="kpi"><span class="eyebrow">Client pays</span><span class="v">${idrC(tot.billed)}</span><span class="d">Margin ${idrC(tot.profit)}</span></div>
    </div>
    <section class="panel"><div class="tablewrap"><table class="t">
      <thead><tr><th><input type="checkbox" data-act="selall" ${allSel ? "checked" : ""} aria-label="Select all shown"></th><th>Client</th><th>Item</th><th class="r">Qty</th><th class="r">¥ / pc</th><th class="r">Kurs</th><th class="r">Modal barang</th><th class="r">Ongkir</th><th class="r">Total modal</th><th class="r">Modal / pc + ongkir</th><th class="r">Sell / pc</th><th class="r">Client pays</th><th class="r">Margin</th><th>Stage</th><th>Payment</th></tr></thead>
      <tbody>${rows.join("") || `<tr><td colspan="15" class="empty">No lines match these filters.</td></tr>`}</tbody></table></div></section>`;
}

// ---- Shipments ----
function vShipments(D) {
  const v = S.f.shipView;
  const list = [...S.shipments].filter(s => v === "all" || (v === "active" ? s.stage !== "delivered" : s.stage === "delivered"))
    .sort((a, b) => (D.batchById[b.batch]?.month || "").localeCompare(D.batchById[a.batch]?.month || "") || (a.name || "").localeCompare(b.name || ""));
  const cards = list.map(s => {
    const its = S.items.filter(i => i.shipmentId === s.id);
    const pcs = its.reduce((a, i) => a + (i.qty || 0), 0);
    const si = Math.max(0, SHIP_STAGES.findIndex(x => x.id === s.stage));
    const next = SHIP_STAGES[si + 1];
    return `<article class="ship">
      <div class="ship-h"><div><h3>${esc(s.name)}</h3><div class="muted small">${esc(METHODS[s.method] || s.method || "")}${s.carrier ? " · " + esc(s.carrier) : ""} → ${s.dest === "buyer" ? "straight to buyer" : "Jakarta team"}</div></div>
        <button class="btn sm" data-act="edit-ship" data-id="${s.id}">${its.length ? "Edit" : "+ Add items"}</button></div>
      <div class="waybill">
        <div><span class="k">Resi</span><span class="v">${esc(s.tracking || "—")}</span></div>
        <div><span class="k">Berat</span><span class="v">${s.kg ? nf2.format(s.kg) + " kg" : "—"}</span></div>
        <div><span class="k">Ongkir</span><span class="v">${s.costIDR ? idrC(s.costIDR) : (() => { const e = shipmentEstimate(s); return e && e.total ? "≈ " + idrC(e.total) : "—"; })()}</span></div>
        <div><span class="k">ETA</span><span class="v">${s.eta ? fmtDate(s.eta) : "—"}</span></div>
      </div>
      <div class="steps">${SHIP_STAGES.map((x, i) => `<div class="step ${i <= si ? "done" : ""} ${i === si ? "cur" : ""}"><i></i>${x.label}</div>`).join("")}</div>
      <div class="ship-f"><span class="muted small">${its.length} lines · ${qtyf(pcs)} pcs${its.length && s.costIDR ? " · " + (its.every(i => lineKgVol(i).kg || lineKgVol(i).vol) ? "ongkir split by weight" : "ongkir split by value") : ""}${s.note ? " · " + esc(s.note) : ""}</span><span class="spacer"></span>
        ${next ? `<button class="btn primary sm" data-act="ship-next" data-id="${s.id}">Mark ${esc(next.label.toLowerCase())}</button>` : `<span class="chip ok">Done</span>`}</div>
    </article>`;
  }).join("");
  return `<section class="row"><div><div class="eyebrow">Jastipper · cargo · courier</div><h2>Shipments</h2></div><span class="spacer"></span>
      <div class="seg" role="group">${[["active", "Open"], ["done", "Delivered"], ["all", "All"]].map(([k, l]) => `<button data-act="shipview" data-id="${k}" aria-pressed="${v === k}">${l}</button>`).join("")}</div>
      <button class="btn primary" data-act="new-ship">+ New shipment</button></section>
    <div class="muted small">A shipment is one parcel or cargo run. Moving it forward moves every line inside it and logs the location. Open a shipment (or create one) and tick the items inside it, or use “Put in shipment” from the Tracker or Orders tab.</div>
    ${cards ? `<div class="ships">${cards}</div>` : `<div class="panel empty">No shipments here yet.</div>`}`;
}

function shipmentEstimate(s) {
  const c = cfg(); const its = S.items.filter(i => i.shipmentId === s.id);
  let kg = 0, vol = 0, goods = 0;
  for (const i of its) { const k = lineKgVol(i); kg += k.kg; vol += k.vol; goods += goodsCNY(i) * (i.rate || 0); }
  if (num(s.kg) > kg) kg = num(s.kg);
  if (!kg && !vol) return null;
  return { ...shipQuote(s.method, kg, vol, goods, c), lines: its.length };
}

// ---- Finance ----
function vFinance(D) {
  const clients = {};
  const OI = S.items.filter(i => i.stage !== "research");
  for (const it of OI) {
    const x = D.X.get(it.id); const c = clients[it.client] = clients[it.client] || { n: 0, landed: 0, billed: 0, paid: 0, out: 0, profit: 0, isInt: x.isInt };
    c.n++; c.landed += x.landed; c.billed += x.billed; if (it.paid) c.paid += x.billed; else c.out += x.billed; if (!x.isInt && x.hasSell) c.profit += x.profit;
  }
  const crow = Object.entries(clients).sort((a, b) => (a[1].isInt - b[1].isInt) || b[1].landed - a[1].landed);
  const maxL = Math.max(1, ...crow.map(([, c]) => c.landed));
  const ctable = `<section class="panel"><div class="panel-h"><div><h3>By client</h3><div class="muted small">Total modal = modal barang + ongkir. “Client pays” = sell price × qty (your sell price should already cover ongkir). Lines without a sell price pass through at total modal.</div></div></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Client</th><th class="r">Lines</th><th>Total modal</th><th class="r">Client pays</th><th class="r">Paid</th><th class="r">Outstanding</th><th class="r">Margin</th></tr></thead><tbody>
    ${crow.map(([name, c]) => `<tr class="click" data-act="att-client" data-id="${esc(name)}"><td>${esc(name)}${c.isInt ? ` <span class="chip int">own business</span>` : ""}</td><td class="r num">${c.n}</td>
      <td><div class="row" style="flex-wrap:nowrap"><div class="bartrack"><div class="bar" style="width:${(c.landed / maxL * 100).toFixed(1)}%"></div></div><span class="num small">${idr(c.landed)}</span></div></td>
      <td class="r num">${c.isInt ? "—" : idr(c.billed)}</td><td class="r num">${c.isInt ? "—" : idr(c.paid)}</td>
      <td class="r num ${c.out > 0 && !c.isInt ? "neg" : ""}">${c.isInt ? "—" : idr(c.out)}</td><td class="r num">${c.isInt ? "—" : idr(c.profit)}</td></tr>`).join("")}
    </tbody></table></div></section>`;

  const brow = sortedBatches().map(b => {
    const its = OI.filter(i => i.batch === b.id);
    const t = { goods: 0, modal: 0, alloc: 0, landed: 0, billed: 0, profit: 0, pcs: 0 };
    for (const i of its) { const x = D.X.get(i.id); t.goods += x.goods; t.modal += x.modal; t.alloc += x.alloc; t.landed += x.landed; t.billed += x.billed; if (!x.isInt) t.profit += x.profit || 0; t.pcs += i.qty || 0; }
    const shipCost = S.shipments.filter(s => s.batch === b.id).reduce((a, s) => a + (s.costIDR || 0), 0);
    const rates = its.map(i => i.rate).filter(Boolean); const avg = rates.length ? t.modal / (t.goods || 1) : 0;
    return { b, t, avg, n: its.length, shipCost };
  });
  const btable = `<section class="panel"><div class="panel-h"><h3>By PO</h3><span class="muted small">Research requests are left out until approved</span></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>PO</th><th>Month</th><th class="r">Lines</th><th class="r">Total ¥</th><th class="r">Avg kurs</th><th class="r">Modal barang</th><th class="r">Ongkir</th><th class="r">Total modal</th><th class="r">Client pays</th><th class="r">Margin</th></tr></thead><tbody>
    ${brow.map(r => `<tr class="click" data-act="att-batch" data-id="${r.b.id}"><td>${esc(r.b.name)}</td><td>${esc(monthLabel(r.b.month))}</td><td class="r num">${r.n}</td><td class="r num">${cny(r.t.goods)}</td><td class="r num">${r.avg ? nf0.format(r.avg) : "—"}</td><td class="r num">${idr(r.t.modal)}</td><td class="r num">${idr(r.t.alloc)}</td><td class="r num">${idr(r.t.landed)}</td><td class="r num">${idr(r.t.billed)}</td><td class="r num ${r.t.profit < 0 ? "neg" : ""}">${idr(r.t.profit)}</td></tr>`).join("")}
    </tbody></table></div></section>`;

  const kdata = [...brow].reverse().filter(r => r.avg).map(r => ({ label: r.b.name.replace("September", "Sep").replace("August", "Aug").replace(" (early 2026)", ""), value: r.avg, tip: `<b>${nf0.format(r.avg)}</b> per ¥<br>${esc(r.b.name)}` }));
  const kchart = `<section class="panel"><div class="panel-h"><div><h3>Kurs per PO</h3><div class="muted small">IDR paid per ¥1, weighted by line value. Every +100 on ¥10.000 costs Rp 1 jt more.</div></div></div><div class="panel-b chart">${lineChart(kdata)}</div></section>`;
  return `<section><div class="eyebrow">Money in, money out</div><h2>Finance</h2></section>${ctable}${kchart}${btable}`;
}

// ---- Research ----
function rCalc(it) {
  const r = it.research || {}, c = cfg();
  const rate = it.rate || c.quoteRate;
  const qty = it.qty || r.moq || 0;
  const modal = it.priceCNY ? (it.priceCNY + (it.extraCNY || 0) / (qty || 1)) * rate : null;
  const sh = itemShip({ ...it, qty, rate }, c);
  const ship = sh.perPc;
  const costPc = modal != null ? modal + (ship || 0) : null;
  const sell = it.sellIDR != null && it.sellIDR !== "" ? num(it.sellIDR) : null;
  const unit = costPc != null && sell != null ? sell - costPc : null;
  const pct = unit != null && sell ? unit / sell : null;
  const market = r.marketIDR ? num(r.marketIDR) : null;
  const vsMarket = market && sell != null ? market - sell : null;
  const sampleCost = num(r.sampleCostIDR);
  const total = unit != null ? unit * qty - sampleCost : null;
  const hx = HASSLE_X[r.hassle || "med"] || 1.5;
  const needPct = (c.minMarginPct ?? 20) / 100, needProfit = (c.minProfitIDR ?? 300000) * hx;
  const reasons = [];
  let verdict = "incomplete";
  if (unit == null) reasons.push(!it.priceCNY ? "Needs harga modal (¥)" : "Needs harga jual");
  else {
    if (pct < needPct) reasons.push(`Margin ${Math.round(pct * 100)}% is under the ${c.minMarginPct ?? 20}% target`);
    if (total < needProfit) reasons.push(`Profit ${idr(total)} at ${qtyf(qty)} pcs is under ${idr(needProfit)} for ${(r.hassle || "med") === "low" ? "low" : r.hassle === "high" ? "high" : "medium"} hassle`);
    if (vsMarket != null && vsMarket < 0) reasons.push(`Harga jual is ${idr(-vsMarket)} above the Indo market price`);
    if (r.sample === "rejected") reasons.push("Sample was rejected");
    verdict = !reasons.length ? "good" : (reasons.length === 1 && pct >= needPct * 0.5 && r.sample !== "rejected") ? "thin" : "bad";
    if (ship == null) reasons.push("Ongkir not counted yet: " + sh.note.toLowerCase());
  }
  const checks = [!!r.supplierOk, r.sample === "approved", !!r.customerOk, !!r.dpOk];
  return { rate, modal, ship, shipSrc: sh.src, shipNote: sh.note, costPc, sell, unit, pct, market, vsMarket, qty, sampleCost, total, needPct, needProfit, reasons, verdict, checks: checks.filter(Boolean).length };
}
function verdictChip(c) {
  return c.verdict === "good" ? `<span class="chip ok">Worth it</span>` : c.verdict === "thin" ? `<span class="chip warn">Thin</span>` : c.verdict === "bad" ? `<span class="chip bad">Not worth it</span>` : `<span class="chip">Need data</span>`;
}
const RSORTS = [["seq", "Order requested"], ["profit", "Profit"], ["unit", "Untung / pc"], ["pct", "Margin %"], ["cost", "Modal + ongkir"], ["sell", "Jual / pc"], ["market", "Harga pasar"], ["modal", "Modal barang"], ["ship", "Ongkir / pc"], ["qty", "Qty"], ["eta", "ETA Jakarta"], ["client", "Requested by"], ["item", "Item name"], ["sample", "Sample"], ["verdict", "Verdict"], ["status", "Status"]];
const RSORT_ASC = ["seq", "client", "item", "eta", "sample", "verdict", "status"];
const RFILTER_DEFAULT = { rverdict: "all", rsample: "all", rclient: "all", rpic: "all", rhassle: "all" };
function rSort(key, fromSelect) {
  if (!fromSelect && S.f.rsortkey === key) S.f.rdir = S.f.rdir === "asc" ? "desc" : "asc";
  else { S.f.rsortkey = key; S.f.rdir = RSORT_ASC.includes(key) ? "asc" : "desc"; }
  render();
}
function syncRSlide() {
  const w = $("#rwrap"), s = $("#rslide"), bar = $("#rslidebar"); if (!w || !s || !bar) return;
  const max = w.scrollWidth - w.clientWidth;
  bar.hidden = max <= 4;
  s.value = max > 0 ? Math.round(w.scrollLeft / max * 1000) : 0;
}
function initRSlide() {
  const w = $("#rwrap"); if (!w) return;
  w.scrollLeft = S.rscroll || 0;
  w.addEventListener("scroll", () => { S.rscroll = w.scrollLeft; syncRSlide(); }, { passive: true });
  syncRSlide();
}
function vResearch(D) {
  const st = S.f.rstatus, q = S.f.q.trim().toLowerCase(), f = S.f;
  const all = S.items.filter(i => i.stage === "research" || i.research);
  const dec = i => (i.research || {}).decision || "pending";
  const K = new Map(all.map(i => [i.id, rCalc(i)]));
  const uniq = fn => [...new Set(all.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const rClients = uniq(i => i.client), rPics = uniq(i => (i.research || {}).pic);
  if (f.rclient !== "all" && !rClients.includes(f.rclient)) f.rclient = "all"; // buyer was renamed or removed
  if (f.rpic !== "all" && !rPics.includes(f.rpic)) f.rpic = "all";
  const byStatus = all.filter(i => {
    if (st === "open") return i.stage === "research" && (dec(i) === "pending" || dec(i) === "hold");
    if (st === "worth") return i.stage === "research" && dec(i) !== "nogo" && K.get(i.id).verdict === "good";
    if (st === "go") return i.stage !== "research" || dec(i) === "go";
    if (st === "nogo") return dec(i) === "nogo";
    return true;
  });
  const passF = i => { const k = K.get(i.id), r = i.research || {};
    if (f.rverdict !== "all" && k.verdict !== f.rverdict) return false;
    if (f.rsample !== "all" && (r.sample || "none") !== f.rsample) return false;
    if (f.rclient !== "all" && (i.client || "") !== f.rclient) return false;
    if (f.rpic !== "all" && (r.pic || "") !== f.rpic) return false;
    if (f.rhassle !== "all" && (r.hassle || "med") !== f.rhassle) return false;
    if (q && ![i.client, i.name, i.variant, i.notes, r.reason].join(" ").toLowerCase().includes(q)) return false;
    return true; };
  const VR = { good: 0, thin: 1, bad: 2, incomplete: 3 }, SR = Object.keys(SAMPLE), DR = { pending: 0, hold: 1, go: 2, nogo: 3 };
  const val = (i, key) => { const k = K.get(i.id), r = i.research || {};
    switch (key) {
      case "profit": return k.total; case "unit": return k.unit; case "pct": return k.pct; case "cost": return k.costPc; case "sell": return k.sell;
      case "market": return k.market; case "modal": return k.modal; case "ship": return k.ship; case "qty": return k.qty;
      case "eta": return i.etaJkt || ""; case "client": return i.client || ""; case "item": return i.name || "";
      case "sample": return SR.indexOf(r.sample || "none"); case "verdict": return VR[k.verdict];
      case "status": return i.stage !== "research" ? 4 : DR[dec(i)];
      default: return i.seq || 0;
    } };
  const key = f.rsortkey || "seq", dir = f.rdir || "asc";
  const isNil = x => x == null || x === "" || (typeof x === "number" && !isFinite(x));
  const list = byStatus.filter(passF).sort((a, b) => {
    const x = val(a, key), y = val(b, key), nx = isNil(x), ny = isNil(y);
    if (nx || ny) return nx && ny ? (a.seq || 0) - (b.seq || 0) : nx ? 1 : -1;
    const d = typeof x === "string" ? x.localeCompare(y, "id", { sensitivity: "base" }) : x - y;
    return (dir === "asc" ? d : -d) || (a.seq || 0) - (b.seq || 0);
  });
  const c = cfg();
  const rows = list.map(i => {
    const r = i.research || {}, k = K.get(i.id);
    return `<tr class="click" data-act="edit-item" data-id="${i.id}">
      <td>${esc(i.client || "—")}<div class="vr">PIC ${esc(r.pic || "—")}</div></td>
      <td><div class="nm">${esc(i.name)}</div>${i.notes ? `<div class="vr">${esc(i.notes)}</div>` : ""}</td>
      <td class="r num">${k.market ? idr(k.market) : "—"}</td>
      <td class="r num">${i.priceCNY ? cny(i.priceCNY) : "—"}<div class="vr">${k.modal != null ? idr(k.modal) : ""}</div></td>
      <td class="r num" title="${esc(k.shipNote)}">${k.ship != null ? idr(k.ship) : "—"}<div class="vr">${k.shipSrc === "est" ? "estimate" : k.shipSrc === "manual" ? "typed in" : "not set"}</div></td>
      <td class="r num"><b>${k.costPc != null ? idr(k.costPc) : "—"}</b></td>
      <td class="r num ${k.vsMarket != null && k.vsMarket < 0 ? "neg" : ""}">${k.sell != null ? idr(k.sell) : "—"}<div class="vr">${k.vsMarket != null ? (k.vsMarket >= 0 ? idrC(k.vsMarket) + " under pasar" : idrC(-k.vsMarket) + " over pasar") : k.sell != null && k.rate ? "≈ " + cny(k.sell / k.rate) : ""}</div></td>
      <td class="r num ${k.unit > 0 ? "pos" : k.unit < 0 ? "neg" : ""}">${k.unit != null ? idr(k.unit) : "—"}<div class="vr">${k.pct != null ? Math.round(k.pct * 100) + "%" : ""}</div></td>
      <td class="r num">${qtyf(k.qty)}<div class="vr">${r.moq ? "MOQ " + nf0.format(r.moq) : ""}</div></td>
      <td class="r num">${k.total != null ? idr(k.total) : "—"}</td>
      <td style="white-space:nowrap">${i.etaJkt ? `${esc(fmtDate(i.etaJkt))}<div class="vr">${etaText(i.etaJkt)}</div>` : r.leadTime ? `<span class="muted">${esc(r.leadTime)}</span>` : "—"}</td>
      <td style="white-space:nowrap">${esc(SAMPLE[r.sample || "none"])}<div class="vr">${k.checks}/4 checks</div></td>
      <td>${verdictChip(k)}</td>
      <td>${i.stage !== "research" ? stageChip(i.stage) : `<span class="chip ${dec(i) === "hold" ? "warn" : dec(i) === "nogo" ? "bad" : ""}">${esc(DECISIONS[dec(i)])}</span>`}</td></tr>`;
  }).join("");
  const open = all.filter(i => i.stage === "research" && dec(i) !== "nogo");
  const opt = (cur, v, l) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
  const sel = (k, allLabel, pairs) => `<select class="in" id="f-${k}" data-act="f" data-k="${k}" aria-label="${esc(allLabel)}">${opt(f[k], "all", allLabel)}${pairs.map(([v, l]) => opt(f[k], v, l)).join("")}</select>`;
  const filtersOn = Object.keys(RFILTER_DEFAULT).some(k => f[k] !== "all") || q;
  const cols = [["Requested by", "client", ""], ["Item", "item", ""], ["Harga pasar", "market", "r"], ["Modal barang", "modal", "r"], ["Ongkir / pc", "ship", "r"], ["Modal + ongkir", "cost", "r"], ["Jual / pc", "sell", "r"], ["Untung / pc", "unit", "r"], ["Qty", "qty", "r"], ["Profit", "profit", "r"], ["ETA Jakarta", "eta", ""], ["Sample", "sample", ""], ["Verdict", "verdict", ""], ["Status", "status", ""]];
  const th = cols.map(([l, k, cl]) => `<th class="${cl}" aria-sort="${key === k ? (dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="thbtn" data-act="rsort" data-id="${k}" title="Sort by ${esc(l)}">${esc(l)}<span aria-hidden="true">${key === k ? (dir === "asc" ? " ▲" : " ▼") : ""}</span></button></th>`).join("");
  return `<section class="row"><div><div class="eyebrow">Before To buy · sample, modal, margin</div><h2>Research</h2></div><span class="spacer"></span>
      <button class="btn primary" data-act="new-research">+ New request</button></section>
    <div class="muted small">A buyer asks for an item → the team checks supplier, sample and price → the app compares margin against your targets (${c.minMarginPct ?? 20}% margin and ${idrC(c.minProfitIDR ?? 300000)} profit per order, ×1.5 for medium and ×2 for high hassle; change them in Settings) → approve to move it to <b>To buy</b>.</div>
    <div class="filters"><input class="in" id="f-q" type="search" placeholder="Search buyer or item…" value="${esc(S.f.q)}" data-act="f" data-k="q">
      <div class="seg" role="group">${[["open", `Open (${all.filter(i => i.stage === "research" && ["pending", "hold"].includes(dec(i))).length})`], ["worth", `Worth it (${open.filter(i => K.get(i.id).verdict === "good").length})`], ["go", "Approved"], ["nogo", "No go"], ["all", "All"]].map(([k, l]) => `<button data-act="rstatus" data-id="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div></div>
    <div class="filters">
      ${sel("rverdict", "All verdicts", [["good", "Worth it"], ["thin", "Thin"], ["bad", "Not worth it"], ["incomplete", "Need data"]])}
      ${sel("rsample", "All samples", Object.entries(SAMPLE))}
      ${sel("rclient", "All buyers", rClients.map(x => [x, x]))}
      ${sel("rpic", "All PICs", rPics.map(x => [x, x]))}
      ${sel("rhassle", "All hassle levels", Object.entries(HASSLE).map(([v, l]) => [v, l.split(" · ")[0]]))}
      ${filtersOn ? `<button class="btn ghost sm" data-act="rclear">Clear filters</button>` : ""}
      <span class="spacer"></span>
      <span class="sortbox"><label class="small muted" for="f-rsort">Sort</label>
        <select class="in" id="f-rsort" data-act="rsortsel" aria-label="Sort by">${RSORTS.map(([v, l]) => opt(key, v, l)).join("")}</select>
        <button class="btn sm" data-act="rdir" title="Reverse order" aria-label="${dir === "asc" ? "Ascending, tap for descending" : "Descending, tap for ascending"}">${dir === "asc" ? "↑ Low–high" : "↓ High–low"}</button></span>
    </div>
    <div class="muted small">Showing ${list.length} of ${byStatus.length}${list.length !== byStatus.length ? " · filters on" : ""}. Tap a column heading to sort by it.</div>
    <section class="panel"><div class="hslide" id="rslidebar" hidden><span class="small muted" aria-hidden="true">◀</span><input type="range" id="rslide" min="0" max="1000" value="0" aria-label="Slide the table sideways"><span class="small muted" aria-hidden="true">▶</span></div>
    <div class="tablewrap" id="rwrap"><table class="t"><thead><tr>${th}</tr></thead>
    <tbody>${rows || `<tr><td colspan="14" class="empty">No requests match.${filtersOn ? ` <button class="btn sm" data-act="rclear">Clear filters</button>` : ""}</td></tr>`}</tbody></table></div></section>`;
}

// ---- Settings ----
function vSettings() {
  const c = cfg();
  const counts = {}; for (const it of S.items) counts[it.client] = (counts[it.client] || 0) + 1;
  const names = clientNames();
  const clientsCfg = Object.fromEntries((c.clients || []).map(x => [x.name, x]));
  return `<section><div class="eyebrow">Your account &amp; defaults</div><h2>Settings</h2></section>
  <div class="grid2">
  <section class="panel"><div class="panel-h"><h3>Your profile</h3></div><div class="panel-b" style="display:flex;flex-direction:column;gap:14px">
    <div class="me-card">${S.me ? `<img alt="" src="${esc(S.me.avatarUrl)}">` : ""}<div class="who"><b id="set-name"></b><span id="set-email"></span></div></div>
    <div class="row"><span class="chip acc">${esc(S.role || "Signed in")}</span><span class="muted small">Changes you make are logged under your name in each item's history.</span></div>
    ${S.user && S.user.public ? "" : `<div class="row"><button class="btn danger" data-act="logout">Log out</button></div>`}
  </div></section>
  ${S.user && S.user.changePassword ? `<section class="panel"><div class="panel-h"><div><h3>Password</h3><div class="muted small">At least 8 characters.</div></div></div><div class="panel-b"><form class="form" data-form="password" autocomplete="off">
    <div class="field"><label for="pw-1">New password</label><input class="in" id="pw-1" name="pw1" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="field"><label for="pw-2">Repeat new password</label><input class="in" id="pw-2" name="pw2" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="full row"><button class="btn primary" type="submit">Change password</button></div>
  </form></div></section>` : ""}
  ${S.role === "Owner" && S.user && S.user.listMembers ? teamPanel() : ""}
  <section class="panel"><div class="panel-h"><div><h3>Appearance</h3><div class="muted small">Saved on this device only.</div></div></div><div class="panel-b" style="display:flex;flex-direction:column;gap:10px">
    ${themeSeg()}
    <span class="muted small">System follows your phone or computer setting.</span>
  </div></section>
  <section class="panel"><div class="panel-h"><h3>Kurs &amp; ongkir</h3></div><div class="panel-b"><form class="form" data-form="config">
    <div class="field"><label for="c-k">Kurs Eve/Didi (IDR per ¥)</label><input class="in num" id="c-k" name="kursEveDidi" inputmode="decimal" value="${c.kursEveDidi}"><span class="hint">Used for new order lines</span></div>
    <div class="field"><label for="c-m">Market kurs</label><input class="in num" id="c-m" name="marketRate" inputmode="decimal" value="${c.marketRate}"><span class="hint">For reference in the header</span></div>
    <div class="field"><label for="c-q">Kurs for new research</label><input class="in num" id="c-q" name="quoteRate" inputmode="decimal" value="${c.quoteRate}"></div>
    <div class="field"><label for="c-mm">Minimum margin %</label><input class="in num" id="c-mm" name="minMarginPct" inputmode="decimal" value="${c.minMarginPct}"><span class="hint">Research verdict: untung ÷ harga jual</span></div>
    <div class="field"><label for="c-mp">Minimum profit per order (IDR)</label><input class="in num" id="c-mp" name="minProfitIDR" inputmode="decimal" value="${c.minProfitIDR}"><span class="hint">×1.5 medium hassle, ×2 high hassle</span></div>
    <div class="field full"><label for="c-p">Jastippers &amp; team (one per line)</label><textarea class="in" id="c-p" name="people">${esc((c.people || []).join("\n"))}</textarea><span class="hint">Shown as choices for “who has it now”</span></div>
    <div class="full row"><button class="btn primary" type="submit">Save settings</button></div>
  </form></div></section>
  <section class="panel"><div class="panel-h"><div><h3>Clients</h3><div class="muted small">Mark your own businesses so they're not counted as money owed.</div></div></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Client</th><th class="r">Lines</th><th>Own business</th><th>Rename / merge into</th></tr></thead><tbody>
    ${names.map((n, i) => `<tr><td>${esc(n)}</td><td class="r num">${counts[n] || 0}</td>
      <td><label class="check"><input type="checkbox" data-act="client-int" data-id="${esc(n)}" ${clientsCfg[n]?.internal ? "checked" : ""}> Internal</label></td>
      <td><div class="row" style="flex-wrap:nowrap"><input class="in" id="rn-${i}" list="dl-clients" placeholder="New name" style="min-width:120px"><button class="btn sm" data-act="client-rename" data-id="${esc(n)}" data-in="rn-${i}">Apply</button></div></td></tr>`).join("")}
    </tbody></table></div>
    <datalist id="dl-clients">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
  </section>
  <section class="panel" style="grid-column:1/-1"><div class="panel-h"><div><h3>Ongkir rates</h3><div class="muted small">Ongkir is part of modal. The app estimates it per line from weight, size and value, and uses the real shipment cost once you enter it.</div></div></div>
    <form data-form="rates"><div class="tablewrap"><table class="t"><thead><tr><th>Route</th><th class="r">¥ / kg</th><th class="r">¥ / CBM</th><th class="r">Volume divisor</th><th class="r">Min kg</th><th class="r">% of item value</th><th class="r">Flat Rp / line</th></tr></thead><tbody>
      ${Object.keys(DEFAULT_RATES).map(m => { const R = c.shipRates[m]; return `<tr><td>${esc(METHODS[m])}</td>${["perKgCNY", "perCbmCNY", "divisor", "minKg", "valuePct", "flatIDR"].map(k => `<td class="r"><input class="in num" style="width:100px;text-align:right" id="rt-${m}-${k}" name="${m}.${k}" inputmode="decimal" value="${R[k] || ""}" placeholder="0"></td>`).join("")}</tr>`; }).join("")}
    </tbody></table></div>
    <div class="panel-b" style="display:flex;flex-direction:column;gap:10px">
      <ul class="reasons">
        <li><b>Chargeable kg</b> = the higher of real weight and volume weight (P × L × T cm ÷ divisor). Air cargo usually uses 6000; leave 0 to ignore size.</li>
        <li><b>Sea cargo</b> can charge per kg or per CBM; the app takes whichever is higher.</li>
        <li><b>% of item value</b> covers jastipper fees, insurance or tax that grow with the price of the item.</li>
        <li><b>Flat Rp</b> is added once per line estimate (packing, local courier to the Jakarta team).</li>
      </ul>
      <div class="row"><button class="btn primary" type="submit">Save rates</button></div>
    </div></form>
  </section>
  </div>`;
}

function teamPanel() {
  const ms = S.members || [];
  const label = { pending: "Waiting for approval", viewer: "Viewer (read only)", editor: "Editor", owner: "Owner" };
  const waiting = ms.filter(m => m.role === "pending").length;
  return `<section class="panel" style="grid-column:1/-1"><div class="panel-h"><div><h3>Team</h3><div class="muted small">Invite people in Supabase (Authentication → Users → Invite). Editors can change data, viewers can only look. ${waiting ? `<b>${waiting} waiting for approval.</b>` : ""}</div></div></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Access</th></tr></thead><tbody>
    ${S.members === null ? `<tr><td colspan="3" class="muted">Loading…</td></tr>` : ms.map(m => `<tr><td>${esc(m.name || "—")}${m.id === myId() ? ` <span class="chip">you</span>` : ""}</td><td>${esc(m.email || "")}</td>
      <td><select class="in" data-act="member-role" data-id="${esc(m.id)}" aria-label="Access for ${esc(m.name || m.email)}">${["pending", "viewer", "editor", "owner"].map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${label[r]}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div></section>`;
}
async function loadMembers() {
  if (S.membersLoading || !S.user || !S.user.listMembers) return;
  S.membersLoading = true;
  try { S.members = await S.user.listMembers(); } catch (e) { S.members = []; toast("Couldn't load the team list.", true); }
  S.membersLoading = false; schedule();
}

// ---- bulk bar ----
function fillSettingsNames() {
  if ($("#set-name")) $("#set-name").textContent = (S.me && S.me.name) || "Signed in";
  if ($("#set-email")) $("#set-email").textContent = (S.me && S.me.email) || "";
}
function renderBulk(D) {
  const el = $("#bulk");
  const ids = [...S.sel].filter(id => S.items.some(i => i.id === id));
  if (!ids.length || !["tracker", "orders"].includes(S.tab)) { el.innerHTML = ""; return; }
  const c = cfg();
  el.innerHTML = `<div class="bulk" role="region" aria-label="Bulk actions">
    <span><b>${ids.length}</b> selected</span>
    <select class="in" id="b-stage" aria-label="Move to stage"><option value="">Move to…</option>${STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join("")}</select>
    <input class="in" id="b-holder" list="dl-people" placeholder="Who has it now" style="width:140px">
    <button class="btn" data-act="bulk-move">Apply</button>
    <select class="in" id="b-ship" aria-label="Put in shipment"><option value="">Put in shipment…</option><option value="__none">Remove from shipment</option>${S.shipments.filter(s => s.stage !== "delivered").map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
    <button class="btn" data-act="bulk-ship">Assign</button>
    <input class="in" type="date" id="b-eta" aria-label="ETA sampai Jakarta" style="width:150px">
    <button class="btn" data-act="bulk-eta">Set ETA</button>
    <button class="btn" data-act="bulk-paid" data-id="1">Mark paid</button>
    <button class="btn" data-act="bulk-paid" data-id="0">Mark unpaid</button>
    <button class="btn" data-act="bulk-ok">Checked ✓</button>
    <button class="btn" data-act="bulk-dup">Duplicate</button>
    <span class="spacer"></span>
    <button class="btn ghost" data-act="bulk-clear" style="color:var(--bg)">Clear</button>
    <datalist id="dl-people">${(c.people || []).map(p => `<option value="${esc(p)}">`).join("")}<option value="End buyer"></datalist>
  </div>`;
}

// ---------- drawers ----------
function openDrawer(kind, id, extra) { S.drawer = { kind, id, extra, confirmDel: false }; renderDrawer(); }
function closeDrawer() { S.drawer = null; $("#drawer").innerHTML = ""; }
function renderDrawer() {
  const d = S.drawer; if (!d) return;
  const fn = { item: dItem, ship: dShip, batch: dBatch }[d.kind];
  const { title, sub, body, foot } = fn(d);
  $("#drawer").innerHTML = `<div class="scrim" data-act="close"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="drawer-h"><div style="flex:1;min-width:0"><div class="eyebrow">${esc(sub)}</div><h2>${esc(title)}</h2></div><button class="btn ghost" data-act="close" aria-label="Close">✕</button></div>
      <form class="drawer-b" id="dform" data-form="${d.kind}">${body}</form>
      <div class="drawer-f">${foot}</div>
    </aside>`;
  const first = $("#dform input:not([type=checkbox]), #dform select"); if (first && !d.id) first.focus();
  resolveWho($("#drawer"));
  updateCalc();
}
const fld = (label, name, val, o = {}) => `<div class="field ${o.full ? "full" : ""}"><label for="d-${name}">${label}</label>${
  o.select ? `<select class="in" id="d-${name}" name="${name}">${o.select.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`
  : o.area ? `<textarea class="in" id="d-${name}" name="${name}">${esc(val)}</textarea>`
  : `<input class="in ${o.num ? "num" : ""}" id="d-${name}" name="${name}" ${o.type ? `type="${o.type}"` : ""} ${o.num ? `inputmode="decimal"` : ""} ${o.list ? `list="${o.list}"` : ""} value="${esc(val ?? "")}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ""}>`
}${o.hint ? `<span class="hint">${o.hint}</span>` : ""}</div>`;
const chk = (label, name, val) => `<label class="check"><input type="checkbox" id="d-${name}" name="${name}" ${val ? "checked" : ""}> ${label}</label>`;
const delFoot = (d, what) => d.id ? (d.confirmDel ? `<span class="small">Delete this ${what} for everyone?</span><button type="button" class="btn danger" data-act="del-confirm">Yes, delete</button><button type="button" class="btn ghost" data-act="del-cancel">Keep</button>` : `<button type="button" class="btn ghost" data-act="del-ask" style="color:var(--seal)">Delete</button>`) : "";

function etaField(it) {
  const sh = it.shipmentId && S.shipments.find(s => s.id === it.shipmentId);
  const lt = (it.research || {}).leadTime;
  return `<div class="field"><label for="d-etaJkt">ETA sampai Jakarta</label>
    <input class="in" type="date" id="d-etaJkt" name="etaJkt" value="${esc(it.etaJkt || "")}">
    <span class="hint" id="etahint">${it.etaJkt ? etaText(it.etaJkt) : sh && sh.eta ? "Empty, so using shipment ETA " + fmtDate(sh.eta) : "Tap to pick the date it should reach Jakarta"}${lt ? " · lead time noted: " + esc(lt) : ""}</span></div>`;
}
function dItem(d) {
  const c = cfg();
  const it = d.id ? S.items.find(x => x.id === d.id) || {} : { batch: S.f.batch !== "all" ? S.f.batch : (sortedBatches()[0]?.id || ""), client: S.f.client !== "all" ? S.f.client : "", qty: 1, rate: c.kursEveDidi, stage: "to_buy", paid: false, ...(d.extra || {}) };
  const bs = sortedBatches();
  const hist = (it.history || []).slice().reverse();
  const isR = it.stage === "research";
  const r = { decision: "pending", sample: "none", hassle: "med", ...(it.research || {}) };
  const researchBlock = (isR || it.research) ? `
    <div><div class="eyebrow" style="margin-bottom:8px">Research check</div><div class="form">
      ${fld("PIC", "r_pic", r.pic, { list: "dl-people2" })}
      ${fld("Decision", "r_decision", r.decision, { select: Object.entries(DECISIONS) })}
      ${fld("Harga pasar Indo / pc (IDR)", "r_market", idrIn(r.marketIDR), { num: true, hint: "What the buyer pays locally" })}
      ${fld("MOQ", "r_moq", r.moq ?? "", { num: true })}
      ${etaField(it)}
      ${fld("Logo", "r_logo", r.logo || "", { select: [["", "—"], ["WHITE LABEL", "White label"], ["LOGO", "Custom logo"], ["HARGA ONLY", "Price check only"]] })}
      ${fld("Hassle", "r_hassle", r.hassle, { select: Object.entries(HASSLE), hint: "More hassle needs more profit" })}
      ${fld("Sample", "r_sample", r.sample, { select: Object.entries(SAMPLE) })}
      ${fld("Sample cost (IDR)", "r_samplecost", r.sampleCostIDR ? idrIn(r.sampleCostIDR) : "", { num: true, hint: "Taken off the profit" })}
      <div class="full" style="display:grid;gap:6px">
        ${chk("Supplier found and price confirmed", "r_supplierOk", r.supplierOk)}
        ${chk("Buyer agreed on the sell price", "r_customerOk", r.customerOk)}
        ${chk("Down payment received", "r_dpOk", r.dpOk)}
      </div>
      ${fld("Findings / reason", "r_reason", r.reason, { full: true, area: true })}
    </div></div>
    <div class="calc" id="rcalc"></div>` : "";
  const decide = isR && d.id ? `
    <div class="panel" style="box-shadow:none"><div class="panel-b" style="display:flex;flex-direction:column;gap:10px">
      <h3>Decide</h3>
      <div class="form">
        ${fld("Add to PO", "ap_batch", bs[0]?.id || "", { select: [["", "— no PO yet —"], ...bs.map(b => [b.id, b.name])] })}
        ${fld("Qty to buy", "ap_qty", it.qty || r.moq || 1, { num: true })}
      </div>
      <div class="row"><button type="button" class="btn primary" data-act="r-approve">Approve → To buy</button><button type="button" class="btn danger" data-act="r-nogo">No go</button></div>
      <span class="muted small">Approve saves your edits and moves the line onto the buy list.</span>
    </div></div>` : "";
  const body = `
    <div class="form">
      ${fld("Item name", "name", it.name, { full: true })}
      ${fld("Variant / spec", "variant", it.variant, { full: true, ph: "Colour, size, SKU text from Taobao" })}
      ${fld("PO / batch", "batch", it.batch, { select: [["", "— none —"], ...bs.map(b => [b.id, b.name])] })}
      ${fld(isR ? "Requested by" : "Client", "client", it.client, { list: "dl-clients2" })}
      ${fld("Shop / supplier", "shop", it.shop)}
      ${fld("Link", "link", it.link, { ph: "https://item.taobao.com/…" })}
    </div>
    <div><div class="eyebrow" style="margin-bottom:8px">Price</div><div class="form">
      ${fld(isR ? "Planned qty" : "Qty", "qty", it.qty, { num: true })}
      ${fld(isR ? "Harga modal ¥ / pc" : "¥ per piece", "priceCNY", it.priceCNY, { num: true })}
      ${fld("Extra ¥ (China ongkir, fees)", "extraCNY", it.extraCNY || "", { num: true })}
      ${fld("Kurs modal (IDR/¥)", "rate", it.rate, { num: true, hint: `Current Eve/Didi kurs: ${nf0.format(c.kursEveDidi)}` })}
      ${fld(isR ? "Harga jual / pc (IDR)" : "Sell price per pc (IDR)", "sellIDR", idrIn(it.sellIDR), { num: true, hint: isR ? "All-in price to the buyer (covers ongkir)" : "All-in, covers ongkir. Empty = pass through at total modal" })}
      ${isR ? `<div class="field"><label for="d-jy">Or from harga jual ¥</label><div class="row" style="flex-wrap:nowrap"><input class="in num" id="d-jy" inputmode="decimal" placeholder="e.g. 13.5"><button type="button" class="btn sm" data-act="apply-jy">Apply</button></div></div>`
        : `<div class="field"><label for="d-kj">Or set from kurs jual</label><div class="row" style="flex-wrap:nowrap"><input class="in num" id="d-kj" inputmode="decimal" placeholder="e.g. 2450"><button type="button" class="btn sm" data-act="apply-kj">Apply</button></div></div>`}
    </div></div>
    <div><div class="eyebrow" style="margin-bottom:8px">Ongkir · masuk modal</div><div class="form">
      ${fld("Route", "route", it.route || "", { select: Object.entries(ROUTES), hint: "Air, sea, jastipper or courier" })}
      ${fld("Berat / pc (kg)", "kgPc", it.kgPc ?? "", { num: true, ph: "e.g. 0.35" })}
      <div class="field full"><label for="d-lcm">Ukuran / pc — P × L × T (cm)</label><div class="row" style="flex-wrap:nowrap">
        <input class="in num" id="d-lcm" name="lcm" inputmode="decimal" placeholder="P" value="${esc(it.lcm ?? "")}"><span class="muted">×</span>
        <input class="in num" id="d-wcm" name="wcm" inputmode="decimal" placeholder="L" value="${esc(it.wcm ?? "")}"><span class="muted">×</span>
        <input class="in num" id="d-hcm" name="hcm" inputmode="decimal" placeholder="T" value="${esc(it.hcm ?? "")}"></div>
        <span class="hint">Bulky but light items are charged by volume</span></div>
      <div class="field full"><label for="d-shipTotalIDR" id="shiplabel">Ongkir total untuk item ini (IDR)</label>
        <div class="row" style="flex-wrap:nowrap">
        <div id="shipcur-wrap" style="flex:none" ${it.route === "handcarry" || it.shipCur === "CNY" ? "" : "hidden"}><select class="in" name="shipCur" id="d-shipCur" aria-label="Currency of the jastipper fee" style="width:auto"><option value="IDR" ${it.shipCur === "CNY" ? "" : "selected"}>IDR</option><option value="CNY" ${it.shipCur === "CNY" ? "selected" : ""}>¥ Yuan</option></select></div>
        <input class="in num" id="d-shipTotalIDR" name="shipTotalIDR" inputmode="decimal" placeholder="e.g. 250000" value="${esc(it.shipCur === "CNY" ? (it.shipTotalCNY ?? "") : idrIn(it.shipTotalIDR ?? (it.shipPcIDR != null && it.shipPcIDR !== "" ? Math.round(num(it.shipPcIDR) * (it.qty || 0)) : (it.research || {}).estShipIDR != null ? Math.round(num(it.research.estShipIDR) * (it.qty || (it.research || {}).moq || 0)) : "")))}"></div>
        <span class="hint" id="shiphint">Total ongkir for all pieces on this line. Leave empty to use the shipment's real bill or the estimate.</span></div>
    </div></div>
    ${isR ? "" : `<div class="calc" id="calc"></div>`}
    ${researchBlock}
    ${decide}
    <div><div class="eyebrow" style="margin-bottom:8px">Location</div><div class="form">
      ${fld("Stage", "stage", it.stage || "to_buy", { select: STAGES.map(s => [s.id, s.label]) })}
      ${fld("Who has it now", "holder", it.holder, { list: "dl-people2", ph: "Eve, Didi, jastipper name, Jakarta team…" })}
      ${(isR || it.research) ? "" : etaField(it)}
      ${fld("Shipment", "shipmentId", it.shipmentId || "", { select: [["", "— not shipped yet —"], ...S.shipments.map(s => [s.id, s.name])] })}
      <div class="full row">${chk("Client has paid", "paid", it.paid)}${chk("Needs a check", "review", it.review)}</div>
      <div class="full muted small">Delivered + paid moves the line to <b>Paid · done</b>.</div>
      ${fld("Notes", "notes", it.notes, { full: true, area: true })}
    </div></div>
    ${hist.length ? `<div><div class="eyebrow" style="margin-bottom:8px">Location history</div><div class="timeline">${hist.map(h => `<div class="tl" style="--dot:var(${(STAGE[h.stage] || STAGE.to_buy).dot})"><div><b>${esc((STAGE[h.stage] || {}).label || h.stage)}</b>${h.holder ? ` · ${esc(h.holder)}` : ""}</div>${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}<div class="when">${esc(fmtDT(h.at))}${byTag(h)}</div></div>`).join("")}</div></div>` : ""}
    <datalist id="dl-clients2">${clientNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <datalist id="dl-people2">${(c.people || []).map(p => `<option value="${esc(p)}">`).join("")}<option value="End buyer"></datalist>`;
  return { title: d.id ? (it.name || "Item") : isR ? "New research request" : "New item", sub: isR ? "Research" : d.id ? (S.batches.find(b => b.id === it.batch)?.name || "Item") : "Add to buy list", body,
    foot: `<button class="btn primary" data-act="save">Save</button><button class="btn ghost" data-act="close">Cancel</button><span class="spacer"></span>${delFoot(d, isR ? "request" : "line")}` };
}

function shipPicker(s, sid) {
  const open = new Set(S.shipments.filter(x => x.stage !== "delivered").map(x => x.id));
  const exists = new Set(S.shipments.map(x => x.id));
  const cand = S.items.filter(i => (sid && i.shipmentId === sid) || (["to_buy", "ordered", "china_wh"].includes(i.stage) && (!i.shipmentId || !exists.has(i.shipmentId))));
  const elsewhere = S.items.filter(i => i.shipmentId && i.shipmentId !== sid && open.has(i.shipmentId) && !ARRIVED.includes(i.stage)).length;
  const groups = {};
  for (const i of cand) (groups[i.batch || ""] = groups[i.batch || ""] || []).push(i);
  const order = [...new Set([s.batch || null, ...sortedBatches().map(b => b.id), ""].filter(x => x !== null))].filter(k => groups[k]);
  const inCount = cand.filter(i => sid && i.shipmentId === sid).length;
  const rows = order.map(k => {
    const b = S.batches.find(x => x.id === k);
    const its = groups[k].sort((a, c) => (a.seq || 0) - (c.seq || 0));
    const all = its.every(i => sid && i.shipmentId === sid);
    return `<div class="pgroup" data-group="${esc(k || "nopo")}">
      <label class="check pghead"><input type="checkbox" data-act="pickall" data-group="${esc(k || "nopo")}" ${all ? "checked" : ""}> <b>${esc(b ? b.name : "No PO")}</b><span class="muted small">${its.length} items</span></label>
      ${its.map(i => `<label class="check prow" data-hay="${esc([i.name, i.variant, i.client].join(" ").toLowerCase())}"><input type="checkbox" data-act="pick" data-group="${esc(k || "nopo")}" value="${i.id}" data-pcs="${i.qty || 0}" ${sid && i.shipmentId === sid ? "checked" : ""}>
        <span class="grow"><span>${esc(i.name)}</span>${i.variant ? ` <span class="muted small">${esc(i.variant)}</span>` : ""}<br><span class="muted small">${esc(i.client || "—")} · ${qtyf(i.qty)} pcs${i.kgPc ? " · " + nf2.format(i.kgPc) + " kg/pc" : ""}</span></span>${stageChip(i.stage)}</label>`).join("")}
    </div>`;
  }).join("");
  return `<div class="picker">
    <div class="row"><div class="eyebrow">Items in this shipment</div><span class="spacer"></span><span class="small" id="pickcount">${inCount} selected</span></div>
    <div class="muted small">Showing items that are bought but not shipped yet (To buy, Ordered, China warehouse)${elsewhere ? ` · ${elsewhere} items already in other open shipments are hidden` : ""}. Tick a PO to add all of its items.</div>
    ${cand.length ? `<input class="in" type="search" id="pick-q" placeholder="Search item or client…">
    <div class="plist">${rows}</div>` : `<div class="empty" style="padding:16px">Nothing waiting to ship. Add items on the Orders tab first.</div>`}
  </div>`;
}
function dShip(d) {
  const c = cfg();
  const s = d.id ? S.shipments.find(x => x.id === d.id) || {} : { method: "air", stage: "packing", dest: "jakarta", batch: S.f.batch !== "all" ? S.f.batch : (sortedBatches()[0]?.id || "") };
  const its = d.id ? S.items.filter(i => i.shipmentId === d.id) : [];
  const hist = (s.history || []).slice().reverse();
  const body = `<div class="form">
    ${fld("Name", "name", s.name, { full: true, ph: "e.g. Sept PO 2 · Legacy Vault by air" })}
    ${fld("PO / batch", "batch", s.batch || "", { select: [["", "— none —"], ...sortedBatches().map(b => [b.id, b.name])] })}
    ${fld("Method", "method", s.method, { select: Object.entries(METHODS) })}
    ${fld("Jastipper / cargo company", "carrier", s.carrier, { list: "dl-people3" })}
    ${fld("Tracking no. (resi)", "tracking", s.tracking)}
    ${fld("Weight (kg)", "kg", s.kg || "", { num: true })}
    ${fld("Ongkir total (IDR) — real bill", "costIDR", s.costIDR ? idrIn(s.costIDR) : "", { num: true, hint: "Goes into each line's modal: split by weight when every line has weight/size, otherwise by value" })}
    ${(() => { const e = d.id ? shipmentEstimate(s) : null; return `<div class="field full"><label>Estimate from rates</label>${e && e.total ? `<div class="row"><span class="small">${nf2.format(e.charge)} kg chargeable (${nf2.format(e.kg)} kg real, ${nf2.format(e.volKg)} kg volume, ${nf2.format(e.cbm)} CBM) → <b class="num">${idr(e.total)}</b></span><button type="button" class="btn sm" data-act="use-ship-est" data-v="${Math.round(e.total)}">Use estimate</button></div>` : `<span class="hint">${d.id ? "Add weight/size on the lines inside, or type the weight above, and set this route's rate in Settings." : "Save the shipment and add lines to get an estimate."}</span>`}</div>`; })()}
    ${fld("Goes to", "dest", s.dest || "jakarta", { select: [["jakarta", "Jakarta team first"], ["buyer", "Straight to end buyer"]] })}
    ${fld("ETA", "eta", s.eta, { type: "date" })}
    ${fld("Status", "stage", s.stage, { select: SHIP_STAGES.map(x => [x.id, x.label]), hint: "Changing it moves every line in this shipment" })}
    ${fld("Location note", "locnote", "", { ph: "e.g. at Guangzhou warehouse, landed CGK" })}
    ${fld("Notes", "note", s.note, { full: true, area: true })}
  </div>
  ${shipPicker(s, d.id)}
  ${hist.length ? `<div><div class="eyebrow" style="margin-bottom:8px">History</div><div class="timeline">${hist.map(h => `<div class="tl"><div><b>${esc((SHIP_STAGES.find(x => x.id === h.stage) || {}).label || h.stage)}</b></div>${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}<div class="when">${esc(fmtDT(h.at))}${byTag(h)}</div></div>`).join("")}</div></div>` : ""}
  <datalist id="dl-people3">${(c.people || []).map(p => `<option value="${esc(p)}">`).join("")}</datalist>`;
  return { title: d.id ? s.name : "New shipment", sub: "Shipment", body, foot: `<button class="btn primary" data-act="save">Save</button><button class="btn ghost" data-act="close">Cancel</button><span class="spacer"></span>${delFoot(d, "shipment")}` };
}

function dBatch(d) {
  const b = d.id ? S.batches.find(x => x.id === d.id) || {} : { month: todayStr().slice(0, 7) };
  const n = d.id ? S.items.filter(i => i.batch === d.id).length : 0;
  const body = `<div class="form">
    ${fld("PO name", "name", b.name, { full: true, ph: "e.g. October PO 1 2026" })}
    ${fld("Month", "month", b.month, { type: "month" })}
    ${fld("Notes", "note", b.note, { full: true, area: true })}
  </div>${d.id ? `<div class="muted small">${n} lines in this PO.${n ? " Move or delete them before deleting the PO." : ""}</div>` : ""}`;
  return { title: d.id ? b.name : "New PO", sub: "PO / batch", body, foot: `<button class="btn primary" data-act="save">Save</button><button class="btn ghost" data-act="close">Cancel</button><span class="spacer"></span>${n ? "" : delFoot(d, "PO")}` };
}

function formData() {
  const f = $("#dform"); const o = {};
  for (const el of f.elements) { if (!el.name) continue; o[el.name] = el.type === "checkbox" ? el.checked : el.value; }
  return o;
}
function updateCalc() {
  const d = S.drawer; if (!d) return;
  if (d.kind !== "item") return;
  const v = formData();
  if ($("#etahint") && v.etaJkt) { const days = daysUntil(v.etaJkt); $("#etahint").innerHTML = `<b>${etaText(v.etaJkt)}</b>${days != null && days >= 0 ? ` · lead time ${days} hari dari hari ini` : ""}`; }
  if ($("#shiphint")) {
    const q = num(v.qty) || num(v.r_moq);
    const isJ = v.route === "handcarry", cur = v.shipCur === "CNY" ? "CNY" : "IDR";
    const t = cur === "CNY" ? numOrNull(v.shipTotalIDR) : numIdOrNull(v.shipTotalIDR);
    const cw = $("#shipcur-wrap"); if (cw) cw.hidden = !(isJ || cur === "CNY");
    const sl = $("#shiplabel"); if (sl) sl.textContent = `Ongkir total untuk item ini (${cur === "CNY" ? "¥ yuan" : "IDR"})`;
    const si = $("#d-shipTotalIDR"); if (si) si.placeholder = cur === "CNY" ? "e.g. 120" : "e.g. 250000";
    if (t != null && cur === "CNY") { const rate = numId(v.rate) || cfg().kursEveDidi, tot = t * rate; $("#shiphint").innerHTML = `${cny(t)} × kurs ${nf0.format(rate)} = <b class="num">${idr(tot)} total</b> · <b class="num">${idr(q ? tot / q : 0)} per pc</b> (÷ ${qtyf(q)} pcs)`; }
    else if (t != null) $("#shiphint").innerHTML = `<b class="num">= ${idr(q ? t / q : 0)} per pc</b> (${idr(t)} ÷ ${qtyf(q)} pcs)`;
    else {
      const old = d.id ? S.items.find(i => i.id === d.id) || {} : (d.extra || {});
      const tmp = { ...buildItem(v, old), id: d.id || "__new" };
      const x = derive(S.items.filter(i => i.id !== tmp.id).concat([tmp])).X.get(tmp.id);
      $("#shiphint").innerHTML = x.alloc ? `Empty, so using ${x.shipSrc === "actual" ? "the shipment's real bill" : "the estimate"}: <b class="num">${idr(x.alloc)} total = ${idr(x.shipPc)} per pc</b>` : "Total ongkir for all pieces on this line. Leave empty to use the shipment's real bill or the estimate.";
    }
  }
  if ($("#calc")) {
    const old = d.id ? S.items.find(i => i.id === d.id) || {} : (d.extra || {});
    const tmp = { ...buildItem(v, old), id: d.id || "__new" };
    const D = derive(S.items.filter(i => i.id !== tmp.id).concat([tmp]));
    const x = D.X.get(tmp.id);
    const src = { actual: "from shipment", est: "estimate", manual: "total typed in", none: "not set" }[x.shipSrc];
    $("#calc").innerHTML = `<span>Modal barang (${qtyf(tmp.qty)} × ${cny(tmp.priceCNY)}${tmp.extraCNY ? " + " + cny(tmp.extraCNY) : ""}) × ${nf0.format(tmp.rate)}</span><span class="num">${idr(x.modal)}</span>
      <span>Ongkir · ${src}<div class="muted small">${esc(x.shipNote || "")}</div></span><span class="num">${x.alloc ? idr(x.alloc) : "—"}</span>
      <span class="tot">Total modal</span><span class="num tot">${idr(x.landed)}</span>
      <span><b>Modal / pc incl. ongkir</b>${x.alloc ? `<div class="muted small">barang ${idr(tmp.qty ? x.modal / tmp.qty : 0)} + ongkir ${idr(x.shipPc)}</div>` : ""}</span><span class="num"><b>${idr(x.perPc)}</b></span>
      <span>Client pays</span><span class="num">${x.isInt ? "— own business" : idr(x.billed)}</span>
      <span>Margin</span><span class="num ${x.profit < 0 ? "neg" : "pos"}">${x.isInt ? "—" : idr(x.profit)}</span>`;
  }
  if ($("#rcalc")) {
    const old = d.id ? S.items.find(i => i.id === d.id) || {} : (d.extra || {});
    const k = rCalc(buildItem(v, old));
    const hx = { low: "low", med: "medium", high: "high" }[v.r_hassle] || "medium";
    $("#rcalc").innerHTML = `<span>Modal barang / pc (${cny(num(v.priceCNY))} × ${nf0.format(k.rate)})</span><span class="num">${idr(k.modal)}</span>
      <span>Ongkir / pc<div class="muted small">${esc(k.shipNote || "")}</div></span><span class="num">${k.ship != null ? idr(k.ship) : "—"}</span>
      <span class="tot">Modal / pc incl. ongkir</span><span class="num tot">${idr(k.costPc)}</span>
      <span>Harga jual / pc</span><span class="num">${idr(k.sell)}</span>
      <span><b>Untung / pc</b></span><span class="num ${k.unit < 0 ? "neg" : "pos"}"><b>${k.unit != null ? idr(k.unit) + (k.pct != null ? ` · ${Math.round(k.pct * 100)}%` : "") : "—"}</b></span>
      <span>vs harga pasar Indo</span><span class="num ${k.vsMarket < 0 ? "neg" : ""}">${k.vsMarket != null ? (k.vsMarket >= 0 ? idr(k.vsMarket) + " cheaper" : idr(-k.vsMarket) + " more expensive") : "—"}</span>
      <span>Profit at ${qtyf(k.qty)} pcs${k.sampleCost ? " − sample" : ""}</span><span class="num">${idr(k.total)}</span>
      <span>Target (${hx} hassle)</span><span class="num">${Math.round(k.needPct * 100)}% · ${idr(k.needProfit)}</span>
      <div class="verdict"><div class="row">${verdictChip(k)}<span class="muted small">${k.checks}/4 checks done</span></div>${k.reasons.length ? `<ul class="reasons">${k.reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="small">Margin and profit clear your targets.</span>`}</div>`;
  }
}

// ---------- actions ----------
async function save() {
  const d = S.drawer; const v = formData();
  if (d.kind === "item") {
    const old = d.id ? S.items.find(x => x.id === d.id) || {} : (d.extra || {});
    const id = d.id || uid();
    const it = buildItem(v, old);
    if (myId()) it.updatedBy = myId();
    if (!it.name) { toast("Give the item a name first.", true); return; }
    if (!d.id) it.seq = Math.max(0, ...S.items.map(i => i.seq || 0)) + 1;
    if (!d.id || old.stage !== it.stage || (old.holder || "") !== it.holder) it.history = pushHistory(d.id ? old : {}, it.stage, d.id ? "Edited" : (it.stage === "research" ? "Buyer request logged" : "Added"), it.holder);
    await ensureClient(it.client);
    if (await write("items/" + id, it)) { toast(d.id ? "Saved" : it.stage === "research" ? "Request added to Research" : "Item added"); closeDrawer(); }
  } else if (d.kind === "ship") {
    const old = d.id ? S.shipments.find(x => x.id === d.id) || {} : {};
    const id = d.id || uid();
    const s = { ...old, name: v.name.trim() || "Shipment", batch: v.batch, method: v.method, carrier: v.carrier.trim(), tracking: v.tracking.trim(), kg: num(v.kg), costIDR: numId(v.costIDR), dest: v.dest, eta: v.eta, stage: v.stage, note: v.note };
    const changed = !d.id || old.stage !== s.stage;
    if (changed) s.history = [...(old.history || []).slice(-29), { stage: s.stage, at: nowISO(), note: v.locnote || "", by: myId() }];
    else if (v.locnote) s.history = [...(old.history || []).slice(-29), { stage: s.stage, at: nowISO(), note: v.locnote, by: myId() }];
    const boxes = [...document.querySelectorAll('#dform input[data-act="pick"]')];
    const picked = new Set(boxes.filter(b => b.checked).map(b => b.value));
    const shown = new Set(boxes.map(b => b.value));
    const routeOf = { air: "air", sea: "sea", handcarry: "handcarry", courier: "courier" }[s.method] || "";
    if (await write("shipments/" + id, s)) {
      const kept = [], added = [], removed = [];
      for (const i of S.items) {
        const inNow = i.shipmentId === id && !!d.id;
        if (shown.has(i.id) && picked.has(i.id) && !inNow) added.push({ ...i, shipmentId: id, route: routeOf || i.route || "" });
        else if (shown.has(i.id) && !picked.has(i.id) && inNow) removed.push({ ...i, shipmentId: "" });
        else if (inNow) kept.push(i);
      }
      const moveKept = d.id && old.stage !== s.stage;
      const moveAdded = s.stage !== "packing";
      const toMove = [...(moveKept ? kept : []), ...(moveAdded ? added : [])];
      const quiet = moveAdded ? [] : added;
      await writeMany([...quiet.map(i => ["items/" + i.id, { ...i, history: pushHistory(i, i.stage, "Added to " + s.name, i.holder), updatedAt: nowISO() }]),
        ...removed.map(i => ["items/" + i.id, { ...i, updatedAt: nowISO() }])]);
      if (toMove.length) await propagateShip({ ...s, id }, v.locnote, toMove);
      toast(`Shipment saved${added.length ? ` · ${added.length} items added` : ""}${removed.length ? ` · ${removed.length} removed` : ""}`); closeDrawer();
    }
  } else if (d.kind === "batch") {
    const old = d.id ? S.batches.find(x => x.id === d.id) || {} : {};
    const id = d.id || uid();
    if (!v.name.trim()) { toast("Give the PO a name.", true); return; }
    if (await write("batches/" + id, { ...old, name: v.name.trim(), month: v.month, note: v.note })) { toast("PO saved"); closeDrawer(); if (!d.id) { S.f.batch = id; render(); } }
  }
}
function buildItem(v, old) {
  const it = { ...old, name: (v.name || "").trim(), variant: (v.variant || "").trim(), batch: v.batch || "", client: (v.client || "").trim().toUpperCase(), shop: (v.shop || "").trim(), link: (v.link || "").trim(),
    qty: num(v.qty), priceCNY: num(v.priceCNY), extraCNY: num(v.extraCNY), rate: numId(v.rate), sellIDR: numIdOrNull(v.sellIDR),
    stage: v.stage || old.stage || "to_buy", etaJkt: "etaJkt" in v ? (v.etaJkt || "") : (old.etaJkt || ""), holder: (v.holder || "").trim(), shipmentId: v.shipmentId || "", route: v.route || "", paid: !!v.paid, review: !!v.review, notes: v.notes || "", updatedAt: nowISO() };
  if ("kgPc" in v) { it.kgPc = numOrNull(v.kgPc); it.lcm = numOrNull(v.lcm); it.wcm = numOrNull(v.wcm); it.hcm = numOrNull(v.hcm); const cur = v.shipCur === "CNY" ? "CNY" : "IDR", sv = cur === "CNY" ? numOrNull(v.shipTotalIDR) : numIdOrNull(v.shipTotalIDR); it.shipCur = cur; it.shipTotalIDR = cur === "IDR" ? sv : null; it.shipTotalCNY = cur === "CNY" ? sv : null; delete it.shipPcIDR; }
  if ("r_decision" in v) {
    it.research = { ...(old.research || {}), pic: (v.r_pic || "").trim(), decision: v.r_decision, marketIDR: numIdOrNull(v.r_market), moq: numOrNull(v.r_moq),
      logo: v.r_logo || "", hassle: v.r_hassle || "med", sample: v.r_sample || "none", sampleCostIDR: numId(v.r_samplecost), supplierOk: !!v.r_supplierOk, customerOk: !!v.r_customerOk, dpOk: !!v.r_dpOk, reason: v.r_reason || "" };
    if (!it.research.requestedAt) it.research.requestedAt = nowISO();
    delete it.research.estShipIDR;
  }
  if (it.stage === "paid" && !it.paid && old.stage === "paid") it.stage = "delivered";
  else if (it.stage === "paid") it.paid = true;
  else if (it.stage === "delivered" && it.paid) it.stage = "paid";
  return it;
}
async function ensureClient(name) {
  if (!name) return;
  const c = cfg();
  if ((c.clients || []).some(x => x.name === name)) return;
  await write("config/main", { ...c, clients: [...(c.clients || []), { name, internal: false }] });
}
function shipItemStage(s) {
  return { packing: "china_wh", departed: "in_transit", arrived: s.dest === "buyer" ? "delivering" : "jakarta", delivered: "delivered" }[s.stage];
}
async function propagateShip(s, note, only) {
  const stage = shipItemStage(s);
  const holder = s.stage === "departed" ? (s.carrier || METHODS[s.method] || "") : s.stage === "arrived" ? (s.dest === "buyer" ? (s.carrier || "Jastipper") : "Jakarta team") : s.stage === "delivered" ? "End buyer" : (s.carrier || "China warehouse");
  const its = only || S.items.filter(i => i.shipmentId === s.id);
  const D = derive();
  const list = its.map(i => { const st = stage === "delivered" && (i.paid || D.X.get(i.id)?.isInt) ? "paid" : stage; return ["items/" + i.id, { ...i, stage: st, holder, paid: st === "paid" ? true : i.paid, history: pushHistory(i, st, `${s.name}: ${(SHIP_STAGES.find(x => x.id === s.stage) || {}).label}${note ? " · " + note : ""}`, holder), updatedAt: nowISO() }]; });
  const ok = await writeMany(list);
  if (its.length) toast(`Moved ${ok} lines to ${STAGE[stage].label}${stage === "delivered" ? " / Paid" : ""}`);
}
async function shipNext(id) {
  const s = S.shipments.find(x => x.id === id); if (!s) return;
  const i = SHIP_STAGES.findIndex(x => x.id === s.stage); const nx = SHIP_STAGES[i + 1]; if (!nx) return;
  const ns = { ...s, stage: nx.id, history: [...(s.history || []).slice(-29), { stage: nx.id, at: nowISO(), note: "", by: myId() }] };
  if (await write("shipments/" + id, ns)) await propagateShip(ns, "");
}
async function bulkMove() {
  const stage = $("#b-stage").value, holder = $("#b-holder").value.trim();
  if (!stage && !holder) { toast("Pick a stage or type who has it now.", true); return; }
  const its = S.items.filter(i => S.sel.has(i.id));
  const list = its.map(i => { let st = stage || i.stage; const h = holder || i.holder || ""; let paid = i.paid; if (st === "paid") paid = true; else if (st === "delivered" && paid) st = "paid"; return ["items/" + i.id, { ...i, stage: st, paid, holder: h, history: pushHistory(i, st, "Bulk update", h), updatedAt: nowISO() }]; });
  const ok = await writeMany(list); toast(`Updated ${ok} lines`); S.sel.clear(); render();
}
async function bulkSet(patch, msg) {
  const its = S.items.filter(i => S.sel.has(i.id));
  const ok = await writeMany(its.map(i => ["items/" + i.id, { ...i, ...patch, updatedAt: nowISO() }]));
  toast(`${msg}: ${ok} lines`); S.sel.clear(); render();
}
async function bulkShip(v) {
  const its = S.items.filter(i => S.sel.has(i.id));
  if (v === "__none") { const ok = await writeMany(its.map(i => ["items/" + i.id, { ...i, shipmentId: "", updatedAt: nowISO() }])); toast(`Removed from shipment: ${ok} lines`); S.sel.clear(); render(); return; }
  const s = S.shipments.find(x => x.id === v); if (!s) { toast("That shipment no longer exists.", true); return; }
  const routeOf = { air: "air", sea: "sea", handcarry: "handcarry", courier: "courier" }[s.method] || "";
  const linked = its.map(i => ({ ...i, shipmentId: v, route: routeOf || i.route || "", updatedAt: nowISO() }));
  const move = s.stage !== "packing" ? linked.filter(i => ["to_buy", "ordered", "china_wh"].includes(i.stage)) : [];
  const stay = linked.filter(i => !move.includes(i));
  await writeMany(stay.map(i => ["items/" + i.id, i]));
  if (move.length) await propagateShip({ ...s, id: v }, "", move); // same as the shipment picker: lines follow the shipment's status
  toast(`Assigned ${linked.length} lines${move.length ? ` · ${move.length} moved to ${STAGE[shipItemStage(s)].label}` : ""}`); S.sel.clear(); render();
}
async function doDelete() {
  const d = S.drawer;
  const path = { item: "items/", ship: "shipments/", batch: "batches/" }[d.kind] + d.id;
  if (d.kind === "ship") { // unlink items first
    await writeMany(S.items.filter(i => i.shipmentId === d.id).map(i => ["items/" + i.id, { ...i, shipmentId: "" }]));
  }
  if (await remove(path)) { toast("Deleted"); S.sel.delete(d.id); closeDrawer(); }
}
async function researchDecide(go) {
  const d = S.drawer; const old = S.items.find(i => i.id === d.id); if (!old) return;
  const v = formData();
  const it = buildItem(v, old);
  if (!it.name) { toast("Give the item a name first.", true); return; }
  if (go) {
    const qty = num(v.ap_qty) || it.qty || 1;
    Object.assign(it, { stage: "to_buy", batch: v.ap_batch || "", qty, holder: "" });
    it.research = { ...(it.research || {}), decision: "go", decidedAt: nowISO() };
    it.history = pushHistory(old, "to_buy", "Approved from research", "");
  } else {
    it.research = { ...(it.research || {}), decision: "nogo", decidedAt: nowISO() };
    it.history = pushHistory(old, "research", "No go" + (it.research.reason ? ": " + it.research.reason : ""), "");
  }
  await ensureClient(it.client);
  if (await write("items/" + old.id, it)) { toast(go ? "Approved · moved to To buy" : "Marked no go"); closeDrawer(); }
}
async function bulkPaid(flag) {
  const its = S.items.filter(i => S.sel.has(i.id) && i.stage !== "research");
  const list = its.map(i => {
    let st = i.stage; if (flag && st === "delivered") st = "paid"; if (!flag && st === "paid") st = "delivered";
    const n = { ...i, paid: flag, stage: st, updatedAt: nowISO() };
    if (st !== i.stage) n.history = pushHistory(i, st, flag ? "Payment received" : "Payment undone", i.holder);
    return ["items/" + i.id, n];
  });
  const ok = await writeMany(list); toast(`${flag ? "Marked paid" : "Marked unpaid"}: ${ok} lines`); S.sel.clear(); render();
}
async function bulkDuplicate() {
  const its = S.items.filter(i => S.sel.has(i.id));
  if (!its.length) return;
  let nextSeq = Math.max(0, ...S.items.map(i => i.seq || 0));
  const newIds = [];
  const list = its.map(i => {
    const nid = uid(); newIds.push(nid); nextSeq += 1;
    const { id, ...rest } = i;
    const stage = i.stage === "paid" ? "delivered" : i.stage; // a copy is unpaid, so it can't sit in "Paid · done"
    const copy = { ...rest, id: nid, seq: nextSeq, stage, paid: false, holder: "", review: true,
      history: [{ stage, at: nowISO(), note: "Duplicated from " + (i.name || "item"), holder: "", by: myId() }], updatedAt: nowISO() };
    if (i.stage === "research" && copy.research) { copy.research = { ...copy.research, decision: "pending", requestedAt: nowISO() }; delete copy.research.decidedAt; }
    return ["items/" + nid, copy];
  });
  const ok = await writeMany(list);
  toast(`Duplicated ${ok} item${ok === 1 ? "" : "s"}`);
  S.sel.clear();
  newIds.forEach(id => S.sel.add(id));
  render();
}
async function saveRates(form) {
  const c = cfg(); const fd = new FormData(form); const r = {};
  for (const m in DEFAULT_RATES) { r[m] = {}; for (const k of ["perKgCNY", "perCbmCNY", "divisor", "minKg", "valuePct", "flatIDR"]) r[m][k] = ["divisor", "flatIDR"].includes(k) ? numId(fd.get(m + "." + k)) : num(fd.get(m + "." + k)); }
  if (await write("config/main", { ...c, shipRates: r })) toast("Ongkir rates saved");
}
async function saveConfig(form) {
  const c = cfg(); const fd = new FormData(form);
  const n = { ...c, kursEveDidi: numId(fd.get("kursEveDidi")), marketRate: numId(fd.get("marketRate")), quoteRate: numId(fd.get("quoteRate")), minMarginPct: num(fd.get("minMarginPct")), minProfitIDR: numId(fd.get("minProfitIDR")),
    people: String(fd.get("people") || "").split(/\n|,/).map(s => s.trim()).filter(Boolean) };
  if (await write("config/main", n)) toast("Settings saved");
}
async function clientInternal(name, on) {
  const c = cfg(); const list = [...(c.clients || [])];
  const i = list.findIndex(x => x.name === name);
  if (i >= 0) list[i] = { ...list[i], internal: on }; else list.push({ name, internal: on });
  await write("config/main", { ...c, clients: list });
}
async function clientRename(from, to) {
  to = (to || "").trim().toUpperCase(); if (!to || to === from) { toast("Type the new client name.", true); return; }
  const its = S.items.filter(i => i.client === from);
  const ok = await writeMany(its.map(i => ["items/" + i.id, { ...i, client: to }]));
  const c = cfg(); const list = (c.clients || []).filter(x => x.name !== from);
  const wasInt = (c.clients || []).find(x => x.name === from)?.internal;
  if (!list.some(x => x.name === to)) list.push({ name: to, internal: !!wasInt });
  await write("config/main", { ...c, clients: list });
  toast(`Moved ${ok} lines to ${to}`);
}

async function changeMemberRole(id, role) {
  try { await S.user.setMemberRole(id, role); toast("Access updated"); }
  catch (e) { toast((e && e.message) || "Couldn't change access.", true); }
  S.members = null; S.membersLoading = false; schedule();
}
async function changePassword(form) {
  const p1 = form.pw1.value, p2 = form.pw2.value;
  if (p1.length < 8) { toast("Use at least 8 characters.", true); return; }
  if (p1 !== p2) { toast("The two passwords don't match.", true); return; }
  try { await S.user.changePassword(p1); form.reset(); toast("Password changed"); }
  catch (e) { toast((e && e.message) || "Couldn't change the password.", true); }
}

// ---------- events ----------
document.addEventListener("click", e => {
  if (S.menuOpen && !e.target.closest(".menu") && !e.target.closest(".me-btn")) { S.menuOpen = false; renderMenu(); }
  const t = e.target.closest("[data-act]"); if (!t) return;
  if (e.target.closest("[data-stop]")) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (act === "sel" || act === "selall") return; // handled on change
  if (["f"].includes(act)) return;
  switch (act) {
    case "menu": S.menuOpen = !S.menuOpen; renderMenu(); break;
    case "menu-settings": S.menuOpen = false; renderMenu(); S.tab = "settings"; render(); window.scrollTo(0, 0); break;
    case "theme": setTheme(id); break;
    case "logout": S.menuOpen = false; renderMenu(); closeDrawer(); S.sel.clear(); ctx.signOut(); break;
    case "tab": S.tab = id; try { localStorage.setItem("jcd.tab", id); } catch (er) {} render(); window.scrollTo(0, 0); break;
    case "gostage": if (id === "research") { S.tab = "research"; S.f.rstatus = "open"; render(); break; } S.tab = "tracker"; S.f.stage = "all"; if (id === "paid") S.f.showPaid = true; render(); setTimeout(() => { const cols = document.querySelectorAll(".col"); const i = STAGE[id].i; cols[i] && cols[i].scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }, 30); break;
    case "att-flag": S.tab = "orders"; S.f.flag = id; render(); break;
    case "att-client": S.tab = "orders"; S.f.client = id; S.f.flag = "unpaid"; S.f.batch = "all"; render(); break;
    case "att-batch": S.tab = "orders"; S.f.batch = id; S.f.client = "all"; S.f.flag = "all"; render(); break;
    case "att-ship": openDrawer("ship", id); break;
    case "att-tab": S.tab = id; render(); break;
    case "att-research": S.tab = "research"; S.f.rstatus = id; render(); break;
    case "att-stage": S.tab = "orders"; Object.assign(S.f, { stage: id, batch: "all", client: "all", flag: "all" }); render(); break;
    case "att-done": S.tab = "orders"; Object.assign(S.f, { stage: "paid", batch: "all", client: id, flag: "all" }); render(); break;
    case "clear-f": Object.assign(S.f, { batch: "all", client: "all", q: "", flag: "all", stage: "all" }); render(); break;
    case "show-paid": S.f.showPaid = true; render(); break;
    case "shipview": S.f.shipView = id; render(); break;
    case "rstatus": S.f.rstatus = id; render(); break;
    case "rsort": rSort(id); break;
    case "rdir": S.f.rdir = S.f.rdir === "asc" ? "desc" : "asc"; render(); break;
    case "rclear": Object.assign(S.f, RFILTER_DEFAULT, { q: "" }); render(); break;
    case "edit-item": openDrawer("item", id); break;
    case "new-item": openDrawer("item", null); break;
    case "edit-ship": openDrawer("ship", id); break;
    case "new-ship": openDrawer("ship", null); break;
    case "new-research": openDrawer("item", null, { stage: "research", batch: "", qty: 1, rate: cfg().quoteRate, research: { decision: "pending", sample: "none", hassle: "med", pic: "Didi" } }); break;
    case "r-approve": researchDecide(true); break;
    case "r-nogo": researchDecide(false); break;
    case "apply-jy": { const jy = num($("#d-jy").value); const r = numId($("#d-rate").value); if (!jy) { toast("Type the harga jual in ¥ first.", true); break; } $("#d-sellIDR").value = Math.round(jy * r); updateCalc(); break; }
    case "edit-batch": openDrawer("batch", id); break;
    case "new-batch": openDrawer("batch", null); break;
    case "ship-next": shipNext(id); break;
    case "close": closeDrawer(); break;
    case "save": save(); break;
    case "del-ask": S.drawer.confirmDel = true; $(".drawer-f").innerHTML = ({ item: dItem, ship: dShip, batch: dBatch }[S.drawer.kind])(S.drawer).foot; break;
    case "del-cancel": S.drawer.confirmDel = false; $(".drawer-f").innerHTML = ({ item: dItem, ship: dShip, batch: dBatch }[S.drawer.kind])(S.drawer).foot; break;
    case "del-confirm": doDelete(); break;
    case "apply-kj": { const kj = numId($("#d-kj").value); const p = num($("#d-priceCNY").value); if (!kj) { toast("Type a kurs jual first.", true); break; } $("#d-sellIDR").value = Math.round(p * kj); updateCalc(); break; }
    case "use-ship-est": $("#d-costIDR").value = t.dataset.v; break;
    case "bulk-move": bulkMove(); break;
    case "bulk-ship": { const v = $("#b-ship").value; if (!v) { toast("Pick a shipment.", true); break; } bulkShip(v); break; }
    case "bulk-paid": bulkPaid(id === "1"); break;
    case "bulk-ok": bulkSet({ review: false }, "Marked checked"); break;
    case "bulk-dup": bulkDuplicate(); break;
    case "bulk-eta": { const v = $("#b-eta").value; if (!v) { toast("Pick a date first.", true); break; } bulkSet({ etaJkt: v }, "ETA Jakarta set"); break; }
    case "bulk-clear": S.sel.clear(); render(); break;
    case "client-rename": clientRename(id, $("#" + t.dataset.in).value); break;
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.act === "pickall" || t.dataset.act === "pick") {
    if (t.dataset.act === "pickall") document.querySelectorAll(`#dform input[data-act="pick"][data-group="${CSS.escape(t.dataset.group)}"]`).forEach(b => { if (!b.closest(".prow").hidden) b.checked = t.checked; });
    document.querySelectorAll('#dform input[data-act="pickall"]').forEach(h => { const bs = [...document.querySelectorAll(`#dform input[data-act="pick"][data-group="${CSS.escape(h.dataset.group)}"]`)]; h.checked = bs.length && bs.every(b => b.checked); h.indeterminate = !h.checked && bs.some(b => b.checked); });
    const sel = [...document.querySelectorAll('#dform input[data-act="pick"]:checked')];
    const pc = $("#pickcount"); if (pc) pc.textContent = `${sel.length} selected · ${qtyf(sel.reduce((a, b) => a + num(b.dataset.pcs), 0))} pcs`;
    return;
  }
  if (t.dataset.act === "sel") { e.stopPropagation(); if (t.checked) S.sel.add(t.dataset.id); else S.sel.delete(t.dataset.id); render(); return; }
  if (t.dataset.act === "selall") { const list = filteredItems({ D: derive() }).filter(i => S.f.stage === "research" || i.stage !== "research"); if (t.checked) list.forEach(i => S.sel.add(i.id)); else list.forEach(i => S.sel.delete(i.id)); render(); return; }
  if (t.dataset.act === "rsortsel") { rSort(t.value, true); return; }
  if (t.dataset.act === "f" && t.tagName === "SELECT") { S.f[t.dataset.k] = t.value; render(); return; }
  if (t.dataset.act === "client-int") { clientInternal(t.dataset.id, t.checked); return; }
  if (t.dataset.act === "member-role") { changeMemberRole(t.dataset.id, t.value); return; }
});
document.addEventListener("click", e => { if (e.target.matches('input[data-act="sel"], input[data-act="selall"]')) e.stopPropagation(); }, true);
let qT = 0;
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.act === "f" && t.tagName === "INPUT") { clearTimeout(qT); qT = setTimeout(() => { S.f[t.dataset.k] = t.value; render(); }, 180); }
  if (t.id === "pick-q") { const q = t.value.trim().toLowerCase(); document.querySelectorAll("#dform .prow").forEach(r => { r.hidden = !!q && !r.dataset.hay.includes(q); }); document.querySelectorAll("#dform .pgroup").forEach(g => { g.hidden = ![...g.querySelectorAll(".prow")].some(r => !r.hidden); }); return; }
  if (t.id === "rslide") { const w = $("#rwrap"); if (w) w.scrollLeft = (w.scrollWidth - w.clientWidth) * t.value / 1000; return; }
  if (t.id === "d-route" && t.value !== "handcarry") { const cs = $("#d-shipCur"), si = $("#d-shipTotalIDR"); if (cs && si && cs.value === "CNY") { const y = numOrNull(si.value), rate = numId(($("#d-rate") || {}).value) || cfg().kursEveDidi; if (y != null) si.value = Math.round(y * rate); cs.value = "IDR"; } }
  if (t.closest("#dform")) updateCalc();
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.dataset.form === "config") saveConfig(e.target);
  else if (e.target.dataset.form === "rates") saveRates(e.target);
  else if (e.target.dataset.form === "password") changePassword(e.target);
  else if (e.target.id === "dform") save();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && S.menuOpen) { S.menuOpen = false; renderMenu(); return; }
  if (e.key === "Escape" && S.drawer) closeDrawer();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card[role=button]")) { e.preventDefault(); openDrawer("item", e.target.dataset.id); }
});
// tooltips
const tip = $("#tip");
document.addEventListener("pointermove", e => {
  const g = e.target.closest && e.target.closest("[data-tip]");
  if (!g) { tip.hidden = true; return; }
  tip.innerHTML = g.getAttribute("data-tip"); tip.hidden = false;
  const w = tip.offsetWidth, x = Math.min(window.innerWidth - w - 8, e.clientX + 12);
  tip.style.left = x + "px"; tip.style.top = (e.clientY - tip.offsetHeight - 10) + "px";
});

window.addEventListener("resize", syncRSlide);
{ let dragT = 0; const endDrag = () => { clearTimeout(dragT); if (S.dragging) { S.dragging = false; if (S.pendingRender) { S.pendingRender = false; schedule(); } } };
  document.addEventListener("pointerdown", e => { if (e.target.id === "rslide") { S.dragging = true; clearTimeout(dragT); dragT = setTimeout(endDrag, 8000); } });
  ["pointerup", "pointercancel", "touchend", "blur"].forEach(ev => window.addEventListener(ev, endDrag, true)); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncRSlide);
if (ctx.env && ctx.env.label) { const h = $(".brand h1"); if (h) { const ch = document.createElement("span"); ch.className = "chip warn"; ch.style.cssText = "vertical-align:4px;font-family:var(--sans);margin-left:8px"; ch.textContent = ctx.env.label; h.appendChild(ch); } }
connectUser();
renderMe();
render();
connect();
}
