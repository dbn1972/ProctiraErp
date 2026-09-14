-- W1-SEC-03 (D8): minimal guardian household + student custody graph.
-- Groups guardians into households and assigns student custody per household.
-- parent_child_links.household_id scopes a link to one household when custody rows exist.

CREATE TABLE IF NOT EXISTS guardian_households (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_households_tenant
  ON guardian_households (tenant_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS guardian_household_members (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  household_id UUID NOT NULL REFERENCES guardian_households(id) ON DELETE CASCADE,
  parent_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guardian'
    CHECK (role IN ('primary', 'guardian', 'other')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, household_id, parent_user_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_household_members_parent
  ON guardian_household_members (tenant_id, parent_user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS guardian_student_custody (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  household_id UUID NOT NULL REFERENCES guardian_households(id) ON DELETE CASCADE,
  custody_type TEXT NOT NULL DEFAULT 'sole'
    CHECK (custody_type IN ('sole', 'joint', 'visitation', 'none')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_student_custody_student
  ON guardian_student_custody (tenant_id, student_id)
  WHERE status = 'active';

ALTER TABLE parent_child_links
  ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES guardian_households(id);

CREATE INDEX IF NOT EXISTS idx_parent_child_links_household
  ON parent_child_links (tenant_id, household_id)
  WHERE status = 'active';

COMMENT ON TABLE guardian_households IS
  'Guardian household unit within a tenant (split-custody / multi-guardian grouping).';
COMMENT ON TABLE guardian_household_members IS
  'Active membership of a guardian user in a household.';
COMMENT ON TABLE guardian_student_custody IS
  'Which household holds custody for a student; drives cross-household authZ.';
COMMENT ON COLUMN parent_child_links.household_id IS
  'Optional household scope for the link; must align with active custody when set.';
