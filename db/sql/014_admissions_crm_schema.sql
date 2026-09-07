-- Admissions CRM depth (raw SQL — waitlist + interview slots). OCR waived.
-- Applications themselves may still live in registration in-memory for public apply;
-- CRM tables back staff waitlist/interview workflows when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS admission_applications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tracking_number TEXT NOT NULL,
  institution_id UUID NOT NULL,
  institution_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'waitlisted')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  remarks TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tracking_number)
);

CREATE INDEX IF NOT EXISTS idx_admission_applications_tenant_status
  ON admission_applications (tenant_id, status);

CREATE TABLE IF NOT EXISTS admission_waitlist_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, application_id),
  UNIQUE (tenant_id, institution_id, position)
);

CREATE INDEX IF NOT EXISTS idx_admission_waitlist_institution
  ON admission_waitlist_entries (tenant_id, institution_id, position);

CREATE TABLE IF NOT EXISTS admission_interview_slots (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  location TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_admission_interview_slots_inst
  ON admission_interview_slots (tenant_id, institution_id, starts_at);

CREATE TABLE IF NOT EXISTS admission_interview_bookings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  slot_id UUID NOT NULL REFERENCES admission_interview_slots(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, application_id)
);

CREATE INDEX IF NOT EXISTS idx_admission_interview_bookings_app
  ON admission_interview_bookings (tenant_id, application_id);
