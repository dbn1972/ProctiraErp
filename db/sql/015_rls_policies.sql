-- G-103: Row-Level Security for raw-SQL domain tables
--
-- Enables RLS and a tenant_isolation policy on every domain table that carries
-- tenant_id in db/sql (health, timetable, gradebook, notifications, transport,
-- communication, hostel, library, parent, fees, hr leave, admissions).
--
-- Isolation uses current_setting('app.tenant_id', true). Application code that
-- talks to these tables via node-pg MUST bind the tenant before queries:
--
--   SELECT set_config('app.tenant_id', '<tenant>', true);  -- transaction-local
--
-- Prefer packages/shared/database `withPgTenant(pool, tenantId, fn)` which
-- BEGIN + set_config(app.tenant_id) + set_config(app.current_tenant_id) + COMMIT.
-- Prisma paths continue to use withTenantTransaction (app.current_tenant_id);
-- that helper also sets app.tenant_id so both variable names stay aligned.
--
-- Comparison uses tenant_id::text so TEXT (health) and UUID columns both work.
-- Missing / empty app.tenant_id yields no visible rows (safe default).
--
-- Verification: tools/tenant-isolation-tests (unit note + raw-sql-rls test).
-- Apply via tools/scripts/apply-sql.sh after 001–014.

-- ---------------------------------------------------------------------------
-- Helper macro pattern (repeated per table):
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_isolation ON …;
--   CREATE POLICY tenant_isolation ON … FOR ALL
--     USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
--     WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
-- ---------------------------------------------------------------------------

-- ========================= HEALTH =========================
ALTER TABLE counselling_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON counselling_sessions;
CREATE POLICY tenant_isolation ON counselling_sessions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_measurements;
CREATE POLICY tenant_isolation ON health_measurements
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_allergies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_allergies;
CREATE POLICY tenant_isolation ON health_allergies
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_conditions;
CREATE POLICY tenant_isolation ON health_conditions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_vaccinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_vaccinations;
CREATE POLICY tenant_isolation ON health_vaccinations
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_insurance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_insurance;
CREATE POLICY tenant_isolation ON health_insurance
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_screening_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_screening_programs;
CREATE POLICY tenant_isolation ON health_screening_programs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= TIMETABLE / GRADEBOOK (003) =========================
ALTER TABLE board_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON board_codes;
CREATE POLICY tenant_isolation ON board_codes
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grading_scales;
CREATE POLICY tenant_isolation ON grading_scales
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE grading_scale_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grading_scale_bands;
CREATE POLICY tenant_isolation ON grading_scale_bands
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rooms;
CREATE POLICY tenant_isolation ON rooms
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE bell_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bell_schedules;
CREATE POLICY tenant_isolation ON bell_schedules
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE bell_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bell_periods;
CREATE POLICY tenant_isolation ON bell_periods
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sections;
CREATE POLICY tenant_isolation ON sections
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE section_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON section_enrollments;
CREATE POLICY tenant_isolation ON section_enrollments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE section_meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON section_meetings;
CREATE POLICY tenant_isolation ON section_meetings
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON substitutions;
CREATE POLICY tenant_isolation ON substitutions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE credit_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON credit_rules;
CREATE POLICY tenant_isolation ON credit_rules
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE grade_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grade_entries;
CREATE POLICY tenant_isolation ON grade_entries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE gpa_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gpa_snapshots;
CREATE POLICY tenant_isolation ON gpa_snapshots
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transcript_issuances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transcript_issuances;
CREATE POLICY tenant_isolation ON transcript_issuances
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE board_export_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON board_export_jobs;
CREATE POLICY tenant_isolation ON board_export_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= NOTIFICATIONS =========================
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_preferences;
CREATE POLICY tenant_isolation ON notification_preferences
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE notification_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_devices;
CREATE POLICY tenant_isolation ON notification_devices
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= TRANSPORT =========================
ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_routes;
CREATE POLICY tenant_isolation ON transport_routes
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transport_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_stops;
CREATE POLICY tenant_isolation ON transport_stops
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transport_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_vehicles;
CREATE POLICY tenant_isolation ON transport_vehicles
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transport_driver_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_driver_assignments;
CREATE POLICY tenant_isolation ON transport_driver_assignments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transport_student_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_student_assignments;
CREATE POLICY tenant_isolation ON transport_student_assignments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= COMMUNICATION =========================
ALTER TABLE comms_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comms_campaigns;
CREATE POLICY tenant_isolation ON comms_campaigns
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE comms_emergency_blasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comms_emergency_blasts;
CREATE POLICY tenant_isolation ON comms_emergency_blasts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= HOSTEL =========================
ALTER TABLE hostels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostels;
CREATE POLICY tenant_isolation ON hostels
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_blocks;
CREATE POLICY tenant_isolation ON hostel_blocks
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_rooms;
CREATE POLICY tenant_isolation ON hostel_rooms
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_beds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_beds;
CREATE POLICY tenant_isolation ON hostel_beds
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_assignments;
CREATE POLICY tenant_isolation ON hostel_assignments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_leaves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_leaves;
CREATE POLICY tenant_isolation ON hostel_leaves
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE hostel_visitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hostel_visitors;
CREATE POLICY tenant_isolation ON hostel_visitors
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= LIBRARY =========================
ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_items;
CREATE POLICY tenant_isolation ON library_items
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE library_loans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_loans;
CREATE POLICY tenant_isolation ON library_loans
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= PARENT PORTAL =========================
ALTER TABLE parent_child_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_child_links;
CREATE POLICY tenant_isolation ON parent_child_links
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_message_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_message_threads;
CREATE POLICY tenant_isolation ON parent_message_threads
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_messages;
CREATE POLICY tenant_isolation ON parent_messages
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_consents;
CREATE POLICY tenant_isolation ON parent_consents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_fee_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_fee_invoices;
CREATE POLICY tenant_isolation ON parent_fee_invoices
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_fee_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_fee_payments;
CREATE POLICY tenant_isolation ON parent_fee_payments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= FEES =========================
ALTER TABLE parent_fee_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_fee_plans;
CREATE POLICY tenant_isolation ON parent_fee_plans
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE parent_fee_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parent_fee_receipts;
CREATE POLICY tenant_isolation ON parent_fee_receipts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= HR LEAVE =========================
ALTER TABLE staff_leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_leave_requests;
CREATE POLICY tenant_isolation ON staff_leave_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= ADMISSIONS CRM =========================
ALTER TABLE admission_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_applications;
CREATE POLICY tenant_isolation ON admission_applications
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE admission_waitlist_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_waitlist_entries;
CREATE POLICY tenant_isolation ON admission_waitlist_entries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE admission_interview_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_interview_slots;
CREATE POLICY tenant_isolation ON admission_interview_slots
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE admission_interview_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_interview_bookings;
CREATE POLICY tenant_isolation ON admission_interview_bookings
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- ========================= CORE ONBOARDING (001) =========================
ALTER TABLE geographic_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON geographic_areas;
CREATE POLICY tenant_isolation ON geographic_areas
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON boards;
CREATE POLICY tenant_isolation ON boards
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON institutions;
CREATE POLICY tenant_isolation ON institutions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE academic_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON academic_periods;
CREATE POLICY tenant_isolation ON academic_periods
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grades;
CREATE POLICY tenant_isolation ON grades
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON students;
CREATE POLICY tenant_isolation ON students
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff;
CREATE POLICY tenant_isolation ON staff
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enrollments;
CREATE POLICY tenant_isolation ON enrollments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

