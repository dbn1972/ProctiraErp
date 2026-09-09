/** Pure domain helpers for G-916 holds and fines. */

export const HOLD_READY_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_CENTS_PER_DAY = 500;
export const DEFAULT_CAP_CENTS = 5000;

export function overdueDaysSince(dueAt: Date, now: Date = new Date()): number {
  const overdueMs = now.getTime() - dueAt.getTime();
  if (overdueMs <= 0) return 0;
  return Math.max(1, Math.ceil(overdueMs / (24 * 60 * 60 * 1000)));
}

export function computeFineCents(days: number, centsPerDay: number, capCents: number): number {
  if (days <= 0 || centsPerDay <= 0) return 0;
  return Math.min(days * centsPerDay, capCents);
}

export function holdReadyExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + HOLD_READY_MS);
}
