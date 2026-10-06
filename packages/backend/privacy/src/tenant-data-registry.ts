/**
 * PRC-H077: explicit, deny-by-default data-handling registries for the
 * irreversible privacy executors (tenant wipe and subject erasure).
 *
 * Tenant wipe: every tenant-scoped table in the migration catalogue
 * (`db/sql/[0-9]*.sql` + Prisma migrations) is listed here with exactly one
 * disposition. Only `wipe` tables are ever deleted. A table discovered at
 * runtime that is not listed is NOT deleted and is reported as a residual, so
 * a new migration can never silently widen the blast radius of an offboard.
 * `tenant-data-registry.test.ts` fails when a catalogue table is unclassified,
 * when a non-DML runtime table (db/runtime-table-privileges.json) is marked
 * `wipe`, or when a kept table would be cascade-deleted through a foreign key.
 *
 * Subject erasure: every table that links rows to a student/staff subject is
 * classified as handled by a domain anonymizer, retained under statutory
 * retention, a pseudonymous link (no direct identifiers once the subject row
 * is pseudonymised), or unhandled. Unhandled and unknown linked tables that
 * still hold rows for the subject produce a residual so the erasure job fails
 * closed instead of reporting `completed`.
 */

/** Statutory retention categories (kept under ERASURE_FINANCE_HEALTH_MODE=retain). */
export type RetainedDomain = 'fees' | 'payroll' | 'health';
/** Evidence kept by policy regardless of retention mode. */
export type PreservedDomain =
  'audit_archives' | 'privacy_evidence' | 'control_plane' | 'retained_dependencies';

export type TenantWipeDisposition =
  | { action: 'wipe'; domain: string }
  | { action: 'retain'; domain: RetainedDomain; basis: string }
  | { action: 'preserve'; domain: PreservedDomain; basis: string }
  | { action: 'manual'; domain: string; basis: string };

const FEES_BASIS = 'Financial records retained under statutory retention';
const PAYROLL_BASIS = 'Payroll and employment records retained under statutory retention';
const HEALTH_BASIS = 'Health records retained under statutory retention';
const AUDIT_BASIS = 'Audit and immutable ledger evidence preserved by policy';
const PRIVACY_BASIS = 'Privacy request and legal-hold evidence preserved by policy';
const CONTROL_BASIS = 'Platform control-plane state, not tenant business data';
const DEPENDENCY_BASIS =
  'Referenced by retained/preserved records through a cascading foreign key; deleting would destroy them';

const RETAINED: Record<RetainedDomain, readonly string[]> = {
  fees: [
    'fee_concessions',
    'fee_credit_notes',
    'fee_ledger_entries',
    'fee_reconciliation_batches',
    'fee_reconciliation_rows',
    'fee_refunds',
    'fee_reminder_suppressions',
    'fee_structure_components',
    'fee_structure_instalments',
    'fee_structures',
    'fee_write_offs',
    'hostel_fee_structures',
    'library_fine_policies',
    'library_fines',
    'parent_fee_invoices',
    'parent_fee_payments',
    'parent_fee_plans',
    'parent_fee_receipts',
    'scholarship_compliance_records',
    'scholarship_disbursements',
    // 109: disbursement → fees netting events; cascades from the retained disbursement.
    'scholarship_fee_outbox',
    'scholarship_programs',
    'transport_fee_links',
    'transport_fee_structures',
  ],
  payroll: [
    'staff_contracts',
    'staff_payroll_ledger_entries',
    'staff_payroll_lines',
    'staff_payroll_runs',
  ],
  health: [
    'counselling_sessions',
    'health_accommodation_plans',
    'health_allergies',
    'health_conditions',
    'health_diagnoses',
    'health_insurance',
    'health_measurements',
    'health_nurse_incidents',
    'health_phi_access_log',
    'health_phi_break_glass',
    'health_referrals',
    'health_screening_programs',
    'health_special_needs_assessments',
    'health_vaccinations',
  ],
};

const PRESERVED: Record<PreservedDomain, readonly string[]> = {
  audit_archives: [
    // Application-/trigger-written immutable ledgers (no runtime DELETE grant).
    'admission_form_configurations',
    'audit_chain_heads',
    'audit_log_entries',
    'audit_retention_configs',
    'enrollment_history',
    // 111: append-only published-result versions (no runtime DELETE grant).
    'examination_publication_versions',
    'fee_reminder_send_audits',
    'grade_change_audit',
    'grade_change_audit_orphan_quarantine',
    'institution_repair_requests',
    'transcript_issuances',
    // Needed to verify preserved transcript signatures.
    'transcript_signing_keys',
    'workflow_transition_audit',
  ],
  privacy_evidence: [
    'privacy_anonymization_jobs',
    'privacy_correction_requests',
    'privacy_erasure_requests',
    'privacy_legal_holds',
    'privacy_tenant_offboard_jobs',
  ],
  control_plane: ['transactional_outbox'],
  // Parents of retained/preserved rows through a cascading (or SET NULL) FK:
  // deleting them would silently destroy or rewrite the kept records.
  retained_dependencies: [
    'enrollments',
    // Parent of the preserved examination_publication_versions (111, FK without cascade).
    'examinations',
    'grade_entries',
    'hostels',
    'institution_infrastructure',
    'scholarship_applications',
    'transport_routes',
    'transport_stops',
    'transport_student_assignments',
    'workflow_instances',
  ],
};

/** Not deleted by the generic executor; the owning service must purge (residual). */
const MANUAL: Record<string, { domain: string; basis: string }> = {
  control_plane_documents: {
    domain: 'control_plane_documents',
    basis:
      'Mixed control-plane collections (identity users, configuration); purge through the owning control-plane service',
  },
};

const WIPE: Record<string, readonly string[]> = {
  academics: [
    'academic_calendar_events',
    'academic_periods',
    'academic_rollover_runs',
    'assessment_items',
    'assessment_outcomes',
    'assessment_results',
    'bell_periods',
    'bell_schedules',
    'board_codes',
    'board_export_jobs',
    'boards',
    'class_rank_snapshots',
    'classes',
    'comments_bank',
    'credit_rules',
    'gpa_snapshots',
    'grades',
    'grading_scale_bands',
    'grading_scales',
    'grading_schemes',
    'learning_outcomes',
    'lesson_plans',
    'report_card_institution_branding',
    'report_card_jobs',
    'report_card_teacher_comments',
    'report_card_templates',
    'rooms',
    'section_enrollments',
    'section_meetings',
    'sections',
    'subjects',
    'substitutions',
    'syllabus_units',
    'timetable_generation_jobs',
    'timetable_teacher_absences',
    'unit_coverage',
  ],
  admissions: [
    'admission_applications',
    'admission_enquiries',
    'admission_interview_bookings',
    'admission_interview_slots',
    'admission_offers',
    'admission_waitlist_entries',
    'enquiry_followups',
    'merit_list_entries',
    'merit_lists',
    'seat_matrix',
  ],
  attendance: [
    'attendance_device_keys',
    'attendance_ingest_events',
    'attendance_leave_requests',
    'attendance_regularisation_requests',
    'student_attendance',
  ],
  communications: [
    'comms_campaigns',
    'comms_circular_acks',
    'comms_circulars',
    'comms_delivery_log',
    'comms_emergency_blasts',
    'notification_devices',
    'notification_preferences',
    'notifications',
    'parent_message_threads',
    'parent_messages',
  ],
  examinations: [
    'exam_invigilators',
    'exam_marks_entries',
    'exam_reevaluation_requests',
    'exam_seating',
    'exam_sessions',
    'examination_academic_records',
    'examination_candidate_registrations',
    'examination_candidates',
    'examination_document_jobs',
    'examination_publications',
    'examination_result_analyses',
  ],
  files_storage: [
    'lms_assignment_files',
    'scholarship_application_documents',
    'student_documents',
    'student_photos',
  ],
  hostel: [
    'gate_passes',
    'hostel_assignments',
    'hostel_attendance',
    'hostel_beds',
    'hostel_blocks',
    'hostel_leaves',
    'hostel_rooms',
    'hostel_visitors',
    'mess_menu_items',
    'mess_plans',
    'mess_subscriptions',
  ],
  identity_sessions: ['refresh_tokens', 'user_sessions'],
  institution: [
    'geographic_areas',
    'institution_condition_options',
    'institution_subjects',
    'institutions',
    'tenant_theme_drafts',
    'tenant_theme_versions',
  ],
  integrations: [
    'developer_portal_api_keys',
    'developer_portal_webhook_deliveries',
    // 113: envelope-encrypted signing secrets; child of developer_portal_webhooks.
    'developer_portal_webhook_signing_secrets',
    'developer_portal_webhooks',
    'etl_pipeline_runs',
    'etl_pipelines',
    'insights_ui_import_jobs',
    'insights_ui_runs',
  ],
  library: ['library_copies', 'library_holds', 'library_items', 'library_loans'],
  lms: [
    'lms_assignments',
    'lms_content_items',
    'lms_discussion_posts',
    'lms_discussions',
    'lms_lesson_resources',
    'lms_lessons',
    'lms_module_items',
    'lms_modules',
    'lms_practice_attempts',
    'lms_question_bank',
    'lms_quiz_questions',
    'lms_rubric_criteria',
    'lms_rubric_scores',
    'lms_rubrics',
    'lms_skill_mastery',
    'lms_skills',
    'lms_submissions',
  ],
  reporting: [
    'report_artifacts',
    'report_definitions',
    'report_runs',
    'report_schedules',
    'search_index_documents',
  ],
  staff: [
    'hr_appraisal_templates',
    'hr_appraisals',
    'hr_certifications',
    'hr_training_attendance',
    'hr_training_programs',
    'hr_training_sessions',
    'staff',
    'staff_assignments',
    'staff_attendance',
    'staff_hr_attendance',
    'staff_leave_balances',
    'staff_leave_requests',
    'staff_qualifications',
  ],
  students: [
    'guardian_custody_restrictions',
    'guardian_household_members',
    'guardian_households',
    'guardian_student_custody',
    'parent_child_links',
    'parent_consents',
    'student_admission_counters',
    'student_consents',
    'student_discipline_incidents',
    // 112: durable import progress (may carry row data).
    'student_import_jobs',
    'student_merges',
    'student_siblings',
    'students',
    'transfer_records',
  ],
  transport: [
    'transport_alert_rules',
    'transport_alerts',
    'transport_bus_attendance',
    'transport_driver_assignments',
    'transport_gps_pings',
    'transport_vehicle_devices',
    'transport_vehicles',
  ],
  workflow: [
    'workflow_cases',
    'workflow_definitions',
    'workflow_ui_approvals',
    'workflow_ui_definitions',
    'workflow_ui_instances',
  ],
};

function buildWipeRegistry(): ReadonlyMap<string, TenantWipeDisposition> {
  const registry = new Map<string, TenantWipeDisposition>();
  const put = (table: string, disposition: TenantWipeDisposition) => {
    if (registry.has(table)) {
      throw new Error(`tenant-data-registry: table '${table}' classified twice`);
    }
    registry.set(table, disposition);
  };
  const basisFor: Record<RetainedDomain, string> = {
    fees: FEES_BASIS,
    payroll: PAYROLL_BASIS,
    health: HEALTH_BASIS,
  };
  for (const [domain, tables] of Object.entries(RETAINED) as Array<[RetainedDomain, string[]]>) {
    for (const t of tables) put(t, { action: 'retain', domain, basis: basisFor[domain] });
  }
  const preservedBasis: Record<PreservedDomain, string> = {
    audit_archives: AUDIT_BASIS,
    privacy_evidence: PRIVACY_BASIS,
    control_plane: CONTROL_BASIS,
    retained_dependencies: DEPENDENCY_BASIS,
  };
  for (const [domain, tables] of Object.entries(PRESERVED) as Array<[PreservedDomain, string[]]>) {
    for (const t of tables) put(t, { action: 'preserve', domain, basis: preservedBasis[domain] });
  }
  for (const [t, m] of Object.entries(MANUAL)) put(t, { action: 'manual', ...m });
  for (const [domain, tables] of Object.entries(WIPE)) {
    for (const t of tables) put(t, { action: 'wipe', domain });
  }
  return registry;
}

/** Every classified tenant-scoped table → its offboard disposition. */
export const TENANT_WIPE_REGISTRY: ReadonlyMap<string, TenantWipeDisposition> = buildWipeRegistry();

/** Disposition for a tenant-scoped table; `undefined` means unclassified (never deleted). */
export function tenantWipeDisposition(table: string): TenantWipeDisposition | undefined {
  return TENANT_WIPE_REGISTRY.get(table);
}

// ─── Subject erasure coverage ────────────────────────────────────────────────

export type SubjectKind = 'student' | 'staff';

/**
 * - `handled`: a domain anonymizer in `defaultDomainAnonymizers` mutates/deletes it.
 * - `retained`: statutory retention (fees/payroll/health); reported, not mutated.
 * - `pseudonymous`: only an opaque subject id plus non-identifying facts; becomes
 *   de-identified once the subject row is pseudonymised.
 * - `unhandled`: holds direct identifiers, free text, generated artifacts or
 *   immutable evidence about the subject; rows present → residual.
 */
export type SubjectLinkHandling = 'handled' | 'retained' | 'pseudonymous' | 'unhandled';

export interface SubjectLink {
  table: string;
  /** Column holding the subject id (compared as text). */
  column: string;
  handling: SubjectLinkHandling;
}

/** Columns that link a row to a subject of this kind (used for runtime discovery). */
export const SUBJECT_LINK_COLUMNS: Record<SubjectKind, readonly string[]> = {
  student: ['student_id', 'sibling_id', 'enrolled_student_id', 'applicant_id'],
  staff: ['staff_id', 'teacher_id', 'counsellor_id'],
};

const link = (table: string, column: string, handling: SubjectLinkHandling): SubjectLink => ({
  table,
  column,
  handling,
});

export const SUBJECT_LINK_REGISTRY: Record<SubjectKind, readonly SubjectLink[]> = {
  student: [
    link('students', 'id', 'handled'),
    link('student_documents', 'student_id', 'handled'),
    link('student_photos', 'student_id', 'handled'),
    link('student_siblings', 'student_id', 'handled'),
    link('student_siblings', 'sibling_id', 'handled'),
    // Statutory retention.
    link('counselling_sessions', 'student_id', 'retained'),
    link('fee_concessions', 'student_id', 'retained'),
    link('fee_reminder_send_audits', 'student_id', 'retained'),
    link('fee_reminder_suppressions', 'student_id', 'retained'),
    link('health_accommodation_plans', 'student_id', 'retained'),
    link('health_allergies', 'student_id', 'retained'),
    link('health_conditions', 'student_id', 'retained'),
    link('health_diagnoses', 'student_id', 'retained'),
    link('health_insurance', 'student_id', 'retained'),
    link('health_measurements', 'student_id', 'retained'),
    link('health_nurse_incidents', 'student_id', 'retained'),
    link('health_phi_access_log', 'student_id', 'retained'),
    link('health_phi_break_glass', 'student_id', 'retained'),
    link('health_referrals', 'student_id', 'retained'),
    link('health_special_needs_assessments', 'student_id', 'retained'),
    link('health_vaccinations', 'student_id', 'retained'),
    link('library_fines', 'student_id', 'retained'),
    link('parent_fee_invoices', 'student_id', 'retained'),
    link('transport_fee_links', 'student_id', 'retained'),
    // Opaque id + non-identifying facts.
    link('assessment_results', 'student_id', 'pseudonymous'),
    link('attendance_ingest_events', 'student_id', 'pseudonymous'),
    link('class_rank_snapshots', 'student_id', 'pseudonymous'),
    link('enrollments', 'student_id', 'pseudonymous'),
    link('examination_academic_records', 'student_id', 'pseudonymous'),
    link('examination_candidate_registrations', 'student_id', 'pseudonymous'),
    link('examination_candidates', 'student_id', 'pseudonymous'),
    link('gpa_snapshots', 'student_id', 'pseudonymous'),
    link('grade_entries', 'student_id', 'pseudonymous'),
    link('hostel_assignments', 'student_id', 'pseudonymous'),
    link('hostel_attendance', 'student_id', 'pseudonymous'),
    link('library_holds', 'student_id', 'pseudonymous'),
    link('library_loans', 'student_id', 'pseudonymous'),
    link('lms_practice_attempts', 'student_id', 'pseudonymous'),
    link('lms_skill_mastery', 'student_id', 'pseudonymous'),
    link('mess_subscriptions', 'student_id', 'pseudonymous'),
    link('section_enrollments', 'student_id', 'pseudonymous'),
    link('student_attendance', 'student_id', 'pseudonymous'),
    link('transport_bus_attendance', 'student_id', 'pseudonymous'),
    link('transport_student_assignments', 'student_id', 'pseudonymous'),
    // Direct identifiers / free text / artifacts / immutable evidence → residual.
    link('admission_offers', 'enrolled_student_id', 'unhandled'),
    link('attendance_leave_requests', 'student_id', 'unhandled'),
    link('attendance_regularisation_requests', 'student_id', 'unhandled'),
    link('exam_seating', 'student_id', 'unhandled'),
    link('gate_passes', 'student_id', 'unhandled'),
    link('guardian_custody_restrictions', 'student_id', 'unhandled'),
    link('guardian_student_custody', 'student_id', 'unhandled'),
    link('hostel_leaves', 'student_id', 'unhandled'),
    link('hostel_visitors', 'student_id', 'unhandled'),
    link('lms_submissions', 'student_id', 'unhandled'),
    link('parent_child_links', 'student_id', 'unhandled'),
    link('parent_consents', 'student_id', 'unhandled'),
    link('parent_message_threads', 'student_id', 'unhandled'),
    link('report_card_jobs', 'student_id', 'unhandled'),
    link('report_card_teacher_comments', 'student_id', 'unhandled'),
    link('scholarship_applications', 'applicant_id', 'unhandled'),
    link('search_index_documents', 'entity_id', 'unhandled'),
    link('student_consents', 'student_id', 'unhandled'),
    link('student_discipline_incidents', 'student_id', 'unhandled'),
    link('transcript_issuances', 'student_id', 'unhandled'),
    link('transfer_records', 'student_id', 'unhandled'),
    link('transport_alerts', 'student_id', 'unhandled'),
  ],
  staff: [
    link('staff', 'id', 'handled'),
    link('counselling_sessions', 'counsellor_id', 'retained'),
    link('staff_contracts', 'staff_id', 'retained'),
    link('staff_payroll_lines', 'staff_id', 'retained'),
    link('exam_invigilators', 'staff_id', 'pseudonymous'),
    link('hr_training_attendance', 'staff_id', 'pseudonymous'),
    link('staff_assignments', 'staff_id', 'pseudonymous'),
    link('staff_attendance', 'staff_id', 'pseudonymous'),
    link('staff_hr_attendance', 'staff_id', 'pseudonymous'),
    link('staff_leave_balances', 'staff_id', 'pseudonymous'),
    link('timetable_teacher_absences', 'staff_id', 'pseudonymous'),
    link('hr_appraisals', 'staff_id', 'unhandled'),
    link('hr_certifications', 'staff_id', 'unhandled'),
    link('report_card_teacher_comments', 'teacher_id', 'unhandled'),
    link('staff_leave_requests', 'staff_id', 'unhandled'),
    link('staff_qualifications', 'staff_id', 'unhandled'),
  ],
};

/** Normalise a privacy subject type onto a registry kind (undefined → no registry). */
export function subjectKindFor(subjectType: string): SubjectKind | undefined {
  const t = subjectType.trim().toLowerCase();
  if (t === 'student') return 'student';
  if (t === 'staff' || t === 'employee' || t === 'teacher') return 'staff';
  return undefined;
}
