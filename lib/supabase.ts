import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database/types";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://kqozkwydmtmwotmzxpax.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_pbpFXqvNYWaPP7nZS5d1CA_sVVYEHEw";

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/**
 * Returns a Supabase client attached to the incoming request's Authorization header
 * so that Row Level Security (RLS) is respected for the authenticated user/org.
 */
export function getSupabaseClient(req?: Request): SupabaseClient<Database> {
  const authHeader = req?.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
}

/**
 * Health check helper to verify database connectivity.
 */
export async function checkDatabaseConnection(): Promise<{
  connected: boolean;
  table?: string;
  count?: number;
  error?: string;
}> {
  try {
    const { count, error } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    if (error) {
      return { connected: false, error: error.message };
    }
    return { connected: true, table: "leads", count: count ?? 0 };
  } catch (err: any) {
    return { connected: false, error: err?.message || String(err) };
  }
}
