// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/goals/[id]  — Get a single goal with checkins
// PATCH  /api/goals/[id]  — Update goal fields (pre-approval only)
// DELETE /api/goals/[id]  — Delete a draft goal
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../../lib/supabase-server";
import { isGoalEditable, validateGoalWeightage } from "../../../../lib/validation";
import { writeAuditLog } from "../../../../lib/audit";
import type { UpdateGoalRequest } from "../../../../lib/types";

type Params = { params: { id: string } };

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: goal, error } = await adminSupabase
    .from("goals")
    .select(`
      *,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department),
      approved_by_profile:profiles!goals_approved_by_fkey(id, full_name),
      checkins(*)
    `)
    .eq("id", params.id)
    .single();

  if (error || !goal) return Response.json({ error: "Goal not found" }, { status: 404 });

  return Response.json({ goal });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  // Fetch current goal for diff
  const { data: currentGoal, error: fetchError } = await adminSupabase
    .from("goals")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchError || !currentGoal) return Response.json({ error: "Goal not found" }, { status: 404 });

  // Check editability
  const editCheck = await isGoalEditable(params.id, profile.role);
  if (!editCheck.editable) {
    return Response.json({ error: editCheck.reason }, { status: 403 });
  }

  // Employees can only edit their own goals
  if (profile.role === "employee" && currentGoal.employee_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as UpdateGoalRequest & { employee_id?: string };
  const updates: Record<string, unknown> = {};

  if (body.target != null) updates.target = body.target;
  if (body.description != null) updates.description = body.description.trim();
  if (body.thrust_area != null) updates.thrust_area = body.thrust_area.trim();

  // Weightage update requires re-validation
  if (body.weightage != null) {
    const validation = await validateGoalWeightage(
      currentGoal.employee_id,
      currentGoal.cycle_id,
      body.weightage,
      params.id
    );
    if (!validation.valid) {
      return Response.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
    }
    updates.weightage = body.weightage;
  }

  // Shared goals: employees can only change weightage
  if (currentGoal.is_shared && profile.role === "employee") {
    const allowedKeys = Object.keys(updates).filter((k) => k !== "weightage");
    if (allowedKeys.length > 0) {
      return Response.json({
        error: "Shared goals only allow weightage changes.",
        blocked_fields: allowedKeys,
      }, { status: 403 });
    }
  }

  updates.updated_at = new Date().toISOString();

  const { data: updated, error: updateError } = await adminSupabase
    .from("goals")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  await writeAuditLog({
    action: "GOAL_UPDATED",
    entityType: "goal",
    entityId: params.id,
    actorId: user.id,
    oldValue: { target: currentGoal.target, weightage: currentGoal.weightage, description: currentGoal.description },
    newValue: updates,
    details: `Goal "${currentGoal.title}" updated by ${profile.full_name} (${profile.role})`,
  });

  return Response.json({ goal: updated });
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  const { data: goal } = await adminSupabase.from("goals").select("*").eq("id", params.id).single();
  if (!goal) return Response.json({ error: "Goal not found" }, { status: 404 });

  // Only draft goals can be deleted, only by the owner or admin
  if (goal.status !== "draft") {
    if (profile.role !== "admin") {
      return Response.json({ error: "Only draft goals can be deleted." }, { status: 403 });
    }
  }

  if (profile.role === "employee" && goal.employee_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await adminSupabase.from("goals").delete().eq("id", params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    action: "GOAL_UPDATED",
    entityType: "goal",
    entityId: params.id,
    actorId: user.id,
    oldValue: { title: goal.title, status: goal.status },
    details: `Goal "${goal.title}" deleted by ${profile.full_name}`,
  });

  return Response.json({ message: "Goal deleted." });
}
