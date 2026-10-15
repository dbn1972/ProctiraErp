-- PRC-M505 — parent_child_links authority flags must fail closed.
--
-- db/sql/010 created parent_child_links with is_primary, can_consent_medical and
-- can_view_fees as BOOLEAN NOT NULL DEFAULT true. A link row created without an
-- explicit value therefore granted medical-consent authority and fee visibility
-- by default (fail-open) — including to a non-primary/again-marked-primary
-- guardian. Authority over a minor's medical consent and financial data must be
-- granted explicitly, never defaulted on.
--
-- This forward migration flips the column DEFAULTs to false so a row inserted
-- without an explicit flag is denied by default. Existing rows are NOT changed
-- (that is a data decision for the product/privacy owners, not a schema default);
-- only the default for future inserts changes. The parent-portal service should
-- pass explicit flags; omission now fails closed instead of open.
--
-- 010 is checksum-locked (≤134) and is not edited. Additive / idempotent:
-- ALTER COLUMN SET DEFAULT is a catalog-only change (no table rewrite, no lock
-- on data) and re-running sets the same default.

DO $parent_links_fail_closed$
BEGIN
  IF to_regclass('public.parent_child_links') IS NULL THEN
    RAISE NOTICE 'PRC-M505: parent_child_links missing; skipping';
    RETURN;
  END IF;

  ALTER TABLE parent_child_links ALTER COLUMN is_primary SET DEFAULT false;
  ALTER TABLE parent_child_links ALTER COLUMN can_consent_medical SET DEFAULT false;
  ALTER TABLE parent_child_links ALTER COLUMN can_view_fees SET DEFAULT false;
END
$parent_links_fail_closed$;

-- Assert the new deny-by-default is in effect, or fail the apply.
DO $parent_links_assert$
DECLARE
  d_primary TEXT;
  d_medical TEXT;
  d_fees TEXT;
BEGIN
  IF to_regclass('public.parent_child_links') IS NULL THEN
    RETURN;
  END IF;
  SELECT column_default INTO d_primary FROM information_schema.columns
   WHERE table_schema='public' AND table_name='parent_child_links' AND column_name='is_primary';
  SELECT column_default INTO d_medical FROM information_schema.columns
   WHERE table_schema='public' AND table_name='parent_child_links' AND column_name='can_consent_medical';
  SELECT column_default INTO d_fees FROM information_schema.columns
   WHERE table_schema='public' AND table_name='parent_child_links' AND column_name='can_view_fees';
  IF d_primary NOT LIKE 'false%' OR d_medical NOT LIKE 'false%' OR d_fees NOT LIKE 'false%' THEN
    RAISE EXCEPTION 'PRC-M505: parent_child_links authority flags are not fail-closed (defaults: %, %, %)',
      d_primary, d_medical, d_fees;
  END IF;
END
$parent_links_assert$;

INSERT INTO schema_migrations (filename)
VALUES ('191_parent_child_links_fail_closed_defaults.sql')
ON CONFLICT (filename) DO NOTHING;
