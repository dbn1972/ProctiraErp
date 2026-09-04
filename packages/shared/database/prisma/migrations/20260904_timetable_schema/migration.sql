-- Phase 19: Timetable
CREATE SCHEMA IF NOT EXISTS timetable;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS timetable.bell_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  period_order DOUBLE PRECISION NOT NULL,
  start_time VARCHAR(255) NOT NULL,
  end_time VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bell_periods_tenant_id_idx ON timetable.bell_periods (tenant_id);

CREATE TABLE IF NOT EXISTS timetable.timetable_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  class_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  bell_period_id UUID NOT NULL,
  room_id UUID,
  day_of_week DOUBLE PRECISION NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS timetable_slots_tenant_id_idx ON timetable.timetable_slots (tenant_id);

CREATE TABLE IF NOT EXISTS timetable.substitutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  slot_id UUID NOT NULL,
  original_staff_id UUID NOT NULL,
  substitute_staff_id UUID NOT NULL,
  date VARCHAR(255) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS substitutions_tenant_id_idx ON timetable.substitutions (tenant_id);

