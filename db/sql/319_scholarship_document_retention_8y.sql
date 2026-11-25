-- PRC-M215 — scholarship supporting documents: DR35 retention and no silent
-- cascade.
--
-- 249 added scholarship_application_documents.retention_until with an interim
-- default of uploaded_at + 7 years "pending counsel". The owner retention
-- schedule (DECISION_REGISTER DR35, 2026-10-27) sets scholarship supporting
-- documents to 8 years, then erase. The scholarship package's retention sweep
-- (ScholarshipDocumentService.purgeExpiredDocuments) deletes the stored object
-- first and then the row, once retention_until has passed.
--
-- Fix:
--   1. The BEFORE INSERT default becomes uploaded_at::date + 8 years
--      (249's function is replaced; an explicit value is still never
--      overwritten).
--   2. Rows still carrying 249's 7-year default move to 8 years. Rows whose
--      retention_until differs from that default were set explicitly and are
--      left alone.
--   3. scholarship_application_documents_tenant_app_fk (104) was
--      ON DELETE CASCADE: a hard delete of an application removed the document
--      rows and orphaned their stored objects (income/caste certificates) with
--      nothing left pointing at them. It becomes ON DELETE RESTRICT, so the
--      rows, and with them the object keys, stay until the retention sweep
--      removes object and row together. The application never hard-deletes a
--      scholarship application, so only direct SQL is affected.
--      Re-added NOT VALID, then VALIDATEd with FORCE ROW LEVEL SECURITY lifted
--      on both tables for the duration (the 257/307/309 pattern); FORCE is
--      restored and asserted before commit.
--
-- 104 and 249 are checksum-locked, so this is a forward migration. Idempotent.
-- Rollback (forward migration): restore the 7-year function body and
-- re-add the FK with ON DELETE CASCADE; row values set here would need the
-- reverse UPDATE.
CREATE OR REPLACE FUNCTION scholarship_application_documents_default_retention()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.retention_until IS NULL THEN
    -- DR35: scholarship supporting documents are kept 8 years, then erased.
    NEW.retention_until := NEW.uploaded_at::date + INTERVAL '8 years';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $prc_m215$
DECLARE
  lifted text[] := ARRAY[]::text[];
  rel text;
  remaining text;
  moved bigint := 0;
  rebuilt int := 0;
BEGIN
  IF to_regclass('public.scholarship_application_documents') IS NULL
     OR to_regclass('public.scholarship_applications') IS NULL THEN
    RAISE NOTICE 'PRC-M215: scholarship tables absent, skipping';
    RETURN;
  END IF;
  IF current_setting('lock_timeout') IN ('0', '0ms')
     OR current_setting('statement_timeout') IN ('0', '0ms') THEN
    RAISE EXCEPTION 'PRC-M215: lock_timeout and statement_timeout must be non-zero; apply through tools/scripts/apply-sql.sh';
  END IF;
  FOREACH rel IN ARRAY ARRAY['scholarship_application_documents', 'scholarship_applications'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || rel)::regclass
                AND relforcerowsecurity) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  UPDATE public.scholarship_application_documents
     SET retention_until = (uploaded_at::date + INTERVAL '8 years')::date
   WHERE retention_until = (uploaded_at::date + INTERVAL '7 years')::date;
  GET DIAGNOSTICS moved = ROW_COUNT;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.scholarship_application_documents'::regclass
       AND conname = 'scholarship_application_documents_tenant_app_fk'
       AND confdeltype = 'r'
  ) THEN
    ALTER TABLE public.scholarship_application_documents
      DROP CONSTRAINT IF EXISTS scholarship_application_documents_tenant_app_fk;
    ALTER TABLE public.scholarship_application_documents
      ADD CONSTRAINT scholarship_application_documents_tenant_app_fk
      FOREIGN KEY (tenant_id, application_id)
      REFERENCES public.scholarship_applications (tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.scholarship_application_documents
      VALIDATE CONSTRAINT scholarship_application_documents_tenant_app_fk;
    rebuilt := 1;
  END IF;

  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;
  SELECT string_agg(relname, ', ') INTO remaining
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname = ANY (lifted)
     AND NOT relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M215: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
  -- No FK from the documents to their application may cascade or stay unvalidated.
  SELECT string_agg(conname, ', ') INTO remaining
    FROM pg_constraint
   WHERE conrelid = 'public.scholarship_application_documents'::regclass
     AND contype = 'f'
     AND confrelid = 'public.scholarship_applications'::regclass
     AND (confdeltype <> 'r' OR NOT convalidated);
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M215: application FKs on scholarship_application_documents not RESTRICT/validated: %', remaining;
  END IF;
  RAISE NOTICE 'PRC-M215: % document row(s) moved to the 8-year default; % FK rebuilt as ON DELETE RESTRICT', moved, rebuilt;
END
$prc_m215$;
