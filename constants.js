// Domain constants: stages, routes, tabs, default settings.
// ---------- constants ----------
export const STAGES = [
  { id: "research",   label: "Research",        place: "Buyer asked · check sample & margin", zone: "rs", dot: "--muted" },
  { id: "to_buy",     label: "To buy",          place: "On the buy list",          zone: "cn", dot: "--s1" },
  { id: "ordered",    label: "Ordered",         place: "Paid · supplier shipping", zone: "cn", dot: "--s2" },
  { id: "china_wh",   label: "China warehouse", place: "Warehouse / jastipper CN", zone: "cn", dot: "--s3" },
  { id: "in_transit", label: "In transit",      place: "China → Indonesia",        zone: "tr", dot: "--s4" },
  { id: "jakarta",    label: "Jakarta team",    place: "Received in Jakarta",      zone: "id", dot: "--s5" },
  { id: "delivering", label: "To buyer",        place: "Jastipper / courier out",  zone: "id", dot: "--s6" },
  { id: "delivered",  label: "Delivered",       place: "With buyer · awaiting payment", zone: "id", dot: "--s7" },
  { id: "paid",       label: "Paid · done",     place: "Money in · order closed",  zone: "done", dot: "--good" },
];
export const STAGE = Object.fromEntries(STAGES.map((s, i) => [s.id, { ...s, i }]));
export const SHIP_STAGES = [
  { id: "packing",   label: "Packing (CN)" },
  { id: "departed",  label: "Departed" },
  { id: "arrived",   label: "Arrived" },
  { id: "delivered", label: "Delivered" },
];
export const METHODS = { handcarry: "Handcarry (jastipper)", air: "Air cargo", sea: "Sea cargo", courier: "Courier" };
export const ROUTES = { "": "— pick —", air: "Air cargo", sea: "Sea cargo", handcarry: "Jastipper (handcarry)", courier: "Courier", cargo: "Cargo (sea)" };
export const DECISIONS = { pending: "Checking", hold: "On hold", go: "Approved", nogo: "No go" };
export const SAMPLE = { none: "Not yet", requested: "Requested", received: "Received", approved: "Approved", rejected: "Rejected" };
export const HASSLE = { low: "Low · standard item", med: "Medium · some follow-up", high: "High · custom logo, bulky or fragile" };
export const HASSLE_X = { low: 1, med: 1.5, high: 2 };
export const TABS = [
  ["overview", "Overview"],
  ["research", "Research"], ["orders", "Orders"], ["shipments", "Shipments"], ["tracker", "Tracker"],
  ["finance", "Finance"], ["settings", "Settings"],
];
export const TAB_GROUPS = [
  { tabs: ["overview"] },
  { flow: true, label: "Order flow", tabs: ["research", "orders", "shipments", "tracker"] },
  { tabs: ["finance"] },
  { end: true, tabs: ["settings"] },
];
export const TAB_HINT = { research: "Buyer asks · check margin", orders: "Buy list & POs", shipments: "China → Jakarta", tracker: "Where every item is" };

export const DEFAULT_CONFIG = { kursEveDidi: 2720, marketRate: 2700, airPerKgCNY: 80, seaPerKgCNY: 0, quoteRate: 2700, minMarginPct: 20, minProfitIDR: 300000, clients: [], people: ["Eve", "Didi", "Jakarta team"] };
export const DEFAULT_RATES = {
  air:       { perKgCNY: 80, perCbmCNY: 0, divisor: 6000, minKg: 1, valuePct: 0, flatIDR: 0 },
  sea:       { perKgCNY: 0,  perCbmCNY: 0, divisor: 0,    minKg: 0, valuePct: 0, flatIDR: 0 },
  handcarry: { perKgCNY: 0,  perCbmCNY: 0, divisor: 0,    minKg: 0, valuePct: 0, flatIDR: 0 },
  courier:   { perKgCNY: 0,  perCbmCNY: 0, divisor: 6000, minKg: 1, valuePct: 0, flatIDR: 0 },
};
