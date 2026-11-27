/**
 * Route parameter → fixture table resolution, shared by the API inventory
 * (`/api/v1/students/:studentId`) and the web routes (`/students/[id]`).
 *
 * Named params use PARAM_TABLE_HINTS first; a bare `id` (or an unknown name)
 * falls back to the path segment before it (`/fees/invoices/:id` →
 * fee_invoices, invoices, ...). Only tables present in the fixture manifest
 * can resolve.
 */
import type { FixtureManifest } from './fixtures.js';
import type { TenantKey } from './tenants.js';

export const PARAM_TABLE_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  studentId: ['students'],
  institutionId: ['institutions'],
  schoolId: ['institutions'],
  classId: ['classes'],
  sectionId: ['sections'],
  staffId: ['staff'],
  teacherId: ['staff'],
  employeeId: ['staff', 'hr_employees'],
  guardianId: ['guardians', 'guardian_households'],
  householdId: ['guardian_households'],
  periodId: ['academic_periods'],
  academicPeriodId: ['academic_periods'],
  termId: ['academic_periods', 'academic_terms'],
  gradeId: ['grades'],
  subjectId: ['subjects'],
  courseId: ['courses', 'lms_courses'],
  areaId: ['geographic_areas'],
  boardId: ['boards'],
  examId: ['examinations'],
  examinationId: ['examinations'],
  assessmentId: ['assessments'],
  invoiceId: ['fee_invoices', 'invoices'],
  paymentId: ['fee_payments', 'payments'],
  planId: ['fee_plans'],
  applicationId: ['admission_applications'],
  routeId: ['transport_routes'],
  stopId: ['transport_stops'],
  vehicleId: ['transport_vehicles'],
  hostelId: ['hostels'],
  roomId: ['hostel_rooms'],
  bedId: ['hostel_beds'],
  itemId: ['library_items'],
  bookId: ['library_items'],
  assignmentId: ['lms_assignments'],
  circularId: ['comms_circulars'],
  threadId: ['parent_message_threads'],
  messageId: ['parent_messages'],
  visitId: ['health_visits', 'infirmary_visits'],
  incidentId: ['health_incidents', 'discipline_incidents'],
  payrollRunId: ['payroll_runs'],
  runId: ['payroll_runs'],
  leaveId: ['leave_requests', 'staff_leave_requests'],
  workflowId: ['workflow_ui_definitions'],
  definitionId: ['workflow_ui_definitions'],
  tenantId: ['tenants'],
});

function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function plural(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Candidate tables for a param, most specific first. */
export function candidateTables(param: string, segmentsBefore: string[]): string[] {
  const out: string[] = [...(PARAM_TABLE_HINTS[param] ?? [])];
  const stat = segmentsBefore.filter((s) => s && !s.startsWith(':') && !s.startsWith('['));
  const prev = (stat[stat.length - 1] ?? '').replace(/-/g, '_');
  const prev2 = (stat[stat.length - 2] ?? '').replace(/-/g, '_');
  if (prev) {
    const base = plural(prev);
    if (prev2 && prev2 !== 'v1' && prev2 !== 'api') {
      out.push(`${singular(prev2)}_${base}`, `${prev2}_${base}`);
    }
    out.push(base, prev);
  }
  if (param !== 'id' && param.endsWith('Id')) {
    const stem = param.slice(0, -2).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out.push(plural(stem));
  }
  return [...new Set(out)];
}

export function resolveParam(
  param: string,
  segmentsBefore: string[],
  m: FixtureManifest,
  tenant: TenantKey,
): { table: string; id: string } | undefined {
  if (param === 'tenantId') return { table: 'tenants', id: m.tenants[tenant].id };
  for (const table of candidateTables(param, segmentsBefore)) {
    const id = m.ids[table]?.[tenant]?.[0];
    if (id) return { table, id };
  }
  return undefined;
}
