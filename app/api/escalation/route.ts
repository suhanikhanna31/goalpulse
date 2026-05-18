// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/escalation        — List escalation rules and recent logs
// POST /api/escalation        — Admin creates/updates escalation rules
// POST /api/escalation?run=true — Trigger the escalation engine (cron or manual)
//
// BRD §5.3 Bonus: Escalation Module
// Conditions: goal not submitted within N days, not approved within N days,
//             check-in not completed within window.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { adminSupabase, getRequestUser, getUserProfile } from "../../../lib/supabase-server";
import { writeAuditLog } from "../../../lib/audit";

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Admin only." }, { status: 403 });
  }

  const [rules, logs] = await Promise.all([
    adminSupabase.from("escalation_rules").select("*").order("created_at"),
    adminSupabase
      .from("escalation_logs")
      .select(`
        *,
        employee:profiles!escalation_logs_employee_id_fkey(id, full_name, email),
        rule:escalation_rules(name, trigger_event)
      `)
      .order("escalated_at", { ascending: false })
      .limit(100),
  ]);

  return Response.json({
    rules: rules.data ?? [],
    recent_escalations: logs.data ?? [],
  });
}

// ─── POST — Create rule or run engine ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Admin only." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  // ── Run escalation engine ─────────────────────────────────────────────────
  if (searchParams.get("run") === "true") {
    const { cycle_id } = (await req.json()) as { cycle_id: string };
    const escalations = await runEscalationEngine(cycle_id, user.id);
    return Response.json({ triggered: escalations.length, escalations });
  }

  // ── Create/update rule ────────────────────────────────────────────────────
  const body = (await req.json()) as {
    name: string;
    trigger_event: string;
    threshold_days: number;
    notify_roles: string[];
    is_active?: boolean;
    id?: string;
  };

  const { name, trigger_event, threshold_days, notify_roles, id } = body;

  if (!name || !trigger_event || threshold_days == null || !notify_roles?.length) {
    return Response.json({ error: "name, trigger_event, threshold_days, notify_roles are required." }, { status: 400 });
  }

  const record = { name, trigger_event, threshold_days, notify_roles, is_active: body.is_active ?? true };

  const { data, error } = id
    ? await adminSupabase.from("escalation_rules").update(record).eq("id", id).select().single()
    : await adminSupabase.from("escalation_rules").insert([record]).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ rule: data }, { status: id ? 200 : 201 });
}

// ─── Engine ───────────────────────────────────────────────────────────────────
async function runEscalationEngine(cycleId: string, triggeredBy: string) {
  const now = new Date();
  const escalationResults: Record<string, unknown>[] = [];

  // Get active rules
  const { data: rules } = await adminSupabase
    .from("escalation_rules")
    .select("*")
    .eq("is_active", true);

  for (const rule of rules ?? []) {
    const thresholdMs = rule.threshold_days * 24 * 60 * 60 * 1000;

    // ── Rule: goals not submitted ─────────────────────────────────────────
    if (rule.trigger_event === "goal_not_submitted") {
      const { data: cycle } = await adminSupabase
        .from("cycles").select("goal_setting_opens").eq("id", cycleId).single();
      if (!cycle) continue;

      const openDate = new Date(cycle.goal_setting_opens);
      if (now.getTime() - openDate.getTime() < thresholdMs) continue;

      // Find employees who have no submitted/approved goals in this cycle
      const { data: employees } = await adminSupabase
        .from("profiles").select("id, manager_id").eq("role", "employee");

      const { data: submittedGoals } = await adminSupabase
        .from("goals")
        .select("employee_id")
        .eq("cycle_id", cycleId)
        .in("status", ["submitted", "approved", "locked"]);

      const submittedIds = new Set((submittedGoals ?? []).map((g) => g.employee_id));

      for (const emp of employees ?? []) {
        if (!submittedIds.has(emp.id)) {
          const log = await createEscalation(rule.id, emp.id, emp.manager_id, "Goal sheet not submitted after cycle open");
          if (log) escalationResults.push(log);
        }
      }
    }

    // ── Rule: goals not approved ──────────────────────────────────────────
    if (rule.trigger_event === "goal_not_approved") {
      const { data: pendingGoals } = await adminSupabase
        .from("goals")
        .select("id, employee_id, employee:profiles!goals_employee_id_fkey(manager_id), created_at")
        .eq("cycle_id", cycleId)
        .eq("status", "submitted");

      for (const goal of pendingGoals ?? []) {
        const submittedAt = new Date((goal as { created_at: string }).created_at);
        if (now.getTime() - submittedAt.getTime() >= thresholdMs) {
          const emp = goal.employee as { manager_id: string } | null;
          const log = await createEscalation(rule.id, goal.employee_id, emp?.manager_id ?? null, `Goal not approved after ${rule.threshold_days} days`);
          if (log) escalationResults.push(log);
        }
      }
    }

    // ── Rule: check-in not completed ──────────────────────────────────────
    if (rule.trigger_event === "checkin_not_completed") {
      const { data: cycle } = await adminSupabase
        .from("cycles").select("*").eq("id", cycleId).single();
      if (!cycle) continue;

      const periodNow = getPeriodOpen(cycle, now);
      if (!periodNow) continue;

      const { data: employees } = await adminSupabase
        .from("profiles").select("id, manager_id").eq("role", "employee");

      const { data: checkins } = await adminSupabase
        .from("checkins")
        .select("employee_id")
        .eq("cycle_id", cycleId)
        .eq("period", periodNow);

      const doneIds = new Set((checkins ?? []).map((c) => c.employee_id));

      for (const emp of employees ?? []) {
        if (!doneIds.has(emp.id)) {
          const log = await createEscalation(rule.id, emp.id, emp.manager_id, `${periodNow} check-in not completed`);
          if (log) escalationResults.push(log);
        }
      }
    }
  }

  await writeAuditLog({
    action: "ESCALATION_TRIGGERED",
    entityType: "escalation_engine",
    entityId: cycleId,
    actorId: triggeredBy,
    details: `Escalation engine ran for cycle ${cycleId}: ${escalationResults.length} escalations triggered`,
  });

  return escalationResults;
}

async function createEscalation(
  ruleId: string,
  employeeId: string,
  managerId: string | null,
  reason: string
): Promise<Record<string, unknown> | null> {
  // Check if already escalated recently (avoid duplicates within 24h)
  const { data: recent } = await adminSupabase
    .from("escalation_logs")
    .select("id, escalated_at")
    .eq("rule_id", ruleId)
    .eq("employee_id", employeeId)
    .is("resolved_at", null)
    .order("escalated_at", { ascending: false })
    .limit(1)
    .single();

  if (recent) {
    const last = new Date(recent.escalated_at);
    if (Date.now() - last.getTime() < 24 * 60 * 60 * 1000) return null; // skip if < 24h
  }

  const { data } = await adminSupabase
    .from("escalation_logs")
    .insert([{ rule_id: ruleId, employee_id: employeeId, manager_id: managerId, trigger_reason: reason }])
    .select()
    .single();

  return data ?? null;
}

function getPeriodOpen(cycle: Record<string, string>, now: Date): string | null {
  if (now >= new Date(cycle.q4_opens)) return "Q4";
  if (now >= new Date(cycle.q3_opens)) return "Q3";
  if (now >= new Date(cycle.q2_opens)) return "Q2";
  if (now >= new Date(cycle.q1_opens)) return "Q1";
  return null;
}
