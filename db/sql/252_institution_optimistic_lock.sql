-- PRC-L322: add an optimistic-lock version column to `institutions` so two
-- concurrent read-check-write races (e.g. two admins deactivating the same
-- institution with different reasons) produce a conflict instead of a
-- silent lost update. Safe default-backfilled ADD COLUMN, following the
-- pattern already used throughout db/sql/1xx-2xx.

ALTER TABLE institutions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $assert_institutions_version_column$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'institutions'
       AND column_name = 'version'
  ) THEN
    RAISE EXCEPTION 'PRC-L322: institutions.version column missing';
  END IF;
END
$assert_institutions_version_column$;
