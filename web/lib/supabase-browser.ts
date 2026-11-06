"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | null | undefined;

/**
 * Browser-only Supabase client used for Realtime subscriptions.
 *
 * It intentionally uses the public anon key: Realtime events are still filtered
 * by the SELECT policies defined in schema.sql, and no write access is exposed.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (browserClient !== undefined) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return browserClient;
}
