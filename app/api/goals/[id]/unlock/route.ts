// ─────────────────────────────────────────────────────────────────────────────
// POST /api/goals/[id]/unlock
//
// Admin-only: unlock an approved/locked goal for editing.
// BRD §2.1: "On approval, goals are locked — no further edits without Admin."
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../../../lib/supabase-server";
import { writeAuditLog } from "../../../../../lib/audit";

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Only Admins can unlock goals." }, { status: 403 });
  }

  const { reason } = (await req.json()) as { reason?: string };

  const { data: goal } = await adminSupabase
    .from("goals")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!goal) return Response.json({ error: "Goal not found" }, { status: 404 });

  const { data: unlocked, error } = await adminSupabase
    .from("goals")
    .update({
      status: "draft",
      locked_at: null,
      locked_by: null,
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    action: "GOAL_UNLOCKED",
    entityType: "goal",
    entityId: params.id,
    actorId: user.id,
    oldValue: { status: goal.status, locked_at: goal.locked_at },
    newValue: { status: "draft", locked_at: null },
    details: `Goal "${goal.title}" unlocked by Admin ${profile.full_name}. Reason: ${reason ?? "Not specified"}`,
  });

  return Response.json({ goal: unlocked, message: "Goal unlocked and reset to draft." });
}
