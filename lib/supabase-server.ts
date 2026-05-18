import { createClient } from "@supabase/supabase-js"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey

/** Browser / client-component client */
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)

/** Server-side client */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )
}

/** Admin client */
export const adminSupabase = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      persistSession: false,
    },
  }
)

/** Extract authenticated user */
export async function getRequestUser(req: Request) {
  const authHeader = req.headers.get("authorization")

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)

    const { data, error } =
      await adminSupabase.auth.getUser(token)

    if (error || !data.user) return null

    return data.user
  }

  return null
}

/** Fetch profile */
export async function getUserProfile(userId: string) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single()

  if (error) return null

  return data
}