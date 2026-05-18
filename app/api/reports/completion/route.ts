// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/completion
//
// BRD §4: "Completion Dashboard: Real-time view of which employees and
//          managers have completed quarterly check-ins."
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../../lib/supabase-server";

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
  const period = searchParams.get("period") ?? "Q1";

  if (!cycleId) return Response.json({ error: "cycle_id is required." }, { status: 400 });

  // Get all employees (and their managers)
  let empQuery = adminSupabase
    .from("profiles")
    .select("id, full_name, email, department, manager_id, manager:profiles!profiles_manager_id_fkey(id, full_name)")
    .eq("role", "employee");

  if (profile.role === "manager") {
    empQuery = empQuery.eq("manager_id", user.id);
  }

  const { data: employees, error: empError } = await empQuery;
  if (empError) return Response.json({ error: empError.message }, { status: 500 });

  // Get check-ins for this cycle+period
  const { data: checkins, error: ciError } = await adminSupabase
    .from("checkins")
    .select("employee_id, goal_id, period, checked_in_at, manager_comment, manager_id")
    .eq("cycle_id", cycleId)
    .eq("period", period);

  if (ciError) return Response.json({ error: ciError.message }, { status: 500 });

  // Get goals count per employee to know how many check-ins are needed
  const { data: goalCounts } = await adminSupabase
    .from("goals")
    .select("employee_id, id")
    .eq("cycle_id", cycleId)
    .in("status", ["approved", "locked"]);

  const goalCountByEmployee: Record<string, number> = {};
  for (const g of goalCounts ?? []) {
    goalCountByEmployee[g.employee_id] = (goalCountByEmployee[g.employee_id] ?? 0) + 1;
  }

  const checkinsByEmployee: Record<string, typeof checkins> = {};
  for (const ci of checkins ?? []) {
    if (!checkinsByEmployee[ci.employee_id]) checkinsByEmployee[ci.employee_id] = [];
    checkinsByEmployee[ci.employee_id].push(ci);
  }

  const rows = (employees ?? []).map((emp) => {
    const empCheckins = checkinsByEmployee[emp.id] ?? [];
    const totalGoals = goalCountByEmployee[emp.id] ?? 0;
    const checkedIn = empCheckins.length;
    const managerCommented = empCheckins.filter((c) => c.manager_comment).length;

    return {
      employee_id: emp.id,
      employee_name: emp.full_name,
      email: emp.email,
      department: emp.department,
      manager_name: (emp.manager as { full_name: string } | null)?.full_name ?? null,
      total_goals: totalGoals,
      checkins_submitted: checkedIn,
      employee_completion_pct: totalGoals > 0 ? Math.round((checkedIn / totalGoals) * 100) : 0,
      manager_comments_added: managerCommented,
      manager_completion_pct: checkedIn > 0 ? Math.round((managerCommented / checkedIn) * 100) : 0,
      employee_done: checkedIn === totalGoals && totalGoals > 0,
      manager_done: managerCommented === checkedIn && checkedIn > 0,
    };
  });

  // Summary stats
  const total = rows.length;
  const employeeDone = rows.filter((r) => r.employee_done).length;
  const managerDone = rows.filter((r) => r.manager_done).length;

  // Group by department
  const byDepartment: Record<string, { total: number; done: number }> = {};
  for (const row of rows) {
    const dept = row.department ?? "Unknown";
    if (!byDepartment[dept]) byDepartment[dept] = { total: 0, done: 0 };
    byDepartment[dept].total++;
    if (row.employee_done) byDepartment[dept].done++;
  }

  return Response.json({
    cycle_id: cycleId,
    period,
    summary: {
      total_employees: total,
      employee_checkin_done: employeeDone,
      employee_checkin_pct: total > 0 ? Math.round((employeeDone / total) * 100) : 0,
      manager_checkin_done: managerDone,
      manager_checkin_pct: total > 0 ? Math.round((managerDone / total) * 100) : 0,
    },
    by_department: byDepartment,
    employees: rows,
  });
}
