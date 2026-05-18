import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;

/** Browser / client-component client (uses anon key) */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Server-side client that respects RLS via the user's session cookie */
export function createServerClient() {
  const cookieStore = cookies();
  return createServerComponentClient({ cookies: () => cookieStore });
}

/** Admin client — bypasses RLS. Use ONLY in server routes for privileged ops */
export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Extract the authenticated user from a request's Authorization header or cookie */
export async function getRequestUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data, error } = await adminSupabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }
  return null;
}

/** Fetch the profile row for a user (includes role, manager_id, etc.) */
export async function getUserProfile(userId: string) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data as {
    id: string;
    full_name: string;
    email: string;
    role: "employee" | "manager" | "admin";
    manager_id: string | null;
    department: string | null;
  };
}
