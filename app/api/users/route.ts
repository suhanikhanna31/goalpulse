// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/users           — List users (role-filtered)
// PATCH /api/users/[id]     — Admin changes a user's role
//
// BRD §3: Admin manages org hierarchy, role assignment
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { writeAuditLog } from "../../../lib/audit";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role");
  const department = searchParams.get("department");
  const managerId = searchParams.get("manager_id");

  let query = adminSupabase
    .from("profiles")
    .select(`
      id, full_name, email, role, department, manager_id,
      manager:profiles!profiles_manager_id_fkey(id, full_name)
    `)
    .order("full_name");

  if (role) query = query.eq("role", role);
  if (department) query = query.eq("department", department);
  if (managerId) query = query.eq("manager_id", managerId);

  // Employees only see themselves
  if (profile.role === "employee") {
    query = query.eq("id", user.id);
  } else if (profile.role === "manager") {
    // Managers see their direct reports + themselves
    query = query.or(`manager_id.eq.${user.id},id.eq.${user.id}`);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ users: data });
}

export async function PATCH(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Only admins can update user profiles." }, { status: 403 });
  }

  const body = (await req.json()) as {
    user_id: string;
    role?: "employee" | "manager" | "admin";
    manager_id?: string | null;
    department?: string;
    full_name?: string;
  };

  const { user_id, ...updates } = body;
  if (!user_id) return Response.json({ error: "user_id required." }, { status: 400 });

  const { data: current } = await adminSupabase.from("profiles").select("*").eq("id", user_id).single();

  const { data: updated, error } = await adminSupabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", user_id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    action: "USER_ROLE_CHANGED",
    entityType: "profile",
    entityId: user_id,
    actorId: user.id,
    oldValue: current ? { role: current.role, manager_id: current.manager_id } : null,
    newValue: updates,
    details: `Profile updated by Admin ${profile.full_name}: ${JSON.stringify(updates)}`,
  });

  return Response.json({ user: updated });
}
