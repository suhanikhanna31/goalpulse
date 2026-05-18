"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import {
  Brain,
  Activity,
  ShieldCheck,
  BarChart3,
  Sparkles,
  CheckCircle2,
  Target,
  TrendingUp,
  Users,
  Zap,
  Plus,
  ChevronRight,
  Award,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";

type Goal = {
  id: string;
  title: string;
  description: string;
  progress: number;
  status: string;
  created_at: string;
  ai_score?: number;
  ai_grade?: string;
};

type Log = {
  id: string;
  action: string;
  details: string;
  created_at: string;
};

type AiResult = {
  score: number;
  grade: string;
  smart: {
    specific: number;
    measurable: number;
    achievable: number;
    relevant: number;
    timeBound: number;
  };
  strengths: string[];
  improvements: string[];
  rewrite: string;
};

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-cyan-400",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const SCORE_BG: Record<string, string> = {
  A: "bg-emerald-500/20 border-emerald-500/40",
  B: "bg-cyan-500/20 border-cyan-500/40",
  C: "bg-yellow-500/20 border-yellow-500/40",
  D: "bg-orange-500/20 border-orange-500/40",
  F: "bg-red-500/20 border-red-500/40",
};

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;

  const colorClass = GRADE_COLORS[grade] ?? "text-slate-400";
  const strokeColor =
    grade === "A" ? "#10b981" :
    grade === "B" ? "#06b6d4" :
    grade === "C" ? "#eab308" :
    grade === "D" ? "#f97316" : "#ef4444";

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="10"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={`text-4xl font-black ${colorClass}`}>{score}</span>
        <span className={`text-sm font-bold ${colorClass}`}>Grade {grade}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  const [activeTab, setActiveTab] = useState<"goals" | "analytics" | "ai" | "logs">("goals");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [progressEditing, setProgressEditing] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setGoals(data);
  }, []);

  const fetchLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) setLogs(data);
  }, []);

  async function createGoal() {
    if (!title.trim() || !description.trim()) {
      setError("Please fill in both title and description.");
      return;
    }
    setCreating(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from("goals")
      .insert([{ title: title.trim(), description: description.trim(), progress: 0, status: "draft" }])
      .select();
    if (insertError) {
      setError("Failed to create goal: " + insertError.message);
    } else if (data?.length) {
      await supabase.from("audit_logs").insert([{
        action: "GOAL_CREATED",
        details: `Created goal: ${title.trim()}`,
      }]);
      setTitle("");
      setDescription("");
      fetchGoals();
      fetchLogs();
    }
    setCreating(false);
  }

  async function approveGoal(id: string, goalTitle: string) {
    await supabase.from("goals").update({ status: "approved" }).eq("id", id);
    await supabase.from("audit_logs").insert([{
      action: "GOAL_APPROVED",
      details: `Approved goal: ${goalTitle}`,
    }]);
    fetchGoals();
    fetchLogs();
  }

  async function updateProgress(id: string, progress: number) {
    await supabase.from("goals").update({ progress }).eq("id", id);
    await supabase.from("audit_logs").insert([{
      action: "PROGRESS_UPDATED",
      details: `Progress updated to ${progress}%`,
    }]);
    setProgressEditing(null);
    fetchGoals();
    fetchLogs();
  }

  async function scoreGoalWithAI(goal: Goal) {
    try {
      setAiLoading(goal.id);
      setError(null);

      const response = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.title, description: goal.description }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? "API error");
      }

      const data = await response.json();
      const result: AiResult = data.result;

      setAiResults((prev) => ({ ...prev, [goal.id]: result }));

      // persist score back to the row
      await supabase.from("goals").update({
        ai_score: result.score,
        ai_grade: result.grade,
      }).eq("id", goal.id);

      await supabase.from("audit_logs").insert([{
        action: "AI_ANALYSIS",
        details: `AI scored "${goal.title}" — ${result.score}/100 (${result.grade})`,
      }]);

      fetchGoals();
      fetchLogs();
      setActiveTab("ai");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI scoring failed";
      setError(msg);
    } finally {
      setAiLoading(null);
    }
  }

  useEffect(() => {
    fetchGoals();
    fetchLogs();

    const channel = supabase
      .channel("goals-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, () => fetchGoals())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchGoals, fetchLogs]);

  const approvedGoals = goals.filter((g) => g.status === "approved");
  const avgScore =
    goals.filter((g) => g.ai_score).length > 0
      ? Math.round(goals.filter((g) => g.ai_score).reduce((a, b) => a + (b.ai_score ?? 0), 0) / goals.filter((g) => g.ai_score).length)
      : null;

  const statusData = [
    { name: "Draft", value: goals.filter((g) => g.status === "draft").length },
    { name: "Approved", value: goals.filter((g) => g.status === "approved").length },
    { name: "Pending", value: goals.filter((g) => g.status === "pending").length },
  ];

  const progressData = goals
    .filter((g) => g.progress > 0)
    .map((g) => ({ name: g.title.slice(0, 15) + "…", progress: g.progress }));

  const latestAiGoal = goals.find((g) => aiResults[g.id]);
  const latestAiResult = latestAiGoal ? aiResults[latestAiGoal.id] : null;
  const radarData = latestAiResult
    ? [
        { subject: "Specific", value: latestAiResult.smart.specific * 10 },
        { subject: "Measurable", value: latestAiResult.smart.measurable * 10 },
        { subject: "Achievable", value: latestAiResult.smart.achievable * 10 },
        { subject: "Relevant", value: latestAiResult.smart.relevant * 10 },
        { subject: "Time-Bound", value: latestAiResult.smart.timeBound * 10 },
      ]
    : [];

  const TABS = [
    { id: "goals", label: "Goals", icon: Target },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "ai", label: "AI Insights", icon: Brain },
    { id: "logs", label: "Audit Log", icon: ShieldCheck },
  ] as const;

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      {/* ── TOP NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#050810]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500">
              <Zap className="h-4 w-4 text-black" />
            </div>
            <span className="text-xl font-black tracking-tight">GoalPulse</span>
            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400 border border-cyan-500/20">PRO</span>
          </div>

          <div className="flex items-center gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-white text-black"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-10 space-y-10">
        {/* ── ERROR BANNER ── */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-red-300">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* ── KPI STRIP ── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Total Goals", value: goals.length, icon: Target, color: "cyan" },
            { label: "Approved", value: approvedGoals.length, icon: CheckCircle2, color: "emerald" },
            { label: "Avg AI Score", value: avgScore !== null ? `${avgScore}` : "—", icon: Brain, color: "purple" },
            { label: "Avg Progress", value: goals.length ? `${Math.round(goals.reduce((a, b) => a + b.progress, 0) / goals.length)}%` : "0%", icon: TrendingUp, color: "orange" },
          ].map((kpi) => (
            <div key={kpi.label} className={`rounded-3xl border border-white/8 bg-white/4 p-6 backdrop-blur-xl`}>
              <kpi.icon className={`h-5 w-5 text-${kpi.color}-400 mb-3`} />
              <p className="text-slate-400 text-sm">{kpi.label}</p>
              <p className="text-4xl font-black mt-1">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* ─────────────── GOALS TAB ─────────────── */}
        {activeTab === "goals" && (
          <div className="space-y-8">
            {/* Create form */}
            <div className="rounded-3xl border border-white/8 bg-white/4 p-8 backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-6">
                <Plus className="h-5 w-5 text-cyan-400" />
                <h2 className="text-2xl font-black">Create New Goal</h2>
              </div>
              <div className="space-y-4">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Goal title (e.g. Increase Q3 revenue by 20%)"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 transition"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe how you'll measure success and the timeline…"
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 transition resize-none"
                />
                <button
                  onClick={createGoal}
                  disabled={creating}
                  className="flex items-center gap-2 rounded-2xl bg-white px-8 py-3.5 font-bold text-black hover:bg-cyan-300 transition disabled:opacity-50"
                >
                  {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {creating ? "Creating…" : "Create Goal"}
                </button>
              </div>
            </div>

            {/* Goals list */}
            <div className="space-y-4">
              <h2 className="text-2xl font-black flex items-center gap-2">
                <Activity className="h-5 w-5 text-cyan-400" />
                All Goals
                <span className="text-slate-600 text-lg font-normal">({goals.length})</span>
              </h2>

              {goals.length === 0 && (
                <div className="rounded-3xl border border-dashed border-white/10 p-12 text-center text-slate-500">
                  No goals yet. Create your first goal above.
                </div>
              )}

              {goals.map((goal) => {
                const aiResult = aiResults[goal.id];
                const isScoring = aiLoading === goal.id;
                const storedGrade = goal.ai_grade ?? (aiResult?.grade);
                const storedScore = goal.ai_score ?? (aiResult?.score);

                return (
                  <div
                    key={goal.id}
                    className="rounded-3xl border border-white/8 bg-white/4 p-6 backdrop-blur-xl transition hover:border-white/15"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-xl font-bold truncate">{goal.title}</h3>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium border ${
                            goal.status === "approved"
                              ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                              : "bg-slate-500/20 border-slate-500/30 text-slate-400"
                          }`}>
                            {goal.status}
                          </span>
                          {storedGrade && (
                            <span className={`rounded-full px-3 py-1 text-xs font-bold border ${SCORE_BG[storedGrade] ?? ""}`}>
                              Grade {storedGrade} · {storedScore}/100
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-slate-400 text-sm leading-relaxed line-clamp-2">{goal.description}</p>

                        {/* Progress bar */}
                        <div className="mt-4 space-y-1">
                          <div className="flex justify-between text-xs text-slate-500">
                            <span>Progress</span>
                            <span>{goal.progress}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-white/8">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
                              style={{ width: `${goal.progress}%` }}
                            />
                          </div>
                        </div>

                        {progressEditing === goal.id && (
                          <div className="mt-3 flex items-center gap-3">
                            <input
                              type="range" min={0} max={100}
                              defaultValue={goal.progress}
                              onChange={(e) => {
                                // live preview
                              }}
                              onMouseUp={(e) => updateProgress(goal.id, Number((e.target as HTMLInputElement).value))}
                              className="flex-1 accent-cyan-500"
                            />
                            <button onClick={() => setProgressEditing(null)} className="text-xs text-slate-500 hover:text-white">Cancel</button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      {goal.status !== "approved" && (
                        <button
                          onClick={() => approveGoal(goal.id, goal.title)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 transition"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Approve
                        </button>
                      )}
                      <button
                        onClick={() => scoreGoalWithAI(goal)}
                        disabled={isScoring}
                        className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 transition disabled:opacity-60"
                      >
                        {isScoring ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {isScoring ? "Scoring…" : "AI Score"}
                      </button>
                      <button
                        onClick={() => setProgressEditing(progressEditing === goal.id ? null : goal.id)}
                        className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5 transition"
                      >
                        <TrendingUp className="h-4 w-4" /> Update Progress
                      </button>
                    </div>

                    {/* Inline AI result */}
                    {aiResult && (
                      <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5 space-y-3">
                        <p className="text-xs font-bold text-cyan-400 uppercase tracking-widest">AI Suggested Rewrite</p>
                        <p className="text-slate-300 italic">"{aiResult.rewrite}"</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-emerald-400 font-semibold mb-1">Strengths</p>
                            {aiResult.strengths.map((s, i) => (
                              <p key={i} className="text-xs text-slate-400">✓ {s}</p>
                            ))}
                          </div>
                          <div>
                            <p className="text-xs text-orange-400 font-semibold mb-1">Improvements</p>
                            {aiResult.improvements.map((s, i) => (
                              <p key={i} className="text-xs text-slate-400">→ {s}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────── ANALYTICS TAB ─────────────── */}
        {activeTab === "analytics" && (
          <div className="space-y-8">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              Analytics
            </h2>

            <div className="grid gap-8 md:grid-cols-2">
              {/* Status distribution */}
              <div className="rounded-3xl border border-white/8 bg-white/4 p-7">
                <h3 className="font-bold text-slate-300 mb-5">Goal Status Distribution</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusData}>
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#0f1729", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                      <Bar dataKey="value" fill="#06b6d4" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Progress */}
              <div className="rounded-3xl border border-white/8 bg-white/4 p-7">
                <h3 className="font-bold text-slate-300 mb-5">Goal Progress (%)</h3>
                <div className="h-64">
                  {progressData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-600 text-sm">
                      No progress data yet
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={progressData}>
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: "#0f1729", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                        <Bar dataKey="progress" fill="#10b981" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* SMART Radar */}
              {radarData.length > 0 && (
                <div className="rounded-3xl border border-white/8 bg-white/4 p-7 md:col-span-2">
                  <h3 className="font-bold text-slate-300 mb-5">SMART Framework Analysis — {latestAiGoal?.title}</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="rgba(255,255,255,0.1)" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                        <Radar name="Score" dataKey="value" fill="#06b6d4" fillOpacity={0.25} stroke="#06b6d4" strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─────────────── AI INSIGHTS TAB ─────────────── */}
        {activeTab === "ai" && (
          <div className="space-y-8">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <Brain className="h-5 w-5 text-cyan-400" />
              AI Insights
            </h2>

            {Object.keys(aiResults).length === 0 ? (
              <div className="rounded-3xl border border-dashed border-cyan-500/20 bg-cyan-500/5 p-12 text-center text-slate-500">
                <Brain className="h-10 w-10 text-slate-700 mx-auto mb-4" />
                <p>No AI analyses yet. Go to Goals and click "AI Score" on any goal.</p>
              </div>
            ) : (
              goals
                .filter((g) => aiResults[g.id])
                .map((goal) => {
                  const r = aiResults[goal.id];
                  return (
                    <div
                      key={goal.id}
                      className={`rounded-3xl border p-8 ${SCORE_BG[r.grade] ?? "bg-white/4 border-white/8"}`}
                    >
                      <div className="flex items-start gap-6 flex-wrap">
                        <ScoreRing score={r.score} grade={r.grade} />

                        <div className="flex-1 min-w-0 space-y-4">
                          <div>
                            <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Goal</p>
                            <h3 className="text-2xl font-black">{goal.title}</h3>
                          </div>

                          <div className="rounded-xl bg-black/30 px-4 py-3">
                            <p className="text-xs text-cyan-400 font-semibold mb-1">Suggested Rewrite</p>
                            <p className="text-slate-300 italic">"{r.rewrite}"</p>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Strengths</p>
                              {r.strengths.map((s, i) => (
                                <div key={i} className="flex items-start gap-2">
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-slate-300">{s}</p>
                                </div>
                              ))}
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-orange-400 uppercase tracking-widest">Improvements</p>
                              {r.improvements.map((s, i) => (
                                <div key={i} className="flex items-start gap-2">
                                  <ChevronRight className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-slate-300">{s}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SMART breakdown */}
                      <div className="mt-6 grid grid-cols-5 gap-3">
                        {Object.entries(r.smart).map(([key, val]) => (
                          <div key={key} className="rounded-xl bg-black/30 p-3 text-center">
                            <p className="text-lg font-black text-cyan-400">{(val as number) * 10}</p>
                            <p className="text-xs text-slate-500 mt-1 capitalize">{key.replace("timeBound", "Time-Bound")}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {/* ─────────────── LOGS TAB ─────────────── */}
        {activeTab === "logs" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-cyan-400" />
              Audit Log
            </h2>

            {logs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 p-12 text-center text-slate-600">
                No activity yet.
              </div>
            ) : (
              <div className="rounded-3xl border border-white/8 overflow-hidden">
                {logs.map((log, i) => (
                  <div
                    key={log.id}
                    className={`flex items-center gap-4 px-6 py-4 ${i % 2 === 0 ? "bg-white/2" : ""} border-b border-white/5 last:border-0`}
                  >
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                      log.action.includes("AI") ? "bg-cyan-400" :
                      log.action.includes("APPROVED") ? "bg-emerald-400" :
                      log.action.includes("PROGRESS") ? "bg-orange-400" : "bg-slate-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-slate-300">{log.action}</span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span className="text-sm text-slate-500">{log.details}</span>
                    </div>
                    <span className="text-xs text-slate-600 flex-shrink-0">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── FEATURE CARDS ── */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3 pt-4">
          {[
            { icon: Activity, label: "Realtime Sync", desc: "Live dashboard updates via Supabase Realtime channels." },
            { icon: Sparkles, label: "AI Evaluation", desc: "SMART framework scoring with structured JSON from LLMs." },
            { icon: Award, label: "Enterprise Workflow", desc: "Approval pipeline, audit trail, and progress tracking." },
          ].map((f) => (
            <div key={f.label} className="rounded-3xl border border-white/8 bg-white/3 p-7 hover:border-cyan-500/30 transition">
              <f.icon className="h-6 w-6 text-cyan-400" />
              <h3 className="mt-4 text-lg font-bold">{f.label}</h3>
              <p className="mt-2 text-sm text-slate-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
