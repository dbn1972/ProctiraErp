/**
 * Candidate fixture tables for an id field name (`studentId` → students,
 * `invoiceId` → fee_invoices/invoices). Extends the foundation's
 * PARAM_TABLE_HINTS with body-field names this track meets, then falls back to
 * the pluralised stem of the name.
 */
import { PARAM_TABLE_HINTS } from '../../foundation/index.js';

const EXTRA_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  payerUserId: ['guardian_household_members', 'parent_child_links'],
  parentUserId: ['guardian_household_members', 'parent_child_links'],
  userId: ['guardian_household_members'],
  recipientId: ['students', 'staff'],
  targetStudentId: ['students'],
  fromStudentId: ['students'],
  toStudentId: ['students'],
  siblingId: ['students'],
  wardId: ['students'],
  childId: ['students'],
  componentId: ['fee_structure_components'],
  structureId: ['fee_structures'],
  feeStructureId: ['fee_structures'],
  concessionId: ['fee_concessions'],
  batchId: ['fee_reconciliation_batches'],
  rowId: ['fee_reconciliation_rows'],
  blockId: ['hostel_blocks'],
  bedId: ['hostel_beds'],
  roomId: ['hostel_rooms'],
  loanId: ['library_loans'],
  copyId: ['library_items'],
  programId: ['scholarship_programs', 'hr_training_programs'],
  moduleId: ['lms_modules'],
  lessonId: ['lms_lessons'],
  submissionId: ['lms_submissions'],
  circularId: ['comms_circulars'],
  campaignId: ['comms_campaigns'],
  enrollmentId: ['enrollments'],
  sectionId: ['sections'],
  assignmentId: ['lms_assignments', 'staff_assignments'],
  outcomeId: ['learning_outcomes'],
  unitId: ['syllabus_units'],
  templateId: ['report_card_templates', 'report_templates'],
  invoiceId: ['parent_fee_invoices', 'fee_invoices', 'invoices'],
  paymentId: ['parent_fee_payments', 'fee_payments'],
  routeId: ['transport_routes'],
  stopId: ['transport_stops'],
  vehicleId: ['transport_vehicles'],
});

function singular(w: string): string {
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}
function plural(w: string): string {
  if (w.endsWith('s')) return w;
  if (w.endsWith('y')) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

export function candidateFixtureTables(name: string): string[] {
  const out = new Set<string>([...(EXTRA_HINTS[name] ?? []), ...(PARAM_TABLE_HINTS[name] ?? [])]);
  if (name !== 'id' && name !== 'ids') {
    const stem = name
      .replace(/_?ids?$/i, '')
      .replace(/Ids?$/, '')
      .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
      .replace(/^_/, '');
    if (stem) {
      out.add(plural(stem));
      out.add(singular(stem));
    }
  }
  return [...out];
}
