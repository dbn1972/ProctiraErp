-- PR B1 (FKB-009..FKB-105, academic): tenant-composite foreign keys for every
-- academic child -> parent reference in pr-b1/edges.csv, validated with FORCE
-- ROW LEVEL SECURITY lifted, after a fail-closed preflight for existing
-- cross-tenant or dangling rows.
--
-- Problem: the 33 parent FKs below are id-only (`<col> REFERENCES
-- <parent>(id)`). The RI check runs as the table owner and ignores RLS, so a
-- tenant-A row could reference a tenant-B parent. Live probe on origin/main
-- 68707244 (tenant A writing tenant B's id): POST /gradebook/credit-rules with
-- B's boardId 201 (FKB-015); POST/PUT /institutions with B's areaId 201/200
-- (FKB-047); POST /report-cards/generate and /generate/bulk with B's studentId
-- 202 (FKB-082); POST /timetable/meetings with B's bell period, room, section
-- or subject 201 (FKB-091..094); POST/PUT /timetable/sections with B's
-- defaultRoomId 201/200 (FKB-096). Every other edge with an HTTP writer
-- answered the same 4xx for B's id and a random id (the service already
-- resolves that parent in-tenant); the remaining edges have no runtime writer
-- (seeds, triggers, server-set ids). The service layer now resolves every
-- VULNERABLE parent in-tenant (404); this file closes the gap in the database
-- for every writer, including future ones. The RI cascade also runs as the
-- owner, so deleting tenant B's section would CASCADE into tenant A's meetings.
--
-- Fix: for each edge add
--   <child>_<col>_tenant_fk FOREIGN KEY (tenant_id, <col>)
--     REFERENCES <parent> (tenant_id, id) NOT VALID
-- backed by the parent (tenant_id, id) unique indexes (db/sql/306 for 18
-- parents, db/sql/254 for students, staff and subjects), then VALIDATE it in
-- the same transaction. ON DELETE / ON UPDATE / deferrability are mirrored from
-- the existing id-only FK read from the catalog (as in db/sql/255 and 304).
-- ON DELETE SET NULL becomes ON DELETE SET NULL (<col>) (PostgreSQL 15+
-- column list) so tenant_id is never nulled; the block refuses to run below
-- PostgreSQL 15 and refuses SET DEFAULT. The id-only FKs are KEPT: once the
-- composite twin is validated every child row's (tenant_id, <col>) equals its
-- parent's (tenant_id, id), so the id-only FK's CASCADE / SET NULL can only
-- reach rows of the parent's own tenant.
--
--   finding  child  column  parent  ON DELETE (mirrored)
--   FKB-009  assessment_items                  grading_scheme_id          grading_schemes             RESTRICT (id-only FK NOT VALID)
--   FKB-010  assessment_results                assessment_item_id         assessment_items            RESTRICT (id-only FK NOT VALID)
--   FKB-011  bell_periods                      bell_schedule_id           bell_schedules              CASCADE
--   FKB-012  board_codes                       board_id                   boards                      NO ACTION
--   FKB-013  board_export_jobs                 board_id                   boards                      NO ACTION
--   FKB-015  credit_rules                      board_id                   boards                      NO ACTION  VULNERABLE
--   FKB-017  enrollment_history                enrollment_id              enrollments                 RESTRICT
--   FKB-019  exam_invigilators                 session_id                 exam_sessions               CASCADE
--   FKB-020  exam_seating                      session_id                 exam_sessions               SET NULL (col)
--   FKB-021  examination_publication_versions  examination_id             examinations                NO ACTION
--   FKB-025  geographic_areas                  parent_id                  geographic_areas            NO ACTION
--   FKB-026  grade_change_audit                grade_entry_id             grade_entries               RESTRICT
--   FKB-027  grade_entries                     section_id                 sections                    NO ACTION
--   FKB-028  grading_scale_bands               grading_scale_id           grading_scales              CASCADE
--   FKB-029  grading_scales                    board_id                   boards                      NO ACTION
--   FKB-045  institution_infrastructure        parent_id                  institution_infrastructure  RESTRICT
--   FKB-046  institution_repair_requests       infrastructure_id          institution_infrastructure  CASCADE
--   FKB-047  institutions                      area_id                    geographic_areas            NO ACTION  VULNERABLE
--   FKB-048  institutions                      board_id                   boards                      NO ACTION
--   FKB-082  report_card_jobs                  student_id                 students                    NO ACTION  VULNERABLE
--   FKB-083  report_card_jobs                  template_id                report_card_templates       RESTRICT
--   FKB-090  section_enrollments               section_id                 sections                    CASCADE
--   FKB-091  section_meetings                  bell_period_id             bell_periods                NO ACTION  VULNERABLE
--   FKB-092  section_meetings                  room_id                    rooms                       NO ACTION  VULNERABLE
--   FKB-093  section_meetings                  section_id                 sections                    CASCADE  VULNERABLE
--   FKB-094  section_meetings                  subject_id                 subjects                    NO ACTION  VULNERABLE
--   FKB-095  section_meetings                  teacher_staff_id           staff                       NO ACTION
--   FKB-096  sections                          default_room_id            rooms                       NO ACTION  VULNERABLE
--   FKB-101  student_consents                  supersedes_id              student_consents            NO ACTION
--   FKB-102  substitutions                     section_meeting_id         section_meetings            CASCADE
--   FKB-103  transcript_issuances              signing_key_id             transcript_signing_keys     NO ACTION
--   FKB-104  transfer_records                  destination_enrollment_id  enrollments                 NO ACTION
--   FKB-105  transfer_records                  source_enrollment_id       enrollments                 NO ACTION
-- (constraint name for every edge: <child>_<column>_tenant_fk, all <= 63 chars.)
--
-- One transaction (apply-sql.sh per-file --single-transaction), one DO block:
--   0. guards: lock_timeout and statement_timeout must be non-zero (apply-sql.sh
--      sets both via migration-timeouts.sh; a bare psql session with no
--      timeouts is refused), server_version_num >= 150000, and the 21 parent
--      (tenant_id, id) indexes must be present and valid;
--   1. lift FORCE ROW LEVEL SECURITY on the 38 involved tables, children first
--      (under FORCE the owner session has no app.tenant_id and would see zero
--      rows, so neither the preflight nor VALIDATE would read anything);
--   2. preflight: per edge, count child rows whose parent is missing or has a
--      different tenant_id (the two id-only FKs that are NOT VALID today,
--      assessment_items.grading_scheme_id and
--      assessment_results.assessment_item_id, can hold dangling ids; they are
--      counted the same way);
--   3. if any count is > 0, RAISE with the constraint/count pairs. Fail-closed:
--      nothing is deleted or re-parented, and the RAISE rolls back the whole
--      transaction including the FORCE lift;
--   4. add the missing composite FKs NOT VALID;
--   5. VALIDATE the unvalidated composite FK of each listed edge (only these
--      33 edges; other NOT VALID constraints on the same tables are left as
--      they are);
--   6. restore FORCE ROW LEVEL SECURITY on every table that had it;
--   7. assert all 33 composite FKs exist and are validated, and FORCE is back.
--
-- Locks (rollout note): NO FORCE ROW LEVEL SECURITY takes ACCESS EXCLUSIVE on
-- each of the 38 tables until COMMIT (acquired children first, parents last),
-- including the hot parents students, staff, subjects, sections, enrollments
-- and institutions: timetable, gradebook, assessment, examination, enrollment,
-- student and institution reads and writes wait for the duration of the file.
-- VALIDATE scans the 26 child tables in full and probes the parent index per
-- row; the largest are expected to be grade_entries, grade_change_audit,
-- enrollment_history, section_meetings, section_enrollments and
-- assessment_results. Estimate the scan before the window (read-only):
--     SELECT relname, reltuples::bigint FROM pg_class
--      WHERE relnamespace = 'public'::regnamespace AND relname IN (
--       'assessment_items', 'assessment_results', 'bell_periods', 'board_codes',
--       'board_export_jobs', 'credit_rules', 'enrollment_history', 'exam_invigilators',
--       'exam_seating', 'examination_publication_versions', 'geographic_areas',
--       'grade_change_audit', 'grade_entries', 'grading_scale_bands', 'grading_scales',
--       'institution_infrastructure', 'institution_repair_requests', 'institutions',
--       'report_card_jobs', 'section_enrollments', 'section_meetings', 'sections',
--       'student_consents', 'substitutions', 'transcript_issuances',
--       'transfer_records')
--      ORDER BY 2 DESC;
-- (On the CI-path fresh database every child holds seed-size data only.) Every
-- lock wait is bounded by apply-sql.sh's lock_timeout (default 5s): a blocked
-- lock fails the deploy instead of queuing traffic. A deadlock with a
-- concurrent write aborts the file with no change; re-run apply-sql.sh.
-- Schedule a quiet window, check that statement_timeout covers the largest
-- scan, and run the step-2 detection query below in staging first.
--
-- Idempotent: an equivalent composite FK (any name) is not re-added, VALIDATE
-- only targets unvalidated composite twins of the listed edges, the preflight
-- is read-only. A re-run after success changes nothing. Ledgered by
-- apply-sql.sh as usual.
--
-- Existing data / operator remediation when step 3 fails
-- ("B1: cross-tenant or dangling parent references block academic
-- tenant-composite FKs: <constraint>=<n> cross-tenant/<m> dangling; ..."):
--   (1) List the rows (read-only). As the table owner in a quiet window:
--         BEGIN;
--         -- lift FORCE on the 38 tables inside this transaction
--         -- (ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY, one per table),
--         -- or use a BYPASSRLS read-only ops role instead
--         SELECT * FROM (
--           SELECT 'substitutions.section_meeting_id' AS edge, c.id::text AS row_key, c.tenant_id,
--                  c.section_meeting_id AS parent_id, p.tenant_id AS parent_tenant
--             FROM substitutions c LEFT JOIN section_meetings p ON p.id = c.section_meeting_id WHERE c.section_meeting_id IS NOT NULL
--           UNION ALL SELECT 'assessment_results.assessment_item_id', c.id::text, c.tenant_id, c.assessment_item_id, p.tenant_id
--             FROM assessment_results c LEFT JOIN assessment_items p ON p.id = c.assessment_item_id WHERE c.assessment_item_id IS NOT NULL
--           UNION ALL SELECT 'board_codes.board_id', c.id::text, c.tenant_id, c.board_id, p.tenant_id
--             FROM board_codes c LEFT JOIN boards p ON p.id = c.board_id WHERE c.board_id IS NOT NULL
--           UNION ALL SELECT 'board_export_jobs.board_id', c.id::text, c.tenant_id, c.board_id, p.tenant_id
--             FROM board_export_jobs c LEFT JOIN boards p ON p.id = c.board_id WHERE c.board_id IS NOT NULL
--           UNION ALL SELECT 'credit_rules.board_id', c.id::text, c.tenant_id, c.board_id, p.tenant_id
--             FROM credit_rules c LEFT JOIN boards p ON p.id = c.board_id WHERE c.board_id IS NOT NULL
--           UNION ALL SELECT 'enrollment_history.enrollment_id', c.id::text, c.tenant_id, c.enrollment_id, p.tenant_id
--             FROM enrollment_history c LEFT JOIN enrollments p ON p.id = c.enrollment_id WHERE c.enrollment_id IS NOT NULL
--           UNION ALL SELECT 'exam_invigilators.session_id', c.id::text, c.tenant_id, c.session_id, p.tenant_id
--             FROM exam_invigilators c LEFT JOIN exam_sessions p ON p.id = c.session_id WHERE c.session_id IS NOT NULL
--           UNION ALL SELECT 'exam_seating.session_id', c.id::text, c.tenant_id, c.session_id, p.tenant_id
--             FROM exam_seating c LEFT JOIN exam_sessions p ON p.id = c.session_id WHERE c.session_id IS NOT NULL
--           UNION ALL SELECT 'examination_publication_versions.examination_id', c.examination_id::text || '/v' || c.version::text, c.tenant_id, c.examination_id, p.tenant_id
--             FROM examination_publication_versions c LEFT JOIN examinations p ON p.id = c.examination_id WHERE c.examination_id IS NOT NULL
--           UNION ALL SELECT 'grade_change_audit.grade_entry_id', c.id::text, c.tenant_id, c.grade_entry_id, p.tenant_id
--             FROM grade_change_audit c LEFT JOIN grade_entries p ON p.id = c.grade_entry_id WHERE c.grade_entry_id IS NOT NULL
--           UNION ALL SELECT 'grading_scale_bands.grading_scale_id', c.id::text, c.tenant_id, c.grading_scale_id, p.tenant_id
--             FROM grading_scale_bands c LEFT JOIN grading_scales p ON p.id = c.grading_scale_id WHERE c.grading_scale_id IS NOT NULL
--           UNION ALL SELECT 'institution_repair_requests.infrastructure_id', c.id::text, c.tenant_id, c.infrastructure_id, p.tenant_id
--             FROM institution_repair_requests c LEFT JOIN institution_infrastructure p ON p.id = c.infrastructure_id WHERE c.infrastructure_id IS NOT NULL
--           UNION ALL SELECT 'report_card_jobs.student_id', c.id::text, c.tenant_id, c.student_id, p.tenant_id
--             FROM report_card_jobs c LEFT JOIN students p ON p.id = c.student_id WHERE c.student_id IS NOT NULL
--           UNION ALL SELECT 'report_card_jobs.template_id', c.id::text, c.tenant_id, c.template_id, p.tenant_id
--             FROM report_card_jobs c LEFT JOIN report_card_templates p ON p.id = c.template_id WHERE c.template_id IS NOT NULL
--           UNION ALL SELECT 'section_enrollments.section_id', c.id::text, c.tenant_id, c.section_id, p.tenant_id
--             FROM section_enrollments c LEFT JOIN sections p ON p.id = c.section_id WHERE c.section_id IS NOT NULL
--           UNION ALL SELECT 'transcript_issuances.signing_key_id', c.id::text, c.tenant_id, c.signing_key_id, p.tenant_id
--             FROM transcript_issuances c LEFT JOIN transcript_signing_keys p ON p.id = c.signing_key_id WHERE c.signing_key_id IS NOT NULL
--           UNION ALL SELECT 'transfer_records.destination_enrollment_id', c.id::text, c.tenant_id, c.destination_enrollment_id, p.tenant_id
--             FROM transfer_records c LEFT JOIN enrollments p ON p.id = c.destination_enrollment_id WHERE c.destination_enrollment_id IS NOT NULL
--           UNION ALL SELECT 'transfer_records.source_enrollment_id', c.id::text, c.tenant_id, c.source_enrollment_id, p.tenant_id
--             FROM transfer_records c LEFT JOIN enrollments p ON p.id = c.source_enrollment_id WHERE c.source_enrollment_id IS NOT NULL
--           UNION ALL SELECT 'student_consents.supersedes_id', c.id::text, c.tenant_id, c.supersedes_id, p.tenant_id
--             FROM student_consents c LEFT JOIN student_consents p ON p.id = c.supersedes_id WHERE c.supersedes_id IS NOT NULL
--           UNION ALL SELECT 'institution_infrastructure.parent_id', c.id::text, c.tenant_id, c.parent_id, p.tenant_id
--             FROM institution_infrastructure c LEFT JOIN institution_infrastructure p ON p.id = c.parent_id WHERE c.parent_id IS NOT NULL
--           UNION ALL SELECT 'section_meetings.bell_period_id', c.id::text, c.tenant_id, c.bell_period_id, p.tenant_id
--             FROM section_meetings c LEFT JOIN bell_periods p ON p.id = c.bell_period_id WHERE c.bell_period_id IS NOT NULL
--           UNION ALL SELECT 'section_meetings.room_id', c.id::text, c.tenant_id, c.room_id, p.tenant_id
--             FROM section_meetings c LEFT JOIN rooms p ON p.id = c.room_id WHERE c.room_id IS NOT NULL
--           UNION ALL SELECT 'section_meetings.section_id', c.id::text, c.tenant_id, c.section_id, p.tenant_id
--             FROM section_meetings c LEFT JOIN sections p ON p.id = c.section_id WHERE c.section_id IS NOT NULL
--           UNION ALL SELECT 'section_meetings.subject_id', c.id::text, c.tenant_id, c.subject_id, p.tenant_id
--             FROM section_meetings c LEFT JOIN subjects p ON p.id = c.subject_id WHERE c.subject_id IS NOT NULL
--           UNION ALL SELECT 'section_meetings.teacher_staff_id', c.id::text, c.tenant_id, c.teacher_staff_id, p.tenant_id
--             FROM section_meetings c LEFT JOIN staff p ON p.id = c.teacher_staff_id WHERE c.teacher_staff_id IS NOT NULL
--           UNION ALL SELECT 'grade_entries.section_id', c.id::text, c.tenant_id, c.section_id, p.tenant_id
--             FROM grade_entries c LEFT JOIN sections p ON p.id = c.section_id WHERE c.section_id IS NOT NULL
--           UNION ALL SELECT 'assessment_items.grading_scheme_id', c.id::text, c.tenant_id, c.grading_scheme_id, p.tenant_id
--             FROM assessment_items c LEFT JOIN grading_schemes p ON p.id = c.grading_scheme_id WHERE c.grading_scheme_id IS NOT NULL
--           UNION ALL SELECT 'grading_scales.board_id', c.id::text, c.tenant_id, c.board_id, p.tenant_id
--             FROM grading_scales c LEFT JOIN boards p ON p.id = c.board_id WHERE c.board_id IS NOT NULL
--           UNION ALL SELECT 'institutions.area_id', c.id::text, c.tenant_id, c.area_id, p.tenant_id
--             FROM institutions c LEFT JOIN geographic_areas p ON p.id = c.area_id WHERE c.area_id IS NOT NULL
--           UNION ALL SELECT 'institutions.board_id', c.id::text, c.tenant_id, c.board_id, p.tenant_id
--             FROM institutions c LEFT JOIN boards p ON p.id = c.board_id WHERE c.board_id IS NOT NULL
--           UNION ALL SELECT 'sections.default_room_id', c.id::text, c.tenant_id, c.default_room_id, p.tenant_id
--             FROM sections c LEFT JOIN rooms p ON p.id = c.default_room_id WHERE c.default_room_id IS NOT NULL
--           UNION ALL SELECT 'bell_periods.bell_schedule_id', c.id::text, c.tenant_id, c.bell_schedule_id, p.tenant_id
--             FROM bell_periods c LEFT JOIN bell_schedules p ON p.id = c.bell_schedule_id WHERE c.bell_schedule_id IS NOT NULL
--           UNION ALL SELECT 'geographic_areas.parent_id', c.id::text, c.tenant_id, c.parent_id, p.tenant_id
--             FROM geographic_areas c LEFT JOIN geographic_areas p ON p.id = c.parent_id WHERE c.parent_id IS NOT NULL
--         ) x WHERE parent_tenant IS DISTINCT FROM tenant_id;
--         ROLLBACK;
--       parent_tenant IS NULL means the parent id does not exist (dangling).
--   (2) Each listed row belongs to the tenant that wrote it (x.tenant_id). With
--       that tenant's sign-off, either re-point it to the correct parent in its
--       own tenant (or to NULL where the column is nullable)
--         UPDATE <child> SET <col> = '<own parent id>'
--          WHERE id = '<row_key>' AND tenant_id = '<child tenant>';
--       (examination_publication_versions: row_key is <examination_id>/v<version>,
--       match on tenant_id, examination_id and version)
--       or export it and delete the child together with its same-tenant
--       descendants (a meeting's substitutions, a grade entry's audit rows, an
--       assessment item's results). Audit and append-only tables
--       (grade_change_audit, enrollment_history, student_consents,
--       examination_publication_versions) follow the owning team's correction
--       procedure.
--   (3) Never modify the parent tenant's rows. Record every action in the
--       incident ticket.
--   (4) Re-run tools/scripts/apply-sql.sh: 306 is already ledgered and is
--       skipped, 307 retries.
--
-- Rollback (forward-only repo; body of a future revert migration). Drops only
-- what this file created:
--   ALTER TABLE substitutions DROP CONSTRAINT IF EXISTS substitutions_section_meeting_id_tenant_fk;
--   ALTER TABLE assessment_results DROP CONSTRAINT IF EXISTS assessment_results_assessment_item_id_tenant_fk;
--   ALTER TABLE board_codes DROP CONSTRAINT IF EXISTS board_codes_board_id_tenant_fk;
--   ALTER TABLE board_export_jobs DROP CONSTRAINT IF EXISTS board_export_jobs_board_id_tenant_fk;
--   ALTER TABLE credit_rules DROP CONSTRAINT IF EXISTS credit_rules_board_id_tenant_fk;
--   ALTER TABLE enrollment_history DROP CONSTRAINT IF EXISTS enrollment_history_enrollment_id_tenant_fk;
--   ALTER TABLE exam_invigilators DROP CONSTRAINT IF EXISTS exam_invigilators_session_id_tenant_fk;
--   ALTER TABLE exam_seating DROP CONSTRAINT IF EXISTS exam_seating_session_id_tenant_fk;
--   ALTER TABLE examination_publication_versions DROP CONSTRAINT IF EXISTS examination_publication_versions_examination_id_tenant_fk;
--   ALTER TABLE grade_change_audit DROP CONSTRAINT IF EXISTS grade_change_audit_grade_entry_id_tenant_fk;
--   ALTER TABLE grading_scale_bands DROP CONSTRAINT IF EXISTS grading_scale_bands_grading_scale_id_tenant_fk;
--   ALTER TABLE institution_repair_requests DROP CONSTRAINT IF EXISTS institution_repair_requests_infrastructure_id_tenant_fk;
--   ALTER TABLE report_card_jobs DROP CONSTRAINT IF EXISTS report_card_jobs_student_id_tenant_fk;
--   ALTER TABLE report_card_jobs DROP CONSTRAINT IF EXISTS report_card_jobs_template_id_tenant_fk;
--   ALTER TABLE section_enrollments DROP CONSTRAINT IF EXISTS section_enrollments_section_id_tenant_fk;
--   ALTER TABLE transcript_issuances DROP CONSTRAINT IF EXISTS transcript_issuances_signing_key_id_tenant_fk;
--   ALTER TABLE transfer_records DROP CONSTRAINT IF EXISTS transfer_records_destination_enrollment_id_tenant_fk;
--   ALTER TABLE transfer_records DROP CONSTRAINT IF EXISTS transfer_records_source_enrollment_id_tenant_fk;
--   ALTER TABLE student_consents DROP CONSTRAINT IF EXISTS student_consents_supersedes_id_tenant_fk;
--   ALTER TABLE institution_infrastructure DROP CONSTRAINT IF EXISTS institution_infrastructure_parent_id_tenant_fk;
--   ALTER TABLE section_meetings DROP CONSTRAINT IF EXISTS section_meetings_bell_period_id_tenant_fk;
--   ALTER TABLE section_meetings DROP CONSTRAINT IF EXISTS section_meetings_room_id_tenant_fk;
--   ALTER TABLE section_meetings DROP CONSTRAINT IF EXISTS section_meetings_section_id_tenant_fk;
--   ALTER TABLE section_meetings DROP CONSTRAINT IF EXISTS section_meetings_subject_id_tenant_fk;
--   ALTER TABLE section_meetings DROP CONSTRAINT IF EXISTS section_meetings_teacher_staff_id_tenant_fk;
--   ALTER TABLE grade_entries DROP CONSTRAINT IF EXISTS grade_entries_section_id_tenant_fk;
--   ALTER TABLE assessment_items DROP CONSTRAINT IF EXISTS assessment_items_grading_scheme_id_tenant_fk;
--   ALTER TABLE grading_scales DROP CONSTRAINT IF EXISTS grading_scales_board_id_tenant_fk;
--   ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_area_id_tenant_fk;
--   ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_board_id_tenant_fk;
--   ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_default_room_id_tenant_fk;
--   ALTER TABLE bell_periods DROP CONSTRAINT IF EXISTS bell_periods_bell_schedule_id_tenant_fk;
--   ALTER TABLE geographic_areas DROP CONSTRAINT IF EXISTS geographic_areas_parent_id_tenant_fk;
-- Data loss on rollback: none (constraints only). Dropping them re-opens the
-- cross-tenant parent references at the database layer; the service-layer
-- tenant checks stay in place.
DO $b1_academic_tenant_parent_fks$
DECLARE
  -- child, column, parent, constraint name (children first, as lock_order)
  edges CONSTANT text[] := ARRAY[
    ['substitutions', 'section_meeting_id', 'section_meetings', 'substitutions_section_meeting_id_tenant_fk'],
    ['assessment_results', 'assessment_item_id', 'assessment_items', 'assessment_results_assessment_item_id_tenant_fk'],
    ['board_codes', 'board_id', 'boards', 'board_codes_board_id_tenant_fk'],
    ['board_export_jobs', 'board_id', 'boards', 'board_export_jobs_board_id_tenant_fk'],
    ['credit_rules', 'board_id', 'boards', 'credit_rules_board_id_tenant_fk'],
    ['enrollment_history', 'enrollment_id', 'enrollments', 'enrollment_history_enrollment_id_tenant_fk'],
    ['exam_invigilators', 'session_id', 'exam_sessions', 'exam_invigilators_session_id_tenant_fk'],
    ['exam_seating', 'session_id', 'exam_sessions', 'exam_seating_session_id_tenant_fk'],
    ['examination_publication_versions', 'examination_id', 'examinations', 'examination_publication_versions_examination_id_tenant_fk'],
    ['grade_change_audit', 'grade_entry_id', 'grade_entries', 'grade_change_audit_grade_entry_id_tenant_fk'],
    ['grading_scale_bands', 'grading_scale_id', 'grading_scales', 'grading_scale_bands_grading_scale_id_tenant_fk'],
    ['institution_repair_requests', 'infrastructure_id', 'institution_infrastructure', 'institution_repair_requests_infrastructure_id_tenant_fk'],
    ['report_card_jobs', 'student_id', 'students', 'report_card_jobs_student_id_tenant_fk'],
    ['report_card_jobs', 'template_id', 'report_card_templates', 'report_card_jobs_template_id_tenant_fk'],
    ['section_enrollments', 'section_id', 'sections', 'section_enrollments_section_id_tenant_fk'],
    ['transcript_issuances', 'signing_key_id', 'transcript_signing_keys', 'transcript_issuances_signing_key_id_tenant_fk'],
    ['transfer_records', 'destination_enrollment_id', 'enrollments', 'transfer_records_destination_enrollment_id_tenant_fk'],
    ['transfer_records', 'source_enrollment_id', 'enrollments', 'transfer_records_source_enrollment_id_tenant_fk'],
    ['student_consents', 'supersedes_id', 'student_consents', 'student_consents_supersedes_id_tenant_fk'],
    ['institution_infrastructure', 'parent_id', 'institution_infrastructure', 'institution_infrastructure_parent_id_tenant_fk'],
    ['section_meetings', 'bell_period_id', 'bell_periods', 'section_meetings_bell_period_id_tenant_fk'],
    ['section_meetings', 'room_id', 'rooms', 'section_meetings_room_id_tenant_fk'],
    ['section_meetings', 'section_id', 'sections', 'section_meetings_section_id_tenant_fk'],
    ['section_meetings', 'subject_id', 'subjects', 'section_meetings_subject_id_tenant_fk'],
    ['section_meetings', 'teacher_staff_id', 'staff', 'section_meetings_teacher_staff_id_tenant_fk'],
    ['grade_entries', 'section_id', 'sections', 'grade_entries_section_id_tenant_fk'],
    ['assessment_items', 'grading_scheme_id', 'grading_schemes', 'assessment_items_grading_scheme_id_tenant_fk'],
    ['grading_scales', 'board_id', 'boards', 'grading_scales_board_id_tenant_fk'],
    ['institutions', 'area_id', 'geographic_areas', 'institutions_area_id_tenant_fk'],
    ['institutions', 'board_id', 'boards', 'institutions_board_id_tenant_fk'],
    ['sections', 'default_room_id', 'rooms', 'sections_default_room_id_tenant_fk'],
    ['bell_periods', 'bell_schedule_id', 'bell_schedules', 'bell_periods_bell_schedule_id_tenant_fk'],
    ['geographic_areas', 'parent_id', 'geographic_areas', 'geographic_areas_parent_id_tenant_fk']
  ];
  -- Children before parents, so the lock order matches the RI direction.
  lock_order CONSTANT text[] := ARRAY[
    'substitutions', 'assessment_results', 'board_codes', 'board_export_jobs',
    'credit_rules', 'enrollment_history', 'exam_invigilators', 'exam_seating',
    'examination_publication_versions', 'grade_change_audit', 'grading_scale_bands',
    'institution_repair_requests', 'report_card_jobs', 'section_enrollments',
    'transcript_issuances', 'transfer_records', 'student_consents',
    'institution_infrastructure', 'section_meetings', 'grade_entries', 'assessment_items',
    'grading_scales', 'institutions', 'sections', 'bell_periods', 'geographic_areas',
    'rooms', 'bell_schedules', 'boards', 'grading_schemes', 'exam_sessions', 'examinations',
    'enrollments', 'report_card_templates', 'transcript_signing_keys', 'students', 'staff',
    'subjects'
  ];
  -- Every parent, with its (tenant_id, id) unique index from db/sql/254 or 306.
  parents CONSTANT text[] := ARRAY[
    'assessment_items', 'bell_periods', 'bell_schedules', 'boards', 'enrollments',
    'exam_sessions', 'examinations', 'geographic_areas', 'grade_entries', 'grading_scales',
    'grading_schemes', 'institution_infrastructure', 'report_card_templates', 'rooms',
    'section_meetings', 'sections', 'staff', 'student_consents', 'students', 'subjects',
    'transcript_signing_keys'
  ];
  e text[];
  rel text;
  lifted text[] := ARRAY[]::text[];
  n_cross bigint;
  n_dangling bigint;
  orphans text := '';
  fk record;
  del_clause text;
  upd_clause text;
  defer_clause text;
  remaining text;
  created_count int := 0;
  validated_count int := 0;
BEGIN
  -- 0. guards
  IF current_setting('lock_timeout') IN ('0', '0ms')
     OR current_setting('statement_timeout') IN ('0', '0ms') THEN
    RAISE EXCEPTION 'B1: lock_timeout and statement_timeout must be non-zero (lock_timeout=%, statement_timeout=%); apply through tools/scripts/apply-sql.sh',
      current_setting('lock_timeout'), current_setting('statement_timeout');
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'B1: PostgreSQL 15 or later is required for ON DELETE SET NULL (<column>) (server_version_num=%)',
      current_setting('server_version_num');
  END IF;
  FOREACH rel IN ARRAY parents LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE ic.relnamespace = 'public'::regnamespace
         AND ic.relname = rel || '_tenant_id_id_uidx'
         AND i.indrelid = format('public.%I', rel)::regclass
         AND i.indisvalid
         AND i.indisunique
         AND i.indnkeyatts = 2
    ) THEN
      RAISE EXCEPTION 'B1: %_tenant_id_id_uidx missing or not valid/unique (apply db/sql/254 and 306 first)', rel;
    END IF;
  END LOOP;
  -- 1. lift FORCE (children first)
  FOREACH rel IN ARRAY lock_order LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = format('public.%I', rel)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;
  -- 2. preflight (read-only)
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE p.id IS NOT NULL), count(*) FILTER (WHERE p.id IS NULL)
         FROM public.%I c
         LEFT JOIN public.%I p ON p.id = c.%I
        WHERE c.%I IS NOT NULL
          AND (p.id IS NULL OR p.tenant_id IS DISTINCT FROM c.tenant_id)',
      e[1], e[3], e[2], e[2]
    ) INTO n_cross, n_dangling;
    IF n_cross > 0 OR n_dangling > 0 THEN
      orphans := orphans || format('%s=%s cross-tenant/%s dangling; ', e[4], n_cross, n_dangling);
    END IF;
  END LOOP;
  -- 3. fail closed
  IF orphans <> '' THEN
    RAISE EXCEPTION 'B1: cross-tenant or dangling parent references block academic tenant-composite FKs: %', orphans
      USING HINT = 'Nothing was changed. Follow the operator remediation in the db/sql/307 header, then re-run tools/scripts/apply-sql.sh.';
  END IF;
  -- 4. add missing composite FKs NOT VALID (mirroring the id-only FK)
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND c.conrelid = format('public.%I', e[1])::regclass
         AND c.confrelid = format('public.%I', e[3])::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = e[2]
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
    ) THEN
      CONTINUE;
    END IF;
    SELECT c.confdeltype, c.confupdtype, c.condeferrable, c.condeferred
      INTO fk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND c.conrelid = format('public.%I', e[1])::regclass
       AND c.confrelid = format('public.%I', e[3])::regclass
       AND array_length(c.conkey, 1) = 1
       AND a.attname = e[2]
       AND pa.attname = 'id'
     ORDER BY c.conname
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'B1: id-only FK %.% -> %(id) not found (schema drift)', e[1], e[2], e[3];
    END IF;
    -- SET NULL nulls only the reference column (PG 15+), never tenant_id;
    -- SET DEFAULT ('d') is not mirrored and fails below.
    del_clause := CASE fk.confdeltype
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'n' THEN format(' ON DELETE SET NULL (%I)', e[2])
      WHEN 'a' THEN ''
    END;
    upd_clause := CASE fk.confupdtype
      WHEN 'c' THEN ' ON UPDATE CASCADE'
      WHEN 'r' THEN ' ON UPDATE RESTRICT'
      WHEN 'a' THEN ''
    END;
    IF del_clause IS NULL OR upd_clause IS NULL THEN
      RAISE EXCEPTION 'B1: %.% -> % has ON DELETE % / ON UPDATE %, which this file does not mirror',
        e[1], e[2], e[3], fk.confdeltype, fk.confupdtype;
    END IF;
    defer_clause := CASE
      WHEN fk.condeferrable AND fk.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN fk.condeferrable THEN ' DEFERRABLE INITIALLY IMMEDIATE'
      ELSE ''
    END;
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = format('public.%I', e[1])::regclass AND c.conname = e[4]
    ) THEN
      RAISE EXCEPTION 'B1: constraint name % on % is taken by a non-equivalent constraint', e[4], e[1];
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) '
      'REFERENCES public.%I (tenant_id, id)%s%s%s NOT VALID',
      e[1], e[4], e[2], e[3], del_clause, upd_clause, defer_clause
    );
    created_count := created_count + 1;
  END LOOP;
  -- 5. validate the listed edges' composite FKs only (FORCE is lifted, so the
  --    scan reads every row)
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    FOR fk IN
      SELECT c.conname::text AS conname
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND NOT c.convalidated
         AND c.conrelid = format('public.%I', e[1])::regclass
         AND c.confrelid = format('public.%I', e[3])::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = e[2]
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
       ORDER BY 1
    LOOP
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', e[1], fk.conname);
      validated_count := validated_count + 1;
    END LOOP;
  END LOOP;
  -- 6. restore FORCE
  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;
  -- 7. assert
  remaining := NULL;
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND c.convalidated
         AND c.conrelid = format('public.%I', e[1])::regclass
         AND c.confrelid = format('public.%I', e[3])::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = e[2]
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
    ) THEN
      remaining := concat_ws(', ', remaining, e[4]);
    END IF;
  END LOOP;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'B1: composite FKs missing or still NOT VALID: %', remaining;
  END IF;
  SELECT string_agg(relname, ', ') INTO remaining
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname = ANY (lifted)
     AND NOT relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'B1: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
  RAISE NOTICE 'B1 academic tenant-composite FKs: % created, % validated, FORCE restored on % tables',
    created_count, validated_count, coalesce(array_length(lifted, 1), 0);
END
$b1_academic_tenant_parent_fks$;
