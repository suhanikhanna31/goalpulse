// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit
//
// BRD §4: "Audit Trail: System must log all changes made to goals after the
//          lock date — capturing who changed what and when."
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  // Only admin can view full audit trail; managers see only their team's
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entity_id");
  const entityType = searchParams.get("entity_type");
  const action = searchParams.get("action");
  const actorId = searchParams.get("actor_id");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  let query = adminSupabase
    .from("audit_logs")
    .select(`
      *,
      actor:profiles!audit_logs_actor_id_fkey(id, full_name, role)
    `)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (entityId) query = query.eq("entity_id", entityId);
  if (entityType) query = query.eq("entity_type", entityType);
  if (action) query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);

  // Non-admins can only see logs for their own actions or their team's goals
  if (profile.role === "employee") {
    query = query.eq("actor_id", user.id);
  } else if (profile.role === "manager") {
    // Get team's user IDs
    const { data: reports } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("manager_id", user.id);
    const ids = [...(reports ?? []).map((r) => r.id), user.id];
    query = query.in("actor_id", ids);
  }

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    audit_logs: data,
    total: count,
    limit,
    offset,
  });
}
