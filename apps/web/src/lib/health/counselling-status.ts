/**
 * Counselling session status presentation (PRC-M476).
 *
 * The gateway now carries the domain status through (including `NO_SHOW`), so the
 * UI labels each status explicitly and shows an unknown status as-is instead of
 * pretending it is "Scheduled".
 */
export type CounsellingStatusTone = 'success' | 'muted' | 'warning' | 'info' | 'neutral';

const KNOWN: Record<string, { label: string; tone: CounsellingStatusTone }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
  NO_SHOW: { label: 'No-show', tone: 'warning' },
};

export function counsellingStatusPresentation(status: string): {
  label: string;
  tone: CounsellingStatusTone;
} {
  const key = status.trim().toUpperCase().replace(/[-\s]/g, '_');
  const known = KNOWN[key];
  if (known) return known;
  const raw = status.trim();
  return { label: raw ? raw.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };
}

/** Upcoming = still scheduled and dated today or later (tenant-local YYYY-MM-DD). */
export function isUpcomingCounsellingSession(
  session: { status: string; sessionDate: string },
  today: string,
): boolean {
  if (session.status.toUpperCase() !== 'SCHEDULED') return false;
  const day = session.sessionDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today;
}
