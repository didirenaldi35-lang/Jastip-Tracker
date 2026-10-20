import { DEFAULT_CONFIG, DEFAULT_RATES, METHODS } from "./constants.js";
import { num, idr, cny, nf0, nf2, qtyf } from "./format.js";

// Pure money / shipping calculations. No DOM, no app state.
export function buildCfg(config) {
  const conf = config || {};
  const c = { ...DEFAULT_CONFIG, ...conf };
  const saved = conf.shipRates || {};
  const r = {};
  for (const k in DEFAULT_RATES) r[k] = { ...DEFAULT_RATES[k], ...(saved[k] || {}) };
  if (!saved.air && conf.airPerKgCNY) r.air.perKgCNY = conf.airPerKgCNY;
  c.shipRates = r;
  return c;
}
export const METHOD_OF = r => r === "cargo" ? "sea" : r;
export const lineKgVol = it => { const q = it.qty || 0; return { kg: num(it.kgPc) * q, vol: num(it.lcm) * num(it.wcm) * num(it.hcm) * q }; };
export function shipQuote(method, kg, vol, goodsIDR, c) {
  const R = c.shipRates[method]; if (!R) return null;
  const volKg = R.divisor ? vol / R.divisor : 0;
  const charge = Math.max(kg, volKg, (kg || vol) ? (R.minKg || 0) : 0);
  const cbm = vol / 1e6;
  const cnyCost = Math.max(charge * (R.perKgCNY || 0), cbm * (R.perCbmCNY || 0));
  const total = cnyCost * c.kursEveDidi + goodsIDR * (R.valuePct || 0) / 100 + (R.flatIDR || 0);
  return { total, charge, volKg, kg, cbm, cnyCost, basis: volKg > kg ? "volume" : "weight" };
}
export function lineEstimate(it, c) {
  const m = METHOD_OF(it.route);
  if (!m || !c.shipRates[m]) return { reason: "Pick a route to estimate ongkir" };
  const R = c.shipRates[m];
  const { kg, vol } = lineKgVol(it);
  if (!kg && !vol && !R.valuePct) return { reason: "Add weight or size to estimate ongkir" };
  if (!(R.perKgCNY || R.perCbmCNY || R.valuePct || R.flatIDR)) return { reason: `Set the ${METHODS[m]} rate in Settings` };
  return { ...shipQuote(m, kg, vol, goodsCNY(it) * (it.rate || 0), c), method: m };
}
export function itemShip(it, c) {
  if (it.shipCur === "CNY" && it.shipTotalCNY != null && it.shipTotalCNY !== "") {
    const q = it.qty || (it.research || {}).moq || 0, rate = it.rate || c.kursEveDidi, yuan = num(it.shipTotalCNY), tot = yuan * rate;
    return { perPc: q ? tot / q : 0, total: tot, src: "manual", note: `Jastipper fee ${cny(yuan)} × kurs ${nf0.format(rate)} ÷ ${qtyf(q)} pcs` };
  }
  if (it.shipTotalIDR != null && it.shipTotalIDR !== "") { const q = it.qty || (it.research || {}).moq || 0; return { perPc: q ? num(it.shipTotalIDR) / q : 0, total: num(it.shipTotalIDR), src: "manual", note: `Ongkir total ${idr(num(it.shipTotalIDR))} ÷ ${qtyf(q)} pcs` }; }
  if (it.shipPcIDR != null && it.shipPcIDR !== "") return { perPc: num(it.shipPcIDR), total: num(it.shipPcIDR) * (it.qty || 0), src: "manual", note: "Ongkir per pc typed in" };
  const r = it.research || {};
  if (r.estShipIDR != null && r.estShipIDR !== "") return { perPc: num(r.estShipIDR), total: num(r.estShipIDR) * (it.qty || 0), src: "manual", note: "Ongkir per pc typed in" };
  const e = lineEstimate(it, c);
  if (e.total != null) return { perPc: it.qty ? e.total / it.qty : 0, total: e.total, src: "est", note: `${METHODS[e.method]} estimate · ${nf2.format(e.charge)} kg chargeable, by ${e.basis}` };
  return { perPc: null, total: 0, src: "none", note: e.reason };
}

export function deriveData(items, shipments, batches, c) {
  const internal = new Set((c.clients || []).filter(x => x.internal).map(x => x.name));
  const shipById = Object.fromEntries(shipments.map(s => [s.id, s]));
  const batchById = Object.fromEntries(batches.map(b => [b.id, b]));
  const shipW = {};
  const chargeOf = (it, sh) => { const R = c.shipRates[sh.method] || {}; const { kg, vol } = lineKgVol(it); return Math.max(kg, R.divisor ? vol / R.divisor : 0); };
  for (const it of items) {
    const sh = it.shipmentId && shipById[it.shipmentId]; if (!sh) continue;
    const w = shipW[sh.id] = shipW[sh.id] || { allHave: true, charge: 0, val: 0, qty: 0 };
    const ch = chargeOf(it, sh);
    w.allHave = w.allHave && ch > 0; w.charge += ch; w.val += goodsCNY(it) * (it.rate || 0); w.qty += it.qty || 0;
  }
  const X = new Map();
  for (const it of items) {
    const goods = goodsCNY(it);
    const modal = goods * (it.rate || 0);
    let alloc = 0, shipSrc = "none", shipNote = "";
    const sh = it.shipmentId && shipById[it.shipmentId];
    if (sh && sh.costIDR) {
      const w = shipW[sh.id];
      if (w.allHave && w.charge > 0) { alloc = sh.costIDR * chargeOf(it, sh) / w.charge; shipNote = `${sh.name} · split by weight`; }
      else if (w.val > 0) { alloc = sh.costIDR * modal / w.val; shipNote = `${sh.name} · split by value (add weights to split by kg)`; }
      else { alloc = sh.costIDR * (it.qty || 0) / (w.qty || 1); shipNote = `${sh.name} · split by qty`; }
      shipSrc = "actual";
    } else {
      const e = itemShip(it, c); alloc = e.total || 0; shipSrc = e.src; shipNote = e.note;
    }
    const landed = modal + alloc;
    const isInt = internal.has(it.client);
    const hasSell = it.sellIDR != null && it.sellIDR !== "";
    const billed = isInt ? 0 : (hasSell ? num(it.sellIDR) * (it.qty || 0) : landed);
    const profit = isInt ? null : billed - landed;
    X.set(it.id, { goods, modal, alloc, shipSrc, shipNote, landed, perPc: it.qty ? landed / it.qty : 0, shipPc: it.qty ? alloc / it.qty : 0, billed, profit, isInt, hasSell });
  }
  return { X, shipById, batchById, internal };
}
export const goodsCNY = it => (it.qty || 0) * (it.priceCNY || 0) + (it.extraCNY || 0);
