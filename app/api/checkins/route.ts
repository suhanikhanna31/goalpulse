// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/checkins        — List check-ins (manager sees team's)
// POST /api/checkins        — Manager adds structured check-in comment
//
// BRD §2.2: Manager Check-in module — add a structured comment to document
//           the discussion.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { writeAuditLog } from "../../../lib/audit";
import type { ManagerCheckinRequest } from "../../../lib/types";

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const employeeId = searchParams.get("employee_id");
  const period = searchParams.get("period");

  let query = adminSupabase
    .from("checkins")
    .select(`
      *,
      goal:goals(id, title, thrust_area, uom, target, weightage),
      employee:profiles!checkins_employee_id_fkey(id, full_name, email, department)
    `)
    .order("checked_in_at", { ascending: false });

  if (cycleId) query = query.eq("cycle_id", cycleId);
  if (period) query = query.eq("period", period);

  if (profile.role === "employee") {
    query = query.eq("employee_id", user.id);
  } else if (profile.role === "manager") {
    const targetId = employeeId ?? null;
    if (targetId) {
      query = query.eq("employee_id", targetId);
    } else {
      const { data: reports } = await adminSupabase
        .from("profiles")
        .select("id")
        .eq("manager_id", user.id);
      const ids = (reports ?? []).map((r) => r.id);
      ids.push(user.id);
      query = query.in("employee_id", ids);
    }
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ checkins: data });
}

// ─── POST — Manager adds comment ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  if (profile.role === "employee") {
    return Response.json({ error: "Only managers or admins can add check-in comments." }, { status: 403 });
  }

  const body = (await req.json()) as ManagerCheckinRequest;
  const { checkin_id, comment } = body;

  if (!checkin_id || !comment?.trim()) {
    return Response.json({ error: "checkin_id and comment are required." }, { status: 400 });
  }

  // Verify manager is responsible for this employee
  const { data: checkin } = await adminSupabase
    .from("checkins")
    .select("*, goal:goals(title, employee_id)")
    .eq("id", checkin_id)
    .single();

  if (!checkin) return Response.json({ error: "Check-in not found." }, { status: 404 });

  if (profile.role === "manager") {
    const { data: emp } = await adminSupabase
      .from("profiles")
      .select("manager_id")
      .eq("id", checkin.employee_id)
      .single();
    if (!emp || emp.manager_id !== user.id) {
      return Response.json({ error: "You can only comment on your direct reports' check-ins." }, { status: 403 });
    }
  }

  const { data: updated, error } = await adminSupabase
    .from("checkins")
    .update({
      manager_comment: comment.trim(),
      manager_id: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkin_id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    action: "CHECKIN_MANAGER_COMMENT",
    entityType: "checkin",
    entityId: checkin_id,
    actorId: user.id,
    newValue: { comment },
    details: `Manager ${profile.full_name} added check-in comment for ${checkin.period}`,
  });

  return Response.json({ checkin: updated, message: "Check-in comment saved." });
}
