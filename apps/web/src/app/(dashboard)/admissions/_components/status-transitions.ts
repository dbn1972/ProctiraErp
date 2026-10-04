/**
 * Admissions application status transitions offered by the staff UI.
 *
 * Mirrors `APPLICATION_STATUS_TRANSITIONS` in
 * `packages/backend/registration/src/registration-service.ts`, which is the
 * enforcing source of truth; this copy only narrows the options shown.
 */
export type ApplicationStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  waitlisted: 'Waitlisted',
  approved: 'Approved',
  rejected: 'Rejected',
};

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  pending: ['under_review', 'waitlisted', 'rejected'],
  under_review: ['waitlisted', 'approved', 'rejected'],
  waitlisted: ['under_review', 'approved', 'rejected'],
  approved: [],
  rejected: [],
};

function isApplicationStatus(value: string): value is ApplicationStatus {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
}

/** Valid next statuses for an application in `current` status. */
export function nextApplicationStatuses(current: string): readonly ApplicationStatus[] {
  return isApplicationStatus(current) ? TRANSITIONS[current] : [];
}

/** Final decisions that require explicit confirmation before submit. */
export function requiresConfirmation(status: ApplicationStatus): boolean {
  return status === 'approved' || status === 'rejected';
}
