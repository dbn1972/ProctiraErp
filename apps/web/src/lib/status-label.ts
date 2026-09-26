/**
 * Visible status words for colour-coded bars and raw enum copy (UX_FINDINGS W7 residual).
 * The word carries the meaning; colour is only a reinforcement.
 */

const KNOWN: Record<string, string> = {
  OPEN: 'Open',
  PAID: 'Paid',
  VOID: 'Void',
  OVERDUE: 'Overdue',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  CANCELED: 'Cancelled',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  INVOICED: 'Invoiced',
  SKIPPED: 'Skipped',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  DENIED: 'Denied',
  PARTIAL: 'Partial',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  IN_PROGRESS: 'In progress',
};

/** Sentence-case a status enum. Leaves ordinary prose (already a word) readable. */
export function humanizeStatus(value: string | null | undefined): string {
  if (!value || !value.trim()) return '—';
  const raw = value.trim();
  const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const known = KNOWN[key];
  if (known) return known;
  if (raw.includes('_') || /^[A-Z0-9]+$/.test(raw)) {
    return raw
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Attendance percentage band. Thresholds match the students list bar (90 / 75). */
export function attendanceBand(pct: number, watchAt = 75): string {
  if (pct >= 90) return 'On track';
  if (pct >= watchAt) return 'Watch';
  return 'Low';
}

export function utilizationBand(pct: number): string {
  if (pct >= 100) return 'Over capacity';
  if (pct >= 95) return 'Near capacity';
  return 'Room available';
}

/** Workload as a 0–100 allocation percent. */
export function workloadBand(pct: number): string {
  if (pct >= 100) return 'At capacity';
  if (pct >= 90) return 'Near capacity';
  if (pct >= 70) return 'Steady';
  return 'Light';
}
