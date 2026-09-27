import { describe, expect, it } from 'vitest';

import {
  formatSnapshotAge,
  HEALTH_SNAPSHOT_STALE_MS,
  healthSnapshotAgeMs,
  isHealthSnapshotStale,
} from './health-snapshot';

describe('health snapshot age', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');

  it('returns null for an unparseable timestamp', () => {
    expect(healthSnapshotAgeMs('not-a-date', now)).toBeNull();
    expect(isHealthSnapshotStale('not-a-date', now)).toBe(false);
  });

  it('treats a fresh snapshot as current', () => {
    const generatedAt = new Date(now - 60_000).toISOString();
    expect(isHealthSnapshotStale(generatedAt, now)).toBe(false);
  });

  it('flags snapshots older than the stale window', () => {
    const generatedAt = new Date(now - HEALTH_SNAPSHOT_STALE_MS - 1_000).toISOString();
    expect(isHealthSnapshotStale(generatedAt, now)).toBe(true);
    expect(formatSnapshotAge(healthSnapshotAgeMs(generatedAt, now) ?? 0)).toBe('5 minutes');
  });

  it('formats multi-hour ages', () => {
    expect(formatSnapshotAge(2 * 60 * 60_000 + 3 * 60_000)).toBe('2 hours 3 minutes');
  });
});
