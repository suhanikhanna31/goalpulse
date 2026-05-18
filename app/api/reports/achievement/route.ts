// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/achievement
//
// BRD §4: "Achievement Report: Exportable (CSV/Excel) showing Planned Target
//          vs. Actual Achievement for all employees."
//
// Returns JSON by default; pass ?format=csv for CSV download.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../../lib/supabase-server";
import { writeAuditLog } from "../../../../lib/audit";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  // Only managers and admins can access the report
  if (profile.role === "employee") {
    return Response.json({ error: "Access denied." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const period = searchParams.get("period"); // optional filter
  const format = searchParams.get("format") ?? "json";
  const departmentFilter = searchParams.get("department");

  if (!cycleId) {
    return Response.json({ error: "cycle_id is required." }, { status: 400 });
  }

  // Fetch goals with checkins and employee info
  let goalsQuery = adminSupabase
    .from("goals")
    .select(`
      id, title, thrust_area, uom, target, weightage, status,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department, manager_id),
      checkins(period, actual_achievement, computed_score, progress_status, manager_comment, checked_in_at)
    `)
    .eq("cycle_id", cycleId)
    .eq("is_shared", false); // avoid double-counting shared goal copies unless primary

  if (profile.role === "manager") {
    const { data: reports } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("manager_id", user.id);
    const ids = (reports ?? []).map((r) => r.id);
    goalsQuery = goalsQuery.in("employee_id", ids);
  }

  if (departmentFilter) {
    // Filter via subquery — Supabase supports this via the joined profile
    goalsQuery = goalsQuery.eq("employee.department", departmentFilter);
  }

  const { data: goals, error } = await goalsQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Build flat report rows
  const rows: Record<string, unknown>[] = [];
  for (const goal of goals ?? []) {
    const emp = goal.employee as { full_name: string; email: string; department: string } | null;
    const checkinsByPeriod = Object.fromEntries(
      ((goal.checkins as { period: string; actual_achievement: number; computed_score: number; progress_status: string }[]) ?? []).map((c) => [c.period, c])
    );

    const periods = period ? [period] : ["Q1", "Q2", "Q3", "Q4"];
    for (const p of periods) {
      const checkin = checkinsByPeriod[p];
      rows.push({
        employee_name: emp?.full_name ?? "",
        employee_email: emp?.email ?? "",
        department: emp?.department ?? "",
        goal_title: goal.title,
        thrust_area: goal.thrust_area,
        uom: goal.uom,
        target: goal.target,
        weightage: goal.weightage,
        period: p,
        actual_achievement: checkin?.actual_achievement ?? null,
        computed_score_pct: checkin?.computed_score ?? null,
        progress_status: checkin?.progress_status ?? "not_started",
        manager_comment: checkin?.manager_comment ?? null,
        checked_in_at: checkin?.checked_in_at ?? null,
      });
    }
  }

  await writeAuditLog({
    action: "EXPORT_GENERATED",
    entityType: "report",
    entityId: cycleId,
    actorId: user.id,
    details: `Achievement report exported (format: ${format}) for cycle ${cycleId} by ${profile.full_name}`,
  });

  // ── CSV output ────────────────────────────────────────────────────────────
  if (format === "csv") {
    if (rows.length === 0) {
      return new Response("No data", { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val == null) return "";
            const str = String(val);
            return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(",")
      ),
    ].join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="achievement_report_${cycleId}_${period ?? "all"}.csv"`,
      },
    });
  }

  // ── JSON summary ──────────────────────────────────────────────────────────
  const summary = {
    total_goals: goals?.length ?? 0,
    total_checkins: rows.filter((r) => r.actual_achievement != null).length,
    avg_score:
      rows.filter((r) => r.computed_score_pct != null).length > 0
        ? Math.round(
            rows.filter((r) => r.computed_score_pct != null).reduce((s, r) => s + (r.computed_score_pct as number), 0) /
              rows.filter((r) => r.computed_score_pct != null).length
          )
        : null,
    completion_rate: rows.length > 0
      ? Math.round((rows.filter((r) => r.actual_achievement != null).length / rows.length) * 100)
      : 0,
  };

  return Response.json({ report: rows, summary });
}
