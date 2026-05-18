-- ─────────────────────────────────────────────────────────────────────────────
-- GoalPulse — Supabase Schema
-- AtomQuest Hackathon 1.0 — In-House Goal Setting & Tracking Portal
--
-- Run this in your Supabase SQL Editor to set up the complete database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. Profiles (extends Supabase auth.users) ───────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'admin')),
  department    TEXT,
  manager_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─── 2. Cycles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cycles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  year                INTEGER NOT NULL,
  goal_setting_opens  TIMESTAMPTZ NOT NULL,  -- 1st May
  q1_opens            TIMESTAMPTZ NOT NULL,  -- July
  q2_opens            TIMESTAMPTZ NOT NULL,  -- October
  q3_opens            TIMESTAMPTZ NOT NULL,  -- January
  q4_opens            TIMESTAMPTZ NOT NULL,  -- March/April
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default 2025 cycle per BRD §2.3 schedule
INSERT INTO cycles (name, year, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens)
VALUES (
  'FY 2025-26',
  2025,
  '2025-05-01T00:00:00Z',  -- Phase 1: Goal Setting
  '2025-07-01T00:00:00Z',  -- Q1 Check-in
  '2025-10-01T00:00:00Z',  -- Q2 Check-in
  '2026-01-01T00:00:00Z',  -- Q3 Check-in
  '2026-03-01T00:00:00Z'   -- Q4 / Annual
) ON CONFLICT DO NOTHING;

-- ─── 3. Goals ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cycle_id            UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  thrust_area         TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  uom                 TEXT NOT NULL CHECK (uom IN ('numeric_min', 'numeric_max', 'timeline', 'zero')),
  target              NUMERIC NOT NULL,
  deadline            DATE,                     -- for timeline UoM goals
  weightage           NUMERIC NOT NULL CHECK (weightage >= 10 AND weightage <= 100),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'approved', 'returned', 'locked')),
  is_shared           BOOLEAN NOT NULL DEFAULT FALSE,
  shared_from_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  primary_owner_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ai_score            INTEGER,
  ai_grade            TEXT,
  approved_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  locked_at           TIMESTAMPTZ,
  locked_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- BRD §2.1: max 8 goals per employee per cycle (enforced in app layer too)
CREATE UNIQUE INDEX IF NOT EXISTS goals_employee_cycle_limit
  ON goals (employee_id, cycle_id)
  WHERE status NOT IN ('returned');
-- Note: Uniqueness limit of 8 is enforced in application validation layer

-- ─── 4. Check-ins ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkins (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id             UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cycle_id            UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  period              TEXT NOT NULL CHECK (period IN ('Q1', 'Q2', 'Q3', 'Q4')),
  actual_achievement  NUMERIC,
  completion_date     DATE,
  progress_status     TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (progress_status IN ('not_started', 'on_track', 'completed')),
  computed_score      NUMERIC,            -- computed % score per BRD §2.2 formula
  manager_comment     TEXT,
  manager_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  checked_in_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One check-in per goal per period
  UNIQUE (goal_id, period)
);

-- ─── 5. Audit Logs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  old_value   JSONB,
  new_value   JSONB,
  details     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient filtering
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);

-- ─── 6. Escalation Rules ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escalation_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  trigger_event   TEXT NOT NULL CHECK (trigger_event IN (
                    'goal_not_submitted',
                    'goal_not_approved',
                    'checkin_not_completed'
                  )),
  threshold_days  INTEGER NOT NULL DEFAULT 7,
  notify_roles    TEXT[] NOT NULL DEFAULT '{manager,admin}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default escalation rules per BRD §5.3
INSERT INTO escalation_rules (name, trigger_event, threshold_days, notify_roles) VALUES
  ('Goal submission overdue', 'goal_not_submitted', 7, '{employee,manager}'),
  ('Goal approval overdue',   'goal_not_approved',  5, '{manager,admin}'),
  ('Check-in overdue',        'checkin_not_completed', 10, '{employee,manager}')
ON CONFLICT DO NOTHING;

-- ─── 7. Escalation Logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escalation_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id         UUID NOT NULL REFERENCES escalation_rules(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  trigger_reason  TEXT NOT NULL,
  escalated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- ─── 8. Row-Level Security ────────────────────────────────────────────────────

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees see own goals" ON goals FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );
CREATE POLICY "Employees create own goals" ON goals FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin')));
CREATE POLICY "Goals are editable per role" ON goals FOR UPDATE TO authenticated
  USING (
    (employee_id = auth.uid() AND status = 'draft')
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

-- checkins
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Checkins accessible per role" ON checkins FOR ALL TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

-- audit_logs (read-only for non-service role)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read all logs" ON audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Users read own logs" ON audit_logs FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- cycles
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cycles are public to authenticated" ON cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins manage cycles" ON cycles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── 9. Realtime subscriptions ────────────────────────────────────────────────
-- Enable realtime for goals and checkins (for live dashboard updates)
ALTER PUBLICATION supabase_realtime ADD TABLE goals;
ALTER PUBLICATION supabase_realtime ADD TABLE checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEMO SEED DATA
-- Run separately after setting up auth users via Supabase Dashboard
-- Replace UUIDs with your actual auth.users UUIDs
-- ─────────────────────────────────────────────────────────────────────────────

-- Example (uncomment and fill in real UUIDs from Supabase Auth):
/*
INSERT INTO profiles (id, full_name, email, role, department)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Alice Admin',    'admin@demo.com',    'admin',    'HR'),
  ('00000000-0000-0000-0000-000000000002', 'Mike Manager',   'manager@demo.com',  'manager',  'Sales'),
  ('00000000-0000-0000-0000-000000000003', 'Eve Employee',   'employee@demo.com', 'employee', 'Sales')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

UPDATE profiles SET manager_id = '00000000-0000-0000-0000-000000000002'
  WHERE id = '00000000-0000-0000-0000-000000000003';
*/
