// ─────────────────────────────────────────────────────────────────────────────
// POST /api/goals/[id]/approve
//
// Manager (L1) approves or returns a goal.
// BRD §2.1: "On approval, goals are locked — no further edits without Admin."
//           "Ability to edit targets / weightages inline or return for rework."
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server"

import {
  adminSupabase,
  getRequestUser,
  getUserProfile,
} from "../../../../../lib/supabase-server"

import { validateGoalWeightage } from "../../../../../lib/validation"

import { writeAuditLog } from "../../../../../lib/audit"

import type { ApproveGoalRequest } from "../../../../../lib/types"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(
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

  // Only managers/admins
  if (profile.role === "employee") {
    return Response.json(
      {
        error:
          "Only managers or admins can approve goals.",
      },
      { status: 403 }
    )
  }

  // Fetch goal
  const {
    data: goal,
    error: fetchError,
  } = await adminSupabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single()

  if (fetchError || !goal) {
    return Response.json(
      { error: "Goal not found" },
      { status: 404 }
    )
  }

  // Must be submitted
  if (goal.status !== "submitted") {
    return Response.json(
      {
        error: `Goal is currently "${goal.status}". Only submitted goals can be approved or returned.`,
      },
      { status: 422 }
    )
  }

  // Managers only approve direct reports
  if (profile.role === "manager") {
    const { data: employeeProfile } =
      await adminSupabase
        .from("profiles")
        .select("manager_id")
        .eq("id", goal.employee_id)
        .single()

    if (
      !employeeProfile ||
      employeeProfile.manager_id !== user.id
    ) {
      return Response.json(
        {
          error:
            "You can only approve goals of your direct reports.",
        },
        { status: 403 }
      )
    }
  }

  const body =
    (await req.json()) as ApproveGoalRequest

  const {
    action,
    target,
    weightage,
    comment,
  } = body

  if (
    !action ||
    !["approve", "return"].includes(action)
  ) {
    return Response.json(
      {
        error:
          "Action must be 'approve' or 'return'.",
      },
      { status: 400 }
    )
  }

  // ── RETURN ───────────────────────────────────────────
  if (action === "return") {
    const {
      data: updated,
      error,
    } = await adminSupabase
      .from("goals")
      .update({
        status: "returned",
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 }
      )
    }

    await writeAuditLog({
      action: "GOAL_RETURNED",
      entityType: "goal",
      entityId: id,
      actorId: user.id,
      oldValue: {
        status: "submitted",
      },
      newValue: {
        status: "returned",
        comment,
      },
      details: `Goal "${goal.title}" returned for rework by ${profile.full_name}. Reason: ${
        comment ?? "Not specified"
      }`,
    })

    return Response.json({
      goal: updated,
      message: "Goal returned for rework.",
    })
  }

  // ── APPROVE ─────────────────────────────────────────
  const updates: Record<
    string,
    unknown
  > = {
    status: "approved",
    approved_at:
      new Date().toISOString(),
    approved_by: user.id,
    locked_at:
      new Date().toISOString(),
    locked_by: user.id,
    updated_at:
      new Date().toISOString(),
  }

  // Inline edits
  if (target != null) {
    updates.target = target
  }

  if (weightage != null) {
    const validation =
      await validateGoalWeightage(
        goal.employee_id,
        goal.cycle_id,
        weightage,
        id
      )

    if (!validation.valid) {
      return Response.json(
        {
          error:
            "Weightage validation failed",
          details: validation.errors,
        },
        { status: 422 }
      )
    }

    updates.weightage = weightage
  }

  const {
    data: approved,
    error: approveError,
  } = await adminSupabase
    .from("goals")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (approveError) {
    return Response.json(
      { error: approveError.message },
      { status: 500 }
    )
  }

  await writeAuditLog({
    action: "GOAL_APPROVED",
    entityType: "goal",
    entityId: id,
    actorId: user.id,
    oldValue: {
      status: "submitted",
      target: goal.target,
      weightage: goal.weightage,
    },
    newValue: {
      status: "approved",
      target:
        updates.target ?? goal.target,
      weightage:
        updates.weightage ??
        goal.weightage,
    },
    details: `Goal "${goal.title}" approved and locked by ${profile.full_name}`,
  })

  return Response.json({
    goal: approved,
    message: "Goal approved and locked.",
  })
}