// ─────────────────────────────────────────────────────────────────────────────
// GoalPulse — Validation Engine
// Enforces all BRD business rules from Section 2.1
// ─────────────────────────────────────────────────────────────────────────────

import { adminSupabase } from "./supabase-server";

export const GOAL_RULES = {
  MAX_GOALS_PER_EMPLOYEE: 8,
  MIN_WEIGHTAGE: 10,
  TOTAL_WEIGHTAGE: 100,
} as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that adding/updating a goal won't violate BRD weightage & count rules.
 *
 * @param employeeId  - The employee whose goals are being checked
 * @param cycleId     - The current cycle
 * @param newWeightage - The weightage of the goal being added or updated
 * @param excludeGoalId - When updating, exclude this goal from the existing total
 */
export async function validateGoalWeightage(
  employeeId: string,
  cycleId: string,
  newWeightage: number,
  excludeGoalId?: string
): Promise<ValidationResult> {
  const errors: string[] = [];

  // Rule: min 10% per goal
  if (newWeightage < GOAL_RULES.MIN_WEIGHTAGE) {
    errors.push(
      `Minimum weightage per goal is ${GOAL_RULES.MIN_WEIGHTAGE}%. You entered ${newWeightage}%.`
    );
  }

  // Rule: max 100%
  if (newWeightage > 100) {
    errors.push("Weightage cannot exceed 100%.");
  }

  // Fetch existing goals for this employee in this cycle
  let query = adminSupabase
    .from("goals")
    .select("id, weightage")
    .eq("employee_id", employeeId)
    .eq("cycle_id", cycleId)
    .not("status", "eq", "returned"); // returned goals are excluded from total

  if (excludeGoalId) {
    query = query.neq("id", excludeGoalId);
  }

  const { data: existingGoals, error } = await query;

  if (error) {
    return { valid: false, errors: ["Failed to validate goals: " + error.message] };
  }

  const existingGoalsList = existingGoals ?? [];

  // Rule: max 8 goals
  if (!excludeGoalId && existingGoalsList.length >= GOAL_RULES.MAX_GOALS_PER_EMPLOYEE) {
    errors.push(
      `Maximum ${GOAL_RULES.MAX_GOALS_PER_EMPLOYEE} goals per employee per cycle. You already have ${existingGoalsList.length}.`
    );
  }

  // Rule: total weightage must equal 100%
  const existingTotal = existingGoalsList.reduce((sum, g) => sum + (g.weightage ?? 0), 0);
  const newTotal = existingTotal + newWeightage;

  if (newTotal > GOAL_RULES.TOTAL_WEIGHTAGE) {
    errors.push(
      `Total weightage would be ${newTotal}%. Maximum is ${GOAL_RULES.TOTAL_WEIGHTAGE}%. ` +
        `You have ${GOAL_RULES.TOTAL_WEIGHTAGE - existingTotal}% remaining.`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a set of goals (before final submission) sums exactly to 100%.
 * Called at submission time.
 */
export async function validateSubmissionWeightage(
  employeeId: string,
  cycleId: string
): Promise<ValidationResult> {
  const errors: string[] = [];

  const { data: goals, error } = await adminSupabase
    .from("goals")
    .select("id, weightage")
    .eq("employee_id", employeeId)
    .eq("cycle_id", cycleId)
    .not("status", "eq", "returned");

  if (error) {
    return { valid: false, errors: ["Failed to fetch goals: " + error.message] };
  }

  const goalsList = goals ?? [];

  if (goalsList.length === 0) {
    errors.push("You have no goals to submit.");
  }

  const total = goalsList.reduce((sum, g) => sum + (g.weightage ?? 0), 0);

  if (total !== GOAL_RULES.TOTAL_WEIGHTAGE) {
    errors.push(
      `Total weightage is ${total}%. It must equal exactly ${GOAL_RULES.TOTAL_WEIGHTAGE}% before submission.`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a goal is currently editable (not locked or approved without admin)
 */
export async function isGoalEditable(
  goalId: string,
  actorRole: "employee" | "manager" | "admin"
): Promise<{ editable: boolean; reason?: string }> {
  const { data: goal, error } = await adminSupabase
    .from("goals")
    .select("status, locked_at")
    .eq("id", goalId)
    .single();

  if (error || !goal) {
    return { editable: false, reason: "Goal not found." };
  }

  if (goal.status === "locked" || goal.locked_at) {
    if (actorRole !== "admin") {
      return {
        editable: false,
        reason: "This goal is locked. Contact an Admin to unlock it.",
      };
    }
  }

  if (goal.status === "approved" && actorRole === "employee") {
    return {
      editable: false,
      reason: "Approved goals cannot be edited by employees. Contact your manager or Admin.",
    };
  }

  return { editable: true };
}

/** Validate check-in window is currently open for the given period */
export function isCheckinWindowOpen(period: string, cycleOpenDates: Record<string, string>): boolean {
  const openDate = cycleOpenDates[period];
  if (!openDate) return false;
  const now = new Date();
  const opens = new Date(openDate);
  return now >= opens;
}
