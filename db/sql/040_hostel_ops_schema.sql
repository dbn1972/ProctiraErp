-- Hostel ops (Wave 9 / G-921): mess plans, gate passes, fee structures, roll call.
-- Raw SQL — applied after 008 via tools/scripts/apply-sql.sh.
--
-- New tables carry tenant_id + FORCE RLS (same contract as 030).

CREATE TABLE IF NOT EXISTS mess_plans (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meal_count INT NOT NULL DEFAULT 3 CHECK (meal_count >= 1 AND meal_count <= 6),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mess_plans_tenant_hostel_idx
  ON mess_plans (tenant_id, hostel_id, status);

CREATE TABLE IF NOT EXISTS mess_menu_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES mess_plans(id) ON DELETE CASCADE,
  weekday INT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  meal TEXT NOT NULL
    CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  item_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mess_menu_items_tenant_plan_idx
  ON mess_menu_items (tenant_id, plan_id, weekday, meal);

CREATE TABLE IF NOT EXISTS mess_subscriptions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES mess_plans(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS mess_subscriptions_tenant_student_idx
  ON mess_subscriptions (tenant_id, student_id, status);

CREATE TABLE IF NOT EXISTS gate_passes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id),
  student_id UUID NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'resident'
    CHECK (requested_by IN ('resident', 'parent')),
  requester_user_id UUID,
  reason TEXT,
  expected_out_at TIMESTAMPTZ NOT NULL,
  expected_in_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'out', 'in')),
  decided_by UUID,
  out_at TIMESTAMPTZ,
  in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expected_in_at >= expected_out_at)
);
CREATE INDEX IF NOT EXISTS gate_passes_tenant_status_idx
  ON gate_passes (tenant_id, status, expected_in_at);

CREATE TABLE IF NOT EXISTS hostel_fee_structures (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  term_label TEXT NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, hostel_id, room_type, term_label)
);
CREATE INDEX IF NOT EXISTS hostel_fee_structures_tenant_hostel_idx
  ON hostel_fee_structures (tenant_id, hostel_id);

CREATE TABLE IF NOT EXISTS hostel_attendance (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  block_id UUID NOT NULL REFERENCES hostel_blocks(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  on_date DATE NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('present', 'absent', 'leave')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, block_id, student_id, on_date)
);
CREATE INDEX IF NOT EXISTS hostel_attendance_tenant_block_date_idx
  ON hostel_attendance (tenant_id, block_id, on_date);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE mess_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mess_plans;
CREATE POLICY tenant_isolation ON mess_plans
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE mess_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE mess_menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mess_menu_items;
CREATE POLICY tenant_isolation ON mess_menu_items
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE mess_menu_items FORCE ROW LEVEL SECURITY;

ALTER TABLE mess_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mess_subscriptions;
CREATE POLICY tenant_isolation ON mess_subscriptions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE mess_subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE gate_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gate_passes;
CREATE POLICY tenant_isolation ON gate_passes
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE gate_passes FORCE ROW LEVEL SECURITY;

ALTER TABLE hostel_fee_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_fee_structures;
CREATE POLICY tenant_isolation ON hostel_fee_structures
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE hostel_fee_structures FORCE ROW LEVEL SECURITY;

ALTER TABLE hostel_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_attendance;
CREATE POLICY tenant_isolation ON hostel_attendance
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE hostel_attendance FORCE ROW LEVEL SECURITY;
