// ─────────────────────────────────────────────────────────────────────────────
// POST /api/score
//
// AI-powered SMART goal evaluation using OpenRouter.
// Enhanced to score against BRD requirements (thrust areas, UoM, weightage).
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { adminSupabase, getRequestUser } from "../../../lib/supabase-server";
import { writeAuditLog } from "../../../lib/audit";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://goalpulse.pro",
    "X-Title": "GoalPulse Pro",
  },
});

export async function POST(req: Request) {
  try {
    const user = await getRequestUser(req as Parameters<typeof getRequestUser>[0]);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();

    if (!body.goal) {
      return Response.json({ error: "Goal text required" }, { status: 400 });
    }

    const completion = await client.chat.completions.create({
      model: "openai/gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are an expert OKR and goal-setting consultant embedded in an enterprise Goal Setting & Tracking Portal.
Evaluate employee goals using the SMART framework AND assess them against enterprise goal-setting best practices:
- Alignment to business thrust areas
- Clarity of Unit of Measurement (UoM): Numeric, %, Timeline, or Zero-based
- Appropriateness of target values
- Actionability and feasibility within a quarter
Always respond in valid JSON only — no markdown, no extra text.`,
        },
        {
          role: "user",
          content: `Evaluate this employee goal and respond with JSON only:

Goal Title: ${body.goal}
Description: ${body.description ?? "Not provided"}
Unit of Measurement (UoM): ${body.uom ?? "Not specified"}
Target Value: ${body.target ?? "Not specified"}
Thrust Area: ${body.thrust_area ?? "Not specified"}
Weightage: ${body.weightage ?? "Not specified"}%

Return this exact JSON shape:
{
  "score": <number 1-100>,
  "grade": <"A"|"B"|"C"|"D"|"F">,
  "smart": {
    "specific": <number 1-10>,
    "measurable": <number 1-10>,
    "achievable": <number 1-10>,
    "relevant": <number 1-10>,
    "timeBound": <number 1-10>
  },
  "uom_assessment": "<brief assessment of whether the chosen UoM fits this goal>",
  "target_assessment": "<brief assessment of whether the target is realistic and measurable>",
  "strengths": [<string>, <string>],
  "improvements": [<string>, <string>],
  "rewrite": "<one sentence improved version of the goal that is clearer and more SMART>"
}`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { score: 50, grade: "C", raw };
    }

    // Persist AI score back to the goal record if goal_id was provided
    if (body.goal_id) {
      await adminSupabase
        .from("goals")
        .update({
          ai_score: parsed.score as number,
          ai_grade: parsed.grade as string,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.goal_id);

      await writeAuditLog({
        action: "AI_SCORE_GENERATED",
        entityType: "goal",
        entityId: body.goal_id,
        actorId: user.id,
        newValue: { ai_score: parsed.score, ai_grade: parsed.grade },
        details: `AI scored goal "${body.goal}": ${parsed.score}/100 (Grade ${parsed.grade})`,
      });
    }

    return Response.json({ result: parsed });
  } catch (err: unknown) {
    console.error("AI score error:", err);
    const message = err instanceof Error ? err.message : "AI service error";
    return Response.json({ error: message }, { status: 500 });
  }
}
