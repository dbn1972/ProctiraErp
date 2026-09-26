/** Probes older than this are called out on the health page. */
export const HEALTH_SNAPSHOT_STALE_MS = 5 * 60 * 1000;

/** Milliseconds since `generatedAt`, or null when the timestamp cannot be parsed. */
export function healthSnapshotAgeMs(generatedAt: string, now = Date.now()): number | null {
  const parsed = Date.parse(generatedAt);
  if (Number.isNaN(parsed)) return null;
  return now - parsed;
}

export function isHealthSnapshotStale(generatedAt: string, now = Date.now()): boolean {
  const age = healthSnapshotAgeMs(generatedAt, now);
  return age !== null && age > HEALTH_SNAPSHOT_STALE_MS;
}

/** Compact age for the stale banner. */
export function formatSnapshotAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourLabel = `${hours} hour${hours === 1 ? '' : 's'}`;
  if (remainder === 0) return hourLabel;
  return `${hourLabel} ${remainder} minute${remainder === 1 ? '' : 's'}`;
}
