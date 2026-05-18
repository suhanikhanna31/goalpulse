import { createClient } from "@supabase/supabase-js";

// Strip trailing /rest/v1/ — supabase-js adds that internally
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "");

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
