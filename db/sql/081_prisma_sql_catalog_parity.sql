-- W1-DATA-04 COMPLETE — Prisma ↔ SQL catalog parity residuals.
--
-- Prisma schema.prisma declares indexes / search_vector columns that were
-- missing from numbered SQL (and had no Prisma migration DDL). Additive and
-- idempotent so fresh apply-sql / migrate paths converge on the Prisma map.

-- ---------------------------------------------------------------------------
-- geographic_areas
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS geographic_areas_tenant_parent_idx
  ON geographic_areas (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS geographic_areas_tenant_lft_rgt_idx
  ON geographic_areas (tenant_id, lft, rgt);

-- ---------------------------------------------------------------------------
-- institutions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS institutions_tenant_area_idx
  ON institutions (tenant_id, area_id);
CREATE INDEX IF NOT EXISTS institutions_custom_data_gin_idx
  ON institutions USING GIN (custom_data);

-- ---------------------------------------------------------------------------
-- students — full-text search vector + GIN indexes (Prisma Unsupported tsvector)
-- ---------------------------------------------------------------------------
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS students_custom_data_gin_idx
  ON students USING GIN (custom_data);
CREATE INDEX IF NOT EXISTS students_search_vector_gin_idx
  ON students USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS staff_tenant_name_idx
  ON staff (tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS staff_custom_data_gin_idx
  ON staff USING GIN (custom_data);
CREATE INDEX IF NOT EXISTS staff_search_vector_gin_idx
  ON staff USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- enrollments / academic_periods / grades
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS enrollments_tenant_status_idx
  ON enrollments (tenant_id, status);
CREATE INDEX IF NOT EXISTS academic_periods_tenant_status_idx
  ON academic_periods (tenant_id, status);
CREATE INDEX IF NOT EXISTS grades_tenant_order_idx
  ON grades (tenant_id, "order");
