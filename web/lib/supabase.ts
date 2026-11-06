import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type Client = SupabaseClient<Database>;

let adminClient: Client | null | undefined;
let readClient: Client | null | undefined;

function getSupabaseUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();

  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function createServerClient(apiKey: string): Client | null {
  const url = getSupabaseUrl();
  if (!url) {
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL is missing or invalid; database features are disabled.",
    );
    return null;
  }

  return createClient<Database>(url, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-application-name": "smart-plant-watering",
      },
    },
  });
}

/**
 * Server-only client with full write access. Used by the ingest route.
 * Returns null instead of throwing so the dashboard can render a setup state.
 */
export function getSupabaseAdmin(): Client | null {
  if (adminClient !== undefined) return adminClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createServerClient(serviceRoleKey);
  return adminClient;
}

/**
 * Read-only client for dashboard queries. Prefers the public anon key, which
 * is limited by the SELECT policies in schema.sql. Falls back to the service
 * role client for deployments that only configure the server-side key.
 */
export function getSupabaseReadClient(): Client | null {
  if (readClient !== undefined) return readClient;

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (anonKey) {
    readClient = createServerClient(anonKey);
    return readClient;
  }

  readClient = getSupabaseAdmin();
  return readClient;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseReadClient() !== null;
}
