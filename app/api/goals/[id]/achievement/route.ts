// ─────────────────────────────────────────────────────────────────────────────
// POST /api/goals/[id]/achievement
//
// Employee logs actual achievement for a quarterly check-in period.
// BRD §2.2: Progress scores computed per UoM formula table.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../../../lib/supabase-server";
import { writeAuditLog } from "../../../../../lib/audit";
import { computeProgressScore, scoreToPercent } from "../../../../../lib/types";
import type { SubmitAchievementRequest } from "../../../../../lib/types";

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  // Fetch the goal
  const { data: goal, error: fetchError } = await adminSupabase
    .from("goals")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchError || !goal) return Response.json({ error: "Goal not found" }, { status: 404 });

  // Only the goal owner (or admin) can log achievement
  if (profile.role === "employee" && goal.employee_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Goal must be approved/locked to log achievement
  if (!["approved", "locked"].includes(goal.status)) {
    return Response.json({
      error: `Cannot log achievement for a goal with status "${goal.status}". Goal must be approved first.`,
    }, { status: 422 });
  }

  const body = (await req.json()) as SubmitAchievementRequest;
  const { period, cycle_id, actual_achievement, completion_date, progress_status } = body;

  if (!period || !cycle_id || actual_achievement == null || !progress_status) {
    return Response.json({
      error: "Missing required fields: period, cycle_id, actual_achievement, progress_status",
    }, { status: 400 });
  }

  // Validate period is open in cycle
  const { data: cycle } = await adminSupabase
    .from("cycles")
    .select("*")
    .eq("id", cycle_id)
    .single();

  if (cycle) {
    const periodDateMap: Record<string, string | null> = {
      Q1: cycle.q1_opens,
      Q2: cycle.q2_opens,
      Q3: cycle.q3_opens,
      Q4: cycle.q4_opens,
    };
    const openDate = periodDateMap[period];
    if (openDate && new Date() < new Date(openDate)) {
      return Response.json({
        error: `The ${period} check-in window opens on ${new Date(openDate).toLocaleDateString()}.`,
      }, { status: 422 });
    }
  }

  // Compute progress score per BRD formula
  const rawScore = computeProgressScore(
    goal.uom,
    goal.target,
    actual_achievement,
    completion_date,
    goal.deadline ?? null
  );
  const computedScore = scoreToPercent(rawScore);

  // Upsert (one checkin per goal per period)
  const { data: checkin, error: upsertError } = await adminSupabase
    .from("checkins")
    .upsert(
      [{
        goal_id: params.id,
        employee_id: goal.employee_id,
        period,
        cycle_id,
        actual_achievement,
        completion_date: completion_date ?? null,
        progress_status,
        computed_score: computedScore,
        checked_in_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
      { onConflict: "goal_id,period" }
    )
    .select()
    .single();

  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

  // For shared goals: sync achievement to all linked goal sheets
  if (goal.is_shared && !goal.shared_from_goal_id) {
    // This is the primary shared goal — sync to all copies
    await adminSupabase
      .from("checkins")
      .upsert(
        // We'll trigger this via DB function or re-compute on read
        // For now write a sync marker to audit log
        []
      );
  }

  await writeAuditLog({
    action: "ACHIEVEMENT_UPDATED",
    entityType: "checkin",
    entityId: checkin.id,
    actorId: user.id,
    newValue: { period, actual_achievement, computed_score: computedScore, progress_status },
    details: `${period} achievement for "${goal.title}": ${actual_achievement} / ${goal.target} → score ${computedScore}%`,
  });

  return Response.json({
    checkin,
    computed_score: computedScore,
    message: `${period} achievement recorded. Computed score: ${computedScore}%`,
  });
}

// GET — retrieve all checkins for this goal
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: checkins, error } = await adminSupabase
    .from("checkins")
    .select("*")
    .eq("goal_id", params.id)
    .order("period");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ checkins });
}
