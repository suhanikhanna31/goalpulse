// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/cycles        — List all cycles
// POST /api/cycles        — Admin creates a new cycle
// PATCH /api/cycles/[id]  — Admin opens/closes a cycle
//
// BRD §2.3 Check-in Schedule + §3 Admin role
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { writeAuditLog } from "../../../lib/audit";

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await adminSupabase
    .from("cycles")
    .select("*")
    .order("year", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Attach "currently active period" to each cycle
  const now = new Date();
  const enriched = (data ?? []).map((cycle) => {
    let active_period: string | null = null;

    if (now >= new Date(cycle.q4_opens)) active_period = "Q4";
    else if (now >= new Date(cycle.q3_opens)) active_period = "Q3";
    else if (now >= new Date(cycle.q2_opens)) active_period = "Q2";
    else if (now >= new Date(cycle.q1_opens)) active_period = "Q1";
    else if (now >= new Date(cycle.goal_setting_opens)) active_period = "goal_setting";

    return { ...cycle, active_period };
  });

  return Response.json({ cycles: enriched });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Only admins can create cycles." }, { status: 403 });
  }

  const body = (await req.json()) as {
    name: string;
    year: number;
    goal_setting_opens: string;
    q1_opens: string;
    q2_opens: string;
    q3_opens: string;
    q4_opens: string;
  };

  const { name, year, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens } = body;

  if (!name || !year || !goal_setting_opens || !q1_opens || !q2_opens || !q3_opens || !q4_opens) {
    return Response.json({ error: "All cycle dates are required." }, { status: 400 });
  }

  const { data: cycle, error } = await adminSupabase
    .from("cycles")
    .insert([{ name, year, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens, status: "open" }])
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    action: "CYCLE_CREATED",
    entityType: "cycle",
    entityId: cycle.id,
    actorId: user.id,
    newValue: body,
    details: `Cycle "${name}" (${year}) created by ${profile.full_name}`,
  });

  return Response.json({ cycle }, { status: 201 });
}
