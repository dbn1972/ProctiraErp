-- Hostel module (raw SQL — no Prisma).
-- Occupancy: hostels → blocks → rooms → beds → assignments.

CREATE TABLE IF NOT EXISTS hostels (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  capacity INT NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hostels_tenant_status
  ON hostels (tenant_id, status);

CREATE TABLE IF NOT EXISTS hostel_blocks (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  floor INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hostel_blocks_tenant_hostel
  ON hostel_blocks (tenant_id, hostel_id);

CREATE TABLE IF NOT EXISTS hostel_rooms (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  block_id UUID NOT NULL REFERENCES hostel_blocks(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (block_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_hostel_rooms_tenant_block
  ON hostel_rooms (tenant_id, block_id);

CREATE TABLE IF NOT EXISTS hostel_beds (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  room_id UUID NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
  bed_label TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_label)
);

CREATE INDEX IF NOT EXISTS idx_hostel_beds_tenant_room
  ON hostel_beds (tenant_id, room_id);

CREATE TABLE IF NOT EXISTS hostel_assignments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  bed_id UUID NOT NULL REFERENCES hostel_beds(id),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hostel_assignments_tenant_student
  ON hostel_assignments (tenant_id, student_id, is_active);

CREATE TABLE IF NOT EXISTS hostel_leaves (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hostel_leaves_tenant_status
  ON hostel_leaves (tenant_id, status);

CREATE TABLE IF NOT EXISTS hostel_visitors (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL REFERENCES hostels(id),
  visitor_name TEXT NOT NULL,
  student_id UUID NOT NULL,
  visit_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'checked_in', 'checked_out', 'denied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hostel_visitors_tenant_hostel
  ON hostel_visitors (tenant_id, hostel_id, visit_date);
