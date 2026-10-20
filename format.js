// Pure formatting + parsing helpers (Indonesian locale).
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const nf0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
export const num = v => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
export const numOrNull = v => (v === "" || v == null) ? null : (isFinite(parseFloat(String(v).replace(",", "."))) ? parseFloat(String(v).replace(",", ".")) : null);
export const numId = v => { const s = String(v ?? "").trim().replace(/^rp\.?\s*/i, "").replace(/\s/g, ""); // Rupiah / kurs: "250.000" and "1.500.000" are thousands
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ""));
  if (/^\d{1,3}(,\d{3})+$/.test(s)) return parseFloat(s.replace(/,/g, ""));
  return num(s); };
export const numIdOrNull = v => (v === "" || v == null || !/\d/.test(String(v))) ? null : numId(v);
export const idrIn = v => (v == null || v === "") ? "" : String(Math.round(num(v)));
export const safeUrl = u => { const t = String(u || "").trim(); if (!t) return ""; if (/^https?:\/\//i.test(t)) return t; if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ""; return "https://" + t; };
export const idr = v => (v == null || !isFinite(v)) ? "—" : (v < 0 ? "−" : "") + "Rp " + nf0.format(Math.abs(Math.round(v)));
export const idrC = v => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e9) return s + "Rp " + (a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " M";
  if (a >= 1e6) return s + "Rp " + (a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
  if (a >= 1e3) return s + "Rp " + (a / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 0 }) + " rb";
  return s + "Rp " + nf0.format(a);
};
export const cny = v => (v == null || !isFinite(v)) ? "—" : "¥" + nf2.format(v);
export const qtyf = v => nf2.format(v || 0);
export const nowISO = () => new Date().toISOString();
export const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); };
export const fmtDT = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
export const monthLabel = m => { if (!m) return "—"; const [y, mo] = m.split("-"); const d = new Date(+y, +mo - 1, 1); return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
export const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const daysUntil = ds => { if (!ds) return null; const a = new Date(todayStr() + "T00:00:00"), b = new Date(ds + "T00:00:00"); return isNaN(b) ? null : Math.round((b - a) / 86400000); };
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
