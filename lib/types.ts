// ─────────────────────────────────────────────────────────────────────────────
// GoalPulse — Core Types
// Aligned with AtomQuest Hackathon 1.0 BRD
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = "employee" | "manager" | "admin";

export type GoalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "returned"
  | "locked";

export type GoalProgressStatus = "not_started" | "on_track" | "completed";

/** Unit of Measurement — determines progress scoring formula */
export type UoM = "numeric_min" | "numeric_max" | "timeline" | "zero";

/** Quarterly periods for check-ins */
export type CheckinPeriod = "Q1" | "Q2" | "Q3" | "Q4";

export type CycleStatus = "open" | "closed";

// ─── Database row shapes ────────────────────────────────────────────────────

export interface DbGoal {
  id: string;
  employee_id: string;
  cycle_id: string;
  thrust_area: string;
  title: string;
  description: string;
  uom: UoM;
  target: number;
  weightage: number;
  status: GoalStatus;
  is_shared: boolean;
  shared_from_goal_id: string | null;
  primary_owner_id: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  ai_score: number | null;
  ai_grade: string | null;
}

export interface DbCheckin {
  id: string;
  goal_id: string;
  employee_id: string;
  period: CheckinPeriod;
  cycle_id: string;
  actual_achievement: number;
  completion_date: string | null;
  progress_status: GoalProgressStatus;
  computed_score: number | null;
  manager_comment: string | null;
  manager_id: string | null;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbCycle {
  id: string;
  name: string;
  year: number;
  goal_setting_opens: string;
  q1_opens: string;
  q2_opens: string;
  q3_opens: string;
  q4_opens: string;
  status: CycleStatus;
  created_at: string;
}

export interface DbAuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  details: string;
  created_at: string;
}

export interface DbEscalationRule {
  id: string;
  name: string;
  trigger_event: string;
  threshold_days: number;
  notify_roles: UserRole[];
  is_active: boolean;
  created_at: string;
}

export interface DbEscalationLog {
  id: string;
  rule_id: string;
  employee_id: string;
  manager_id: string | null;
  trigger_reason: string;
  escalated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ─── API request/response shapes ─────────────────────────────────────────────

export interface CreateGoalRequest {
  cycle_id: string;
  thrust_area: string;
  title: string;
  description: string;
  uom: UoM;
  target: number;
  weightage: number;
}

export interface UpdateGoalRequest {
  target?: number;
  weightage?: number;
  description?: string;
  thrust_area?: string;
}

export interface ApproveGoalRequest {
  action: "approve" | "return";
  /** Inline edits manager can make during approval */
  target?: number;
  weightage?: number;
  comment?: string;
}

export interface SubmitAchievementRequest {
  period: CheckinPeriod;
  cycle_id: string;
  actual_achievement: number;
  completion_date?: string;
  progress_status: GoalProgressStatus;
}

export interface ManagerCheckinRequest {
  checkin_id: string;
  comment: string;
}

export interface PushSharedGoalRequest {
  goal_title: string;
  description: string;
  thrust_area: string;
  uom: UoM;
  target: number;
  cycle_id: string;
  employee_ids: string[];
  default_weightage: number;
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Compute progress score (0–1) based on UoM type.
 * BRD Section 2.2 formula table.
 */
export function computeProgressScore(
  uom: UoM,
  target: number,
  actual: number,
  completionDate?: string | null,
  deadline?: string | null
): number {
  switch (uom) {
    case "numeric_min":
      // Higher is better (e.g. Sales Revenue)
      return target === 0 ? 1 : Math.min(actual / target, 1.5);

    case "numeric_max":
      // Lower is better (e.g. TAT, Cost)
      if (actual === 0) return 1.5; // over-achievement
      return Math.min(target / actual, 1.5);

    case "timeline": {
      if (!completionDate || !deadline) return 0;
      const completedMs = new Date(completionDate).getTime();
      const deadlineMs = new Date(deadline).getTime();
      // On time = 100%, early = bonus, late = proportionally lower
      if (completedMs <= deadlineMs) return 1;
      const lateDays = (completedMs - deadlineMs) / (1000 * 60 * 60 * 24);
      return Math.max(0, 1 - lateDays / 30); // lose ~3.3% per late day
    }

    case "zero":
      // Zero incidents = success
      return actual === 0 ? 1 : 0;

    default:
      return 0;
  }
}

/** Convert raw score (0–1+) to percentage clamped at 150% for display */
export function scoreToPercent(score: number): number {
  return Math.round(Math.min(score * 100, 150));
}
