-- W3-TIME-01 / B4 — tenant timezone foundation
--
-- First-class IANA timezone on `tenants` for attendance windows, scheduling,
-- and audit display. Existing JSON config keys are backfilled once; runtime
-- resolution lives in @proctira/tenant (`resolveTenantTimezone`).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT;

UPDATE tenants
SET timezone = COALESCE(
  NULLIF(trim(config #>> '{locale,timezone}'), ''),
  NULLIF(trim(config ->> 'timezone'), ''),
  'UTC'
)
WHERE timezone IS NULL;

ALTER TABLE tenants
  ALTER COLUMN timezone SET DEFAULT 'UTC';

ALTER TABLE tenants
  ALTER COLUMN timezone SET NOT NULL;

COMMENT ON COLUMN tenants.timezone IS
  'IANA timezone for tenant-local date boundaries (W3-TIME-01).';
