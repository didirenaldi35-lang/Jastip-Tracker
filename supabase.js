import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let client = null;
export function getClient() {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}
