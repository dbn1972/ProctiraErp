/** Shared by the server leave list and the client decision buttons (PRC-L056). */
/** Inclusive calendar-day count for an ISO date range; null when unparsable. */
export function inclusiveLeaveDays(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}
