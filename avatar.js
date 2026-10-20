// Generates a small round "initials" avatar as a data: URI (no external images).
export function initialsAvatar(name) {
  const t = (String(name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#0B7A63"/><text x="32" y="40" font-family="sans-serif" font-size="24" font-weight="600" text-anchor="middle" fill="#fff">${t.replace(/[<>&"]/g, "")}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
