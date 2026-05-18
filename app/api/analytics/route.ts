// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics
//
// BRD §5.4 Bonus: Analytics Module
// - QoQ goal achievement trends (individual, team, department)
// - Goal distribution by Thrust Area, UoM, status
// - Manager effectiveness (check-in completion rates)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile) return Response.json({ error: "Profile not found" }, { status: 404 });

  if (profile.role === "employee") {
    return Response.json({ error: "Access denied." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycle_id");
  const view = searchParams.get("view") ?? "overview"; // overview | qoq | distribution | manager_effectiveness

  if (!cycleId) return Response.json({ error: "cycle_id is required." }, { status: 400 });

  // ── Build base scope (manager only sees their team) ───────────────────────
  let employeeIds: string[] | null = null;
  if (profile.role === "manager") {
    const { data: reports } = await adminSupabase
      .from("profiles").select("id").eq("manager_id", user.id);
    employeeIds = (reports ?? []).map((r) => r.id);
  }

  // ── Fetch goals with checkins ─────────────────────────────────────────────
  let goalsQuery = adminSupabase
    .from("goals")
    .select(`
      id, title, thrust_area, uom, target, weightage, status,
      employee_id,
      employee:profiles!goals_employee_id_fkey(id, full_name, email, department, manager_id),
      checkins(period, computed_score, progress_status, checked_in_at, manager_comment)
    `)
    .eq("cycle_id", cycleId);

  if (employeeIds) goalsQuery = goalsQuery.in("employee_id", employeeIds);

  const { data: goals, error } = await goalsQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const allGoals = goals ?? [];

  // ── OVERVIEW ─────────────────────────────────────────────────────────────
  if (view === "overview") {
    const totalGoals = allGoals.length;
    const byStatus = allGoals.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = (acc[g.status] ?? 0) + 1;
      return acc;
    }, {});

    const allCheckins = allGoals.flatMap((g) => (g.checkins as { computed_score: number | null; period: string }[]) ?? []);
    const scoredCheckins = allCheckins.filter((c) => c.computed_score != null);
    const avgScore = scoredCheckins.length
      ? Math.round(scoredCheckins.reduce((s, c) => s + (c.computed_score ?? 0), 0) / scoredCheckins.length)
      : null;

    return Response.json({
      view: "overview",
      total_goals: totalGoals,
      by_status: byStatus,
      avg_achievement_score: avgScore,
      total_checkins: allCheckins.length,
      checkins_with_score: scoredCheckins.length,
    });
  }

  // ── QoQ TRENDS ────────────────────────────────────────────────────────────
  if (view === "qoq") {
    const periods = ["Q1", "Q2", "Q3", "Q4"];
    const qoq = periods.map((period) => {
      const periodCheckins = allGoals
        .flatMap((g) => (g.checkins as { period: string; computed_score: number | null }[]) ?? [])
        .filter((c) => c.period === period && c.computed_score != null);

      const avg = periodCheckins.length
        ? Math.round(periodCheckins.reduce((s, c) => s + (c.computed_score ?? 0), 0) / periodCheckins.length)
        : null;

      return { period, avg_score: avg, count: periodCheckins.length };
    });

    // By department QoQ
    const departments = [...new Set(allGoals.map((g) => (g.employee as { department: string } | null)?.department ?? "Unknown"))];
    const deptTrends = departments.map((dept) => {
      const deptGoals = allGoals.filter((g) => (g.employee as { department: string } | null)?.department === dept);
      const periodData = periods.map((period) => {
        const checkins = deptGoals
          .flatMap((g) => (g.checkins as { period: string; computed_score: number | null }[]) ?? [])
          .filter((c) => c.period === period && c.computed_score != null);
        return {
          period,
          avg_score: checkins.length
            ? Math.round(checkins.reduce((s, c) => s + (c.computed_score ?? 0), 0) / checkins.length)
            : null,
        };
      });
      return { department: dept, trend: periodData };
    });

    return Response.json({ view: "qoq", overall_trend: qoq, department_trends: deptTrends });
  }

  // ── DISTRIBUTION ──────────────────────────────────────────────────────────
  if (view === "distribution") {
    const byThrustArea = allGoals.reduce<Record<string, number>>((acc, g) => {
      acc[g.thrust_area] = (acc[g.thrust_area] ?? 0) + 1;
      return acc;
    }, {});

    const byUom = allGoals.reduce<Record<string, number>>((acc, g) => {
      acc[g.uom] = (acc[g.uom] ?? 0) + 1;
      return acc;
    }, {});

    const byProgressStatus = allGoals
      .flatMap((g) => (g.checkins as { progress_status: string }[]) ?? [])
      .reduce<Record<string, number>>((acc, c) => {
        acc[c.progress_status] = (acc[c.progress_status] ?? 0) + 1;
        return acc;
      }, {});

    const weightageByThrust = allGoals.reduce<Record<string, number>>((acc, g) => {
      acc[g.thrust_area] = (acc[g.thrust_area] ?? 0) + (g.weightage ?? 0);
      return acc;
    }, {});

    return Response.json({
      view: "distribution",
      by_thrust_area: byThrustArea,
      by_uom: byUom,
      by_progress_status: byProgressStatus,
      avg_weightage_by_thrust: Object.fromEntries(
        Object.entries(weightageByThrust).map(([k, v]) => [k, Math.round(v / (byThrustArea[k] || 1))])
      ),
    });
  }

  // ── MANAGER EFFECTIVENESS ─────────────────────────────────────────────────
  if (view === "manager_effectiveness") {
    // Get all managers
    const { data: managers } = await adminSupabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "manager");

    const effectiveness = await Promise.all(
      (managers ?? []).map(async (mgr) => {
        const { data: reports } = await adminSupabase
          .from("profiles").select("id").eq("manager_id", mgr.id);
        const reportIds = (reports ?? []).map((r) => r.id);

        const { data: teamCheckins } = await adminSupabase
          .from("checkins")
          .select("id, manager_comment, checked_in_at")
          .eq("cycle_id", cycleId)
          .in("employee_id", reportIds);

        const total = teamCheckins?.length ?? 0;
        const commented = teamCheckins?.filter((c) => c.manager_comment).length ?? 0;

        return {
          manager_id: mgr.id,
          manager_name: mgr.full_name,
          team_size: reportIds.length,
          total_checkins: total,
          comments_added: commented,
          checkin_completion_pct: total > 0 ? Math.round((commented / total) * 100) : 0,
        };
      })
    );

    return Response.json({
      view: "manager_effectiveness",
      managers: effectiveness.sort((a, b) => b.checkin_completion_pct - a.checkin_completion_pct),
    });
  }

  return Response.json({ error: `Unknown view "${view}".` }, { status: 400 });
}
