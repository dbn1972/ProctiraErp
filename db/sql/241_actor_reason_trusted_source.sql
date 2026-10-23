-- PRC-L293: grade_change_audit.actor_id must prefer the trusted, server-
-- validated grade_entries.entered_by column over the client/session-settable
-- `app.grade_change_actor_id` GUC.
--
-- Bug: `grade_entries_write_change_audit()` (db/sql/080) resolves v_actor as
--
--     v_actor := NULLIF(current_setting('app.grade_change_actor_id', true), '');
--     IF v_actor IS NULL AND NEW.entered_by IS NOT NULL THEN
--       v_actor := NEW.entered_by::text;
--     END IF;
--
-- i.e. the GUC wins whenever it is set, even if entered_by was already
-- populated by the application's own trusted actor resolution (gradebook
-- repositories bind both the GUC and entered_by from the same request-scoped
-- actor -- packages/backend/gradebook/src/gradebook-service.ts's actorId(user)
-- -- but the GUC is a session variable any direct-SQL caller on the same
-- connection could overwrite before the write, and ordering it first means a
-- stale/attacker-chosen GUC silently overrides a correct entered_by).
--
-- Fix: flip the precedence. Prefer NEW.entered_by (trusted, written
-- transactionally alongside the GUC bind, validated by application code) and
-- fall back to the GUC only when entered_by is NULL (legacy/system-only
-- writes that never populate entered_by).
--
-- CREATE OR REPLACE in a new file rather than editing 080 (checksum-locked),
-- following the forward-fix pattern already used for policy rewrites (e.g.
-- 071_tenant_guc_canonical.sql). Every other line of the function (action
-- resolution, from/to status + score/letter diffing, INSERT shape) is
-- preserved byte-for-byte; only the actor-resolution block is reordered.
--
-- Residual (accepted, not newly introduced): a caller with direct SQL access
-- to the same connection could still set the GUC and leave entered_by NULL,
-- in which case the GUC value is recorded. That caller already operates at a
-- higher trust tier than an HTTP client (it has a live DB session), and 080's
-- original code had the identical fallback behavior in that case.

CREATE OR REPLACE FUNCTION grade_entries_write_change_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_actor TEXT;
  v_from_status TEXT;
  v_to_status TEXT;
  material_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    material_changed := TRUE;
  ELSE
    material_changed :=
      OLD.numeric_score IS DISTINCT FROM NEW.numeric_score
      OR OLD.letter_grade IS DISTINCT FROM NEW.letter_grade
      OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
      OR OLD.published_at IS DISTINCT FROM NEW.published_at
      OR COALESCE(OLD.metadata->>'workflowStatus', '')
           IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '');
  END IF;

  IF NOT material_changed THEN
    RETURN NEW;
  END IF;

  v_from_status := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE NULLIF(OLD.metadata->>'workflowStatus', '')
  END;
  v_to_status := NULLIF(NEW.metadata->>'workflowStatus', '');
  IF v_to_status IS NULL AND NEW.published_at IS NOT NULL THEN
    v_to_status := 'PUBLISHED';
  ELSIF v_to_status IS NULL AND NEW.locked_at IS NOT NULL THEN
    v_to_status := 'LOCKED';
  ELSIF v_to_status IS NULL THEN
    v_to_status := 'DRAFT';
  END IF;

  v_action := NULLIF(current_setting('app.grade_change_action', true), '');
  IF v_action IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'grade.insert';
    ELSIF COALESCE(OLD.metadata->>'workflowStatus', '')
            IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '')
          OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
          OR OLD.published_at IS DISTINCT FROM NEW.published_at THEN
      v_action := 'grade.workflow';
    ELSE
      v_action := 'grade.score_change';
    END IF;
  END IF;

  -- PRC-L293: entered_by (trusted column) takes precedence over the
  -- client/session-settable GUC; the GUC is only a fallback for writes that
  -- never populate entered_by.
  v_actor := NULLIF(NEW.entered_by::text, '');
  IF v_actor IS NULL THEN
    v_actor := NULLIF(current_setting('app.grade_change_actor_id', true), '');
  END IF;

  INSERT INTO grade_change_audit (
    tenant_id,
    grade_entry_id,
    action,
    from_status,
    to_status,
    from_numeric_score,
    to_numeric_score,
    from_letter_grade,
    to_letter_grade,
    actor_id,
    details
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    v_action,
    v_from_status,
    v_to_status,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.numeric_score END,
    NEW.numeric_score,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.letter_grade END,
    NEW.letter_grade,
    v_actor,
    jsonb_build_object(
      'source', 'database_trigger',
      'op', TG_OP
    )
  );

  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('241_actor_reason_trusted_source.sql')
ON CONFLICT (filename) DO NOTHING;
