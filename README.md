# GoalPulse Pro — AtomQuest Hackathon 1.0

> **In-House Goal Setting & Tracking Portal**

## Quick Start
```bash
npm install && npm run dev
```

## Architecture
```
Next.js 16 (App Router) + TypeScript
├── Supabase (PostgreSQL + Auth + RLS + Realtime)
├── OpenRouter / GPT-3.5 (AI SMART scoring)
└── Vercel (deployment)
```

## API Routes (all new)

### Goals
- GET/POST /api/goals  — list (role-filtered) & create
- POST /api/goals?submit=true  — submit sheet for approval
- GET/PATCH/DELETE /api/goals/[id]
- POST /api/goals/[id]/approve  — manager approve or return
- GET/POST /api/goals/[id]/achievement  — quarterly check-in
- POST /api/goals/[id]/unlock  — admin unlock

### Check-ins & Shared Goals
- GET/POST /api/checkins  — list + manager comment
- GET/POST /api/shared-goals  — push dept KPI to employees

### Reporting (BRD §4)
- GET /api/reports/achievement?format=csv  — exportable
- GET /api/reports/completion  — real-time dashboard
- GET /api/audit  — full audit trail

### Analytics (Bonus §5.4)
- GET /api/analytics?view=overview|qoq|distribution|manager_effectiveness

### Config
- GET/POST /api/cycles  — cycle management
- GET/PATCH /api/users  — org hierarchy
- POST /api/escalation?run=true  — escalation engine
- POST /api/score  — AI SMART evaluation

## BRD Compliance

### Phase 1 (Goal Creation & Approval)
- [x] Thrust Area + UoM (numeric_min/max/timeline/zero)
- [x] Weightage validation: total=100%, min=10%, max 8 goals
- [x] Manager L1 approval with inline editing
- [x] Goal locked on approval; Admin-only unlock
- [x] Shared goals: recipients can only change weightage

### Phase 2 (Achievement & Check-ins)
- [x] Quarterly check-in per BRD §2.3 schedule
- [x] All 4 UoM progress score formulas
- [x] Manager structured check-in comments
- [x] Check-in window enforcement

### BRD §4 Governance
- [x] CSV/JSON achievement report
- [x] Real-time completion dashboard
- [x] Full audit trail (who/what/when)

### Bonus Features
- [x] AI SMART scoring (persisted to DB)
- [x] Rule-based escalation engine
- [x] QoQ analytics + manager effectiveness

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENROUTER_API_KEY=...
```

## DB Setup
Run `supabase_schema.sql` in Supabase SQL Editor.
