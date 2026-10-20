import { defineConfig, loadEnv } from "vite";

// Stops a live deploy from shipping a site that cannot reach its database.
// On Cloudflare Pages (CF_PAGES is set by Cloudflare) a missing variable fails the build;
// everywhere else (CI, your laptop) it only prints a warning.
function requireLiveConfig(mode) {
  return {
    name: "require-live-config",
    apply: "build",
    buildStart() {
      const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
      if (String(env.VITE_DEMO || "") === "true") return;
      const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter(k => !String(env[k] || "").trim());
      if (!missing.length) return;
      const msg = `Missing ${missing.join(" and ")}. Add them in Cloudflare Pages -> Settings -> Variables and Secrets, then redeploy.`;
      if (process.env.CF_PAGES) throw new Error(msg);
      this.warn(msg);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [requireLiveConfig(mode)],
  build: { target: "es2020", sourcemap: false, chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
}));
