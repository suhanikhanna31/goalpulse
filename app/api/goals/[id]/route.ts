// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/goals/[id]  — Get a single goal with checkins
// PATCH  /api/goals/[id]  — Update goal fields (pre-approval only)
// DELETE /api/goals/[id]  — Delete a draft goal
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server"

import {
  adminSupabase,
  getRequestUser,
  getUserProfile,
} from "../../../../lib/supabase-server"

import {
  isGoalEditable,
  validateGoalWeightage,
} from "../../../../lib/validation"

import { writeAuditLog } from "../../../../lib/audit"

import type { UpdateGoalRequest } from "../../../../lib/types"

type RouteContext = {
  params: Promise<{ id: string }>
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  const user = await getRequestUser(req)

  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const {
    data: goal,
    error,
  } = await adminSupabase
    .from("goals")
    .select(`
      *,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department),
      approved_by_profile:profiles!goals_approved_by_fkey(id, full_name),
      checkins(*)
    `)
    .eq("id", id)
    .single()

  if (error || !goal) {
    return Response.json(
      { error: "Goal not found" },
      { status: 404 }
    )
  }

  return Response.json({ goal })
}

// ─── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  const user = await getRequestUser(req)

  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const profile = await getUserProfile(user.id)

  if (!profile) {
    return Response.json(
      { error: "Profile not found" },
      { status: 404 }
    )
  }

  // Fetch current goal
  const {
    data: currentGoal,
    error: fetchError,
  } = await adminSupabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single()

  if (fetchError || !currentGoal) {
    return Response.json(
      { error: "Goal not found" },
      { status: 404 }
    )
  }

  // Check editability
  const editCheck =
    await isGoalEditable(
      id,
      profile.role
    )

  if (!editCheck.editable) {
    return Response.json(
      { error: editCheck.reason },
      { status: 403 }
    )
  }

  // Employees edit own goals only
  if (
    profile.role === "employee" &&
    currentGoal.employee_id !== user.id
  ) {
    return Response.json(
      { error: "Forbidden" },
      { status: 403 }
    )
  }

  const body =
    (await req.json()) as UpdateGoalRequest & {
      employee_id?: string
    }

  const updates: Record<
    string,
    unknown
  > = {}

  if (body.target != null) {
    updates.target = body.target
  }

  if (body.description != null) {
    updates.description =
      body.description.trim()
  }

  if (body.thrust_area != null) {
    updates.thrust_area =
      body.thrust_area.trim()
  }

  // Weightage validation
  if (body.weightage != null) {
    const validation =
      await validateGoalWeightage(
        currentGoal.employee_id,
        currentGoal.cycle_id,
        body.weightage,
        id
      )

    if (!validation.valid) {
      return Response.json(
        {
          error: "Validation failed",
          details: validation.errors,
        },
        { status: 422 }
      )
    }

    updates.weightage =
      body.weightage
  }

  // Shared goals restriction
  if (
    currentGoal.is_shared &&
    profile.role === "employee"
  ) {
    const allowedKeys =
      Object.keys(updates).filter(
        (k) => k !== "weightage"
      )

    if (allowedKeys.length > 0) {
      return Response.json(
        {
          error:
            "Shared goals only allow weightage changes.",
          blocked_fields: allowedKeys,
        },
        { status: 403 }
      )
    }
  }

  updates.updated_at =
    new Date().toISOString()

  const {
    data: updated,
    error: updateError,
  } = await adminSupabase
    .from("goals")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (updateError) {
    return Response.json(
      { error: updateError.message },
      { status: 500 }
    )
  }

  await writeAuditLog({
    action: "GOAL_UPDATED",
    entityType: "goal",
    entityId: id,
    actorId: user.id,
    oldValue: {
      target: currentGoal.target,
      weightage:
        currentGoal.weightage,
      description:
        currentGoal.description,
    },
    newValue: updates,
    details: `Goal "${currentGoal.title}" updated by ${profile.full_name} (${profile.role})`,
  })

  return Response.json({
    goal: updated,
  })
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  const user = await getRequestUser(req)

  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const profile = await getUserProfile(user.id)

  if (!profile) {
    return Response.json(
      { error: "Profile not found" },
      { status: 404 }
    )
  }

  const { data: goal } =
    await adminSupabase
      .from("goals")
      .select("*")
      .eq("id", id)
      .single()

  if (!goal) {
    return Response.json(
      { error: "Goal not found" },
      { status: 404 }
    )
  }

  // Only draft deletions
  if (goal.status !== "draft") {
    if (profile.role !== "admin") {
      return Response.json(
        {
          error:
            "Only draft goals can be deleted.",
        },
        { status: 403 }
      )
    }
  }

  if (
    profile.role === "employee" &&
    goal.employee_id !== user.id
  ) {
    return Response.json(
      { error: "Forbidden" },
      { status: 403 }
    )
  }

  const { error } =
    await adminSupabase
      .from("goals")
      .delete()
      .eq("id", id)

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }

  await writeAuditLog({
    action: "GOAL_UPDATED",
    entityType: "goal",
    entityId: id,
    actorId: user.id,
    oldValue: {
      title: goal.title,
      status: goal.status,
    },
    details: `Goal "${goal.title}" deleted by ${profile.full_name}`,
  })

  return Response.json({
    message: "Goal deleted.",
  })
}