import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kqozkwydmtmwotmzxpax.supabase.co";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_pbpFXqvNYWaPP7nZS5d1CA_sVVYEHEw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
