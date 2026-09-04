-- Phase schema ownership: health (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS health;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS health.health_measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  date VARCHAR(32) NOT NULL,
  height DOUBLE PRECISION,
  weight DOUBLE PRECISION,
  bmi DOUBLE PRECISION,
  blood_pressure_systolic INT,
  blood_pressure_diastolic INT,
  heart_rate INT,
  vision_left VARCHAR(20),
  vision_right VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_measurements_tenant_id_student_id_idx ON health.health_measurements (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.allergies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  allergy_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(30) NOT NULL,
  reaction TEXT,
  treatment TEXT,
  diagnosed_date VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS allergies_tenant_id_student_id_idx ON health.allergies (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.health_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  condition_name VARCHAR(255) NOT NULL,
  condition_type VARCHAR(100) NOT NULL,
  diagnosed_date VARCHAR(32),
  status VARCHAR(30) NOT NULL,
  treatment TEXT,
  medication TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_conditions_tenant_id_student_id_idx ON health.health_conditions (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.vaccinations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  vaccine_name VARCHAR(255) NOT NULL,
  dose_number INT NOT NULL,
  date_administered VARCHAR(32) NOT NULL,
  administered_by VARCHAR(255),
  batch_number VARCHAR(100),
  next_due_date VARCHAR(32),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vaccinations_tenant_id_student_id_idx ON health.vaccinations (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.insurance_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  provider VARCHAR(255) NOT NULL,
  policy_number VARCHAR(100) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  start_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS insurance_policies_tenant_id_student_id_idx ON health.insurance_policies (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.special_needs_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  assessment_date VARCHAR(32) NOT NULL,
  assessor_name VARCHAR(255) NOT NULL,
  assessor_role VARCHAR(100) NOT NULL,
  assessment_type VARCHAR(100) NOT NULL,
  findings TEXT NOT NULL,
  recommendations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS special_needs_assessments_tenant_id_student_id_idx ON health.special_needs_assessments (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.diagnoses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  assessment_id UUID,
  diagnosis_date VARCHAR(32) NOT NULL,
  diagnosed_by VARCHAR(255) NOT NULL,
  condition VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  severity VARCHAR(30) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diagnoses_tenant_id_student_id_idx ON health.diagnoses (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  diagnosis_id UUID,
  referral_date VARCHAR(32) NOT NULL,
  referred_by VARCHAR(255) NOT NULL,
  referred_to VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL,
  appointment_date VARCHAR(32),
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS referrals_tenant_id_student_id_idx ON health.referrals (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.accommodation_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  diagnosis_id UUID,
  plan_name VARCHAR(255) NOT NULL,
  start_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32),
  accommodations JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_date VARCHAR(32),
  status VARCHAR(30) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS accommodation_plans_tenant_id_student_id_idx ON health.accommodation_plans (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.counselling_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  counsellor_id UUID NOT NULL,
  session_date VARCHAR(32) NOT NULL,
  session_type VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  case_notes TEXT NOT NULL,
  outcome TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date VARCHAR(32),
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS counselling_sessions_tenant_id_student_id_idx ON health.counselling_sessions (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health.screening_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  grade_level VARCHAR(50) NOT NULL,
  academic_period_id UUID NOT NULL,
  assessment_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_date VARCHAR(32),
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS screening_programs_tenant_id_academic_period_id_idx ON health.screening_programs (tenant_id, academic_period_id);

