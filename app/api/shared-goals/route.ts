// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shared-goals
//
// Admin or Manager pushes a departmental KPI to multiple employees.
// BRD §2.1: "Recipients may adjust weightage only; Goal Title and Target
//            are read-only. Achievement updates by the primary owner sync
//            across all linked goal sheets."
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { validateGoalWeightage } from "../../../lib/validation";
import { writeAuditLog } from "../../../lib/audit";
import type { PushSharedGoalRequest } from "../../../lib/types";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  if (profile.role === "employee") {
    return Response.json({ error: "Only managers or admins can push shared goals." }, { status: 403 });
  }

  const body = (await req.json()) as PushSharedGoalRequest;
  const {
    goal_title,
    description,
    thrust_area,
    uom,
    target,
    cycle_id,
    employee_ids,
    default_weightage,
  } = body;

  if (!goal_title || !uom || target == null || !cycle_id || !employee_ids?.length || !default_weightage) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  // Create the primary (template) shared goal
  const { data: primaryGoal, error: primaryError } = await adminSupabase
    .from("goals")
    .insert([{
      employee_id: user.id, // owned by the manager/admin who pushes it
      cycle_id,
      thrust_area: thrust_area.trim(),
      title: goal_title.trim(),
      description: description.trim(),
      uom,
      target,
      weightage: default_weightage,
      status: "approved",
      is_shared: true,
      shared_from_goal_id: null, // this IS the primary
      primary_owner_id: user.id,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
    }])
    .select()
    .single();

  if (primaryError) return Response.json({ error: primaryError.message }, { status: 500 });

  // Create linked copies for each recipient
  const validationErrors: Record<string, string[]> = {};
  const goalsToInsert: Record<string, unknown>[] = [];

  for (const empId of employee_ids) {
    const validation = await validateGoalWeightage(empId, cycle_id, default_weightage);
    if (!validation.valid) {
      validationErrors[empId] = validation.errors;
      continue;
    }

    goalsToInsert.push({
      employee_id: empId,
      cycle_id,
      thrust_area: thrust_area.trim(),
      title: goal_title.trim(),
      description: description.trim(),
      uom,
      target,
      weightage: default_weightage,
      status: "approved",
      is_shared: true,
      shared_from_goal_id: primaryGoal.id,
      primary_owner_id: user.id,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
    });
  }

  const { data: pushedGoals, error: pushError } = await adminSupabase
    .from("goals")
    .insert(goalsToInsert)
    .select();

  if (pushError) return Response.json({ error: pushError.message }, { status: 500 });

  await writeAuditLog({
    action: "GOAL_SHARED",
    entityType: "goal",
    entityId: primaryGoal.id,
    actorId: user.id,
    newValue: { employee_ids, goal_title, target },
    details: `Shared goal "${goal_title}" pushed to ${pushedGoals?.length ?? 0} employees by ${profile.full_name}`,
  });

  return Response.json({
    primary_goal: primaryGoal,
    pushed_to: pushedGoals?.length ?? 0,
    skipped: Object.keys(validationErrors).length,
    validation_errors: validationErrors,
    message: `Shared goal pushed to ${pushedGoals?.length ?? 0} employees.`,
  }, { status: 201 });
}

// ─── GET — list all shared goals ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");

  let query = adminSupabase
    .from("goals")
    .select(`
      *,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department),
      primary_owner:profiles!goals_primary_owner_id_fkey(id, full_name)
    `)
    .eq("is_shared", true)
    .order("created_at", { ascending: false });

  if (cycleId) query = query.eq("cycle_id", cycleId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ shared_goals: data });
}
