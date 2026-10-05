/**
 * PRC-M104 — checkout due dates: not in the past, within the loan policy.
 * Mirrors LIBRARY_MAX_LOAN_DAYS in packages/backend/library (server enforces too).
 */
export const LIBRARY_MAX_LOAN_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns an error message, or null when the UTC instant is acceptable. */
export function libraryDueAtError(utcIso: string, now: Date = new Date()): string | null {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return 'Enter a valid due date.';
  if (ms < now.getTime()) return 'Due date cannot be in the past.';
  if (ms > now.getTime() + LIBRARY_MAX_LOAN_DAYS * DAY_MS) {
    return `Due date cannot be more than ${LIBRARY_MAX_LOAN_DAYS} days away.`;
  }
  return null;
}

/** yyyy-mm-dd bounds for the date input (browser-local calendar day). */
export function libraryDueDateBounds(now: Date = new Date()): { min: string; max: string } {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { min: fmt(now), max: fmt(new Date(now.getTime() + LIBRARY_MAX_LOAN_DAYS * DAY_MS)) };
}
