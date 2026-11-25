-- PRC-M325 — attach the legal-hold guard (313) to the remaining subject tables.
--
-- After 313 the database refuses deletes under a legal hold only on students
-- and the PHI tables. Every other table that holds a subject's rows (staff,
-- guardians, files, fees, attendance, grades, admissions, hostel, transport,
-- LMS, certificates, ...) could still be deleted directly while the subject
-- or the whole tenant was held.
--
-- This file attaches privacy_block_delete_on_legal_hold() (313) as a BEFORE
-- DELETE trigger (plus BEFORE UPDATE OF deleted_at where the table soft
-- deletes) to every subject link the privacy package knows about
-- (packages/backend/privacy/src/tenant-data-registry.ts SUBJECT_LINK_REGISTRY,
-- student and staff kinds), to the guardian link tables the erasure path
-- pseudonymises, and to the other guardian-identity columns the runtime role
-- can delete (parent_messages.sender_user_id, parent_fee_payments.payer_user_id,
-- guardian_custody_restrictions.parent_user_id). Each (table, column, subject type) gets its own trigger, so a
-- table linked to two subjects (student_siblings, parent_child_links,
-- counselling_sessions.counsellor_id, report_card_teacher_comments) checks
-- both. search_index_documents is not attached: it is a derived index that a
-- reindex rebuilds, not a record of the subject.
--
-- Trigger name: trg_privacy_lh_<subject>_<column>. Tables or columns that do
-- not exist (or have no tenant_id) are skipped with a NOTICE. Additive and
-- idempotent (DROP TRIGGER IF EXISTS + CREATE TRIGGER).
--
-- Rollback (future forward migration): DROP TRIGGER IF EXISTS
-- trg_privacy_lh_<subject>_<column> ON <table> for each row of the list below.
DO $$
DECLARE
  r record;
  v_soft boolean;
  v_name text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- student subject links
      ('student_documents', 'student_id', 'student'),
      ('student_photos', 'student_id', 'student'),
      ('student_siblings', 'student_id', 'student'),
      ('student_siblings', 'sibling_id', 'student'),
      ('fee_concessions', 'student_id', 'student'),
      ('fee_reminder_send_audits', 'student_id', 'student'),
      ('fee_reminder_suppressions', 'student_id', 'student'),
      ('library_fines', 'student_id', 'student'),
      ('parent_fee_invoices', 'student_id', 'student'),
      ('transport_fee_links', 'student_id', 'student'),
      ('assessment_results', 'student_id', 'student'),
      ('attendance_ingest_events', 'student_id', 'student'),
      ('class_rank_snapshots', 'student_id', 'student'),
      ('enrollments', 'student_id', 'student'),
      ('examination_academic_records', 'student_id', 'student'),
      ('examination_candidate_registrations', 'student_id', 'student'),
      ('examination_candidates', 'student_id', 'student'),
      ('gpa_snapshots', 'student_id', 'student'),
      ('grade_entries', 'student_id', 'student'),
      ('hostel_assignments', 'student_id', 'student'),
      ('hostel_attendance', 'student_id', 'student'),
      ('library_holds', 'student_id', 'student'),
      ('library_loans', 'student_id', 'student'),
      ('lms_practice_attempts', 'student_id', 'student'),
      ('lms_skill_mastery', 'student_id', 'student'),
      ('mess_subscriptions', 'student_id', 'student'),
      ('section_enrollments', 'student_id', 'student'),
      ('student_attendance', 'student_id', 'student'),
      ('transport_bus_attendance', 'student_id', 'student'),
      ('transport_student_assignments', 'student_id', 'student'),
      ('admission_offers', 'enrolled_student_id', 'student'),
      ('attendance_leave_requests', 'student_id', 'student'),
      ('attendance_regularisation_requests', 'student_id', 'student'),
      ('exam_seating', 'student_id', 'student'),
      ('gate_passes', 'student_id', 'student'),
      ('guardian_custody_restrictions', 'student_id', 'student'),
      ('guardian_student_custody', 'student_id', 'student'),
      ('hostel_leaves', 'student_id', 'student'),
      ('hostel_visitors', 'student_id', 'student'),
      ('lms_submissions', 'student_id', 'student'),
      ('parent_child_links', 'student_id', 'student'),
      ('parent_consents', 'student_id', 'student'),
      ('parent_message_threads', 'student_id', 'student'),
      ('report_card_jobs', 'student_id', 'student'),
      ('report_card_teacher_comments', 'student_id', 'student'),
      ('scholarship_applications', 'applicant_id', 'student'),
      ('student_consents', 'student_id', 'student'),
      ('student_discipline_incidents', 'student_id', 'student'),
      ('student_lifecycle_certificates', 'student_id', 'student'),
      ('transcript_issuances', 'student_id', 'student'),
      ('transfer_records', 'student_id', 'student'),
      ('transport_alerts', 'student_id', 'student'),
      -- staff subject links
      ('staff', 'id', 'staff'),
      ('counselling_sessions', 'counsellor_id', 'staff'),
      ('staff_contracts', 'staff_id', 'staff'),
      ('staff_payroll_lines', 'staff_id', 'staff'),
      ('exam_invigilators', 'staff_id', 'staff'),
      ('hr_training_attendance', 'staff_id', 'staff'),
      ('staff_assignments', 'staff_id', 'staff'),
      ('staff_attendance', 'staff_id', 'staff'),
      ('staff_hr_attendance', 'staff_id', 'staff'),
      ('staff_leave_balances', 'staff_id', 'staff'),
      ('timetable_teacher_absences', 'staff_id', 'staff'),
      ('hr_appraisals', 'staff_id', 'staff'),
      ('hr_certifications', 'staff_id', 'staff'),
      ('report_card_teacher_comments', 'teacher_id', 'staff'),
      ('staff_leave_requests', 'staff_id', 'staff'),
      ('staff_qualifications', 'staff_id', 'staff'),
      -- guardian subject links (pseudonymised by the guardian erasure path)
      ('parent_child_links', 'parent_user_id', 'guardian'),
      ('guardian_household_members', 'parent_user_id', 'guardian'),
      ('parent_consents', 'parent_user_id', 'guardian'),
      -- guardian-identity columns outside the registry (runtime role has DELETE)
      ('parent_messages', 'sender_user_id', 'guardian'),
      ('parent_fee_payments', 'payer_user_id', 'guardian'),
      ('guardian_custody_restrictions', 'parent_user_id', 'guardian')
    ) AS v(tbl, col, subject)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = r.tbl
                         AND column_name = 'tenant_id')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = r.tbl
                         AND column_name = r.col) THEN
      RAISE NOTICE 'PRC-M325: %.% missing (or no tenant_id); legal-hold guard not attached',
        r.tbl, r.col;
      CONTINUE;
    END IF;
    v_soft := EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = r.tbl
                         AND column_name = 'deleted_at');
    v_name := left(format('trg_privacy_lh_%s_%s', r.subject, r.col), 63);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', v_name, r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE%s ON %I
         FOR EACH ROW EXECUTE FUNCTION privacy_block_delete_on_legal_hold(%L, %L)',
      v_name, CASE WHEN v_soft THEN ' OR UPDATE OF deleted_at' ELSE '' END,
      r.tbl, r.subject, r.col);
  END LOOP;
END $$;
