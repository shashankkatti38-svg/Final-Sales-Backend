import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://kqozkwydmtmwotmzxpax.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_pbpFXqvNYWaPP7nZS5d1CA_sVVYEHEw";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Returns a Supabase client attached to the incoming request's Authorization header
 * so that Row Level Security (RLS) is respected for the authenticated user/org.
 */
export function getSupabaseClient(req?: Request): SupabaseClient {
  const authHeader = req?.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });
  }
  return supabase;
}
