-- Health screenings + student profile PHI (raw SQL — no Prisma).
-- Complements 002_health_counselling_schema.sql for peer-gap slice #5.

CREATE TABLE IF NOT EXISTS health_measurements (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  measured_on DATE NOT NULL,
  height DOUBLE PRECISION,
  weight DOUBLE PRECISION,
  bmi DOUBLE PRECISION,
  blood_pressure_systolic INTEGER,
  blood_pressure_diastolic INTEGER,
  heart_rate INTEGER,
  vision_left TEXT,
  vision_right TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_measurements_tenant_student
  ON health_measurements (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_allergies (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  allergy_type TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  reaction TEXT,
  treatment TEXT,
  diagnosed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_allergies_tenant_student
  ON health_allergies (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_conditions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  diagnosed_date DATE,
  status TEXT NOT NULL,
  treatment TEXT,
  medication TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_conditions_tenant_student
  ON health_conditions (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_vaccinations (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  vaccine_name TEXT NOT NULL,
  dose_number INTEGER NOT NULL,
  date_administered DATE NOT NULL,
  administered_by TEXT,
  batch_number TEXT,
  next_due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_vaccinations_tenant_student
  ON health_vaccinations (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_insurance (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  coverage_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_insurance_tenant_student
  ON health_insurance (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_screening_programs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  grade_level TEXT NOT NULL,
  academic_period_id TEXT NOT NULL,
  assessment_types TEXT[] NOT NULL DEFAULT '{}',
  scheduled_date DATE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_screening_programs_tenant
  ON health_screening_programs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_health_screening_programs_grade
  ON health_screening_programs (tenant_id, grade_level);
