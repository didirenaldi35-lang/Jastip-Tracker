// Build-time configuration (set in .env locally, or in Cloudflare Pages -> Settings -> Variables).
const e = import.meta.env || {};
export const env = {
  supabaseUrl: (e.VITE_SUPABASE_URL || "").trim(),
  supabaseAnonKey: (e.VITE_SUPABASE_ANON_KEY || "").trim(),
  appName: (e.VITE_APP_NAME || "Jastip China Desk").trim(),
  envLabel: (e.VITE_ENV_LABEL || "").trim(),            // e.g. "Sandbox" shows a chip next to the title
  // Public mode = no sign-in at all; anyone with the link can view AND edit (needs supabase/migrations/0002_public_mode.sql).
  publicMode: String(e.VITE_PUBLIC_MODE || "") === "true",
  enableGoogle: String(e.VITE_ENABLE_GOOGLE || "") === "true",
  // Demo mode = local-only data in this browser. On during `npm run dev`, or when VITE_DEMO=true.
  demo: !!e.DEV || String(e.VITE_DEMO || "") === "true",
};
env.supabaseConfigured = /^https:\/\/.+\..+/.test(env.supabaseUrl) && env.supabaseAnonKey.length > 20;
