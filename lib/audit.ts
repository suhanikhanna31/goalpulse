// ─────────────────────────────────────────────────────────────────────────────
// GoalPulse — Audit Trail
// BRD §4: "System must log all changes made to goals after the lock date —
//          capturing who changed what and when."
// ─────────────────────────────────────────────────────────────────────────────

import { adminSupabase } from "./supabase-server";

export type AuditAction =
  | "GOAL_CREATED"
  | "GOAL_UPDATED"
  | "GOAL_SUBMITTED"
  | "GOAL_APPROVED"
  | "GOAL_RETURNED"
  | "GOAL_LOCKED"
  | "GOAL_UNLOCKED"
  | "GOAL_SHARED"
  | "CHECKIN_SUBMITTED"
  | "CHECKIN_MANAGER_COMMENT"
  | "ACHIEVEMENT_UPDATED"
  | "CYCLE_CREATED"
  | "CYCLE_OPENED"
  | "CYCLE_CLOSED"
  | "ESCALATION_TRIGGERED"
  | "ESCALATION_RESOLVED"
  | "USER_ROLE_CHANGED"
  | "AI_SCORE_GENERATED"
  | "EXPORT_GENERATED";

export async function writeAuditLog(opts: {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  details: string;
}) {
  const { error } = await adminSupabase.from("audit_logs").insert([
    {
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      actor_id: opts.actorId ?? null,
      old_value: opts.oldValue ?? null,
      new_value: opts.newValue ?? null,
      details: opts.details,
    },
  ]);

  if (error) {
    // Non-fatal — don't block the main operation, but log to server console
    console.error("[AuditLog] Failed to write audit log:", error.message, opts);
  }
}
