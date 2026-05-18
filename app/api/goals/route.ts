// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/goals        — List goals (filtered by role)
// POST /api/goals        — Create a new goal
// POST /api/goals?submit=true — Submit all draft goals for a cycle (sets to "submitted")
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { validateGoalWeightage, validateSubmissionWeightage } from "../../../lib/validation";
import { writeAuditLog } from "../../../lib/audit";
import type { CreateGoalRequest } from "../../../lib/types";

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const employeeId = searchParams.get("employee_id"); // managers filtering by specific employee

  let query = adminSupabase
    .from("goals")
    .select(`
      *,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department),
      checkins(*)
    `)
    .order("created_at", { ascending: false });

  if (cycleId) query = query.eq("cycle_id", cycleId);

  // Role-based data scoping
  if (profile.role === "employee") {
    // Employees only see their own goals
    query = query.eq("employee_id", user.id);
  } else if (profile.role === "manager") {
    // Managers see their direct reports' goals
    if (employeeId) {
      query = query.eq("employee_id", employeeId);
    } else {
      // Get all direct reports
      const { data: reports } = await adminSupabase
        .from("profiles")
        .select("id")
        .eq("manager_id", user.id);
      const reportIds = (reports ?? []).map((r) => r.id);
      reportIds.push(user.id); // managers can also see their own goals
      query = query.in("employee_id", reportIds);
    }
  }
  // admin sees everything (no additional filter)

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ goals: data });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);

  // ── Submit all goals for approval ──────────────────────────────────────────
  if (searchParams.get("submit") === "true") {
    const { cycle_id } = (await req.json()) as { cycle_id: string };

    // Validate total weightage = 100%
    const validation = await validateSubmissionWeightage(user.id, cycle_id);
    if (!validation.valid) {
      return Response.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
    }

    // Transition all draft goals to "submitted"
    const { data: updatedGoals, error: updateError } = await adminSupabase
      .from("goals")
      .update({ status: "submitted" })
      .eq("employee_id", user.id)
      .eq("cycle_id", cycle_id)
      .eq("status", "draft")
      .select("id, title");

    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

    await writeAuditLog({
      action: "GOAL_SUBMITTED",
      entityType: "goal_sheet",
      entityId: `${user.id}:${cycle_id}`,
      actorId: user.id,
      details: `Employee ${profile.full_name} submitted ${updatedGoals?.length ?? 0} goals for cycle ${cycle_id}`,
    });

    return Response.json({
      message: `${updatedGoals?.length ?? 0} goals submitted for manager approval.`,
      goals: updatedGoals,
    });
  }

  // ── Create a new goal ──────────────────────────────────────────────────────
  const body = (await req.json()) as CreateGoalRequest;

  const { cycle_id, thrust_area, title, description, uom, target, weightage } = body;

  if (!cycle_id || !thrust_area || !title || !description || !uom || target == null || weightage == null) {
    return Response.json({ error: "Missing required fields: cycle_id, thrust_area, title, description, uom, target, weightage" }, { status: 400 });
  }

  // Only employees create goals; admin/manager can create on behalf of an employee
  const targetEmployeeId =
    (profile.role !== "employee" && body.employee_id) ? body.employee_id : user.id;

  // Validate weightage rules
  const validation = await validateGoalWeightage(targetEmployeeId, cycle_id, weightage);
  if (!validation.valid) {
    return Response.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  }

  const { data: goal, error: insertError } = await adminSupabase
    .from("goals")
    .insert([{
      employee_id: targetEmployeeId,
      cycle_id,
      thrust_area: thrust_area.trim(),
      title: title.trim(),
      description: description.trim(),
      uom,
      target,
      weightage,
      status: "draft",
      is_shared: false,
    }])
    .select()
    .single();

  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  await writeAuditLog({
    action: "GOAL_CREATED",
    entityType: "goal",
    entityId: goal.id,
    actorId: user.id,
    newValue: { title, thrust_area, uom, target, weightage },
    details: `Goal created: "${title}" by ${profile.full_name}`,
  });

  return Response.json({ goal }, { status: 201 });
}
