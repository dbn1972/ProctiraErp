-- ProctiraERP core onboarding schema (raw SQL — no Prisma)
-- Tables required for multi-board / multi-school / student enrollment certification.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE board_type AS ENUM ('NATIONAL', 'STATE', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enrollment_status AS ENUM ('ENROLLED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  config     JSONB DEFAULT '{}'::jsonb,
  status     VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS geographic_areas (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  level      SMALLINT NOT NULL,
  parent_id  UUID REFERENCES geographic_areas(id),
  path       TEXT NOT NULL,
  lft        INT NOT NULL,
  rgt        INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS geographic_areas_tenant_level_idx ON geographic_areas (tenant_id, level);

CREATE TABLE IF NOT EXISTS boards (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  type       board_type NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS boards_tenant_type_idx ON boards (tenant_id, type);

CREATE TABLE IF NOT EXISTS institutions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50) NOT NULL,
  board_id    UUID REFERENCES boards(id),
  area_id     UUID NOT NULL REFERENCES geographic_areas(id),
  type        VARCHAR(50) NOT NULL,
  sector      VARCHAR(50) NOT NULL,
  ownership   VARCHAR(50) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  custom_data JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS institutions_tenant_board_idx ON institutions (tenant_id, board_id);
CREATE INDEX IF NOT EXISTS institutions_tenant_status_idx ON institutions (tenant_id, status);

CREATE TABLE IF NOT EXISTS academic_periods (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       VARCHAR(100) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS grades (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       VARCHAR(100) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  "order"    SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS students (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  first_name   VARCHAR(100) NOT NULL,
  last_name    VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender       VARCHAR(20) NOT NULL,
  national_id  VARCHAR(50),
  custom_data  JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, national_id)
);
CREATE INDEX IF NOT EXISTS students_tenant_name_idx ON students (tenant_id, last_name, first_name);

CREATE TABLE IF NOT EXISTS staff (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  date_of_birth   DATE NOT NULL,
  identity_number VARCHAR(50) NOT NULL,
  custom_data     JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, identity_number)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  student_id         UUID NOT NULL REFERENCES students(id),
  institution_id     UUID NOT NULL REFERENCES institutions(id),
  grade_id           UUID NOT NULL REFERENCES grades(id),
  class_id           UUID,
  academic_period_id UUID NOT NULL REFERENCES academic_periods(id),
  status             enrollment_status NOT NULL DEFAULT 'ENROLLED',
  enrolled_at        DATE NOT NULL DEFAULT CURRENT_DATE,
  exited_at          DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS enrollments_tenant_institution_period_idx
  ON enrollments (tenant_id, institution_id, academic_period_id);
CREATE INDEX IF NOT EXISTS enrollments_tenant_student_idx
  ON enrollments (tenant_id, student_id);

GRANT ALL ON ALL TABLES IN SCHEMA public TO proctira;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO proctira;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO proctira;
