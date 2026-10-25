/**
 * PRC-L096: in-memory analytics must never report negative active installs and
 * must bucket week/month series in UTC (matching the ISO day buckets), not in
 * the server's local time zone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type { AnalyticsEventEntity } from './developer-portal-repository.js';

const PLUGIN = 'tz-bucket-plugin';

function event(
  id: string,
  eventType: AnalyticsEventEntity['eventType'],
  createdAt: string,
): AnalyticsEventEntity {
  return { id, pluginName: PLUGIN, eventType, metadata: null, createdAt: new Date(createdAt) };
}

describe('InMemoryDeveloperPortalRepository analytics (PRC-L096)', () => {
  let repo: InMemoryDeveloperPortalRepository;
  const originalTz = process.env.TZ;

  beforeEach(() => {
    repo = new InMemoryDeveloperPortalRepository();
  });

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('floors activeInstalls at zero when uninstalls exceed installs', async () => {
    await repo.recordAnalyticsEvent(event('e1', 'install', '2026-03-01T10:00:00Z'));
    await repo.recordAnalyticsEvent(event('e2', 'uninstall', '2026-03-01T11:00:00Z'));
    await repo.recordAnalyticsEvent(event('e3', 'uninstall', '2026-03-01T12:00:00Z'));
    await repo.recordAnalyticsEvent(event('e4', 'uninstall', '2026-03-01T13:00:00Z'));

    const summary = await repo.getPluginAnalyticsSummary(PLUGIN);
    expect(summary.totalInstalls).toBe(1);
    expect(summary.activeInstalls).toBe(0);
  });

  it('buckets week and month in UTC regardless of server time zone', async () => {
    // 2026-03-01T03:30Z is Sunday 1 March in UTC but Saturday 28 February in Los Angeles.
    process.env.TZ = 'America/Los_Angeles';
    await repo.recordAnalyticsEvent(event('e1', 'install', '2026-03-01T03:30:00Z'));

    const day = await repo.getAnalyticsTimeSeries({ pluginName: PLUGIN }, 'day');
    const week = await repo.getAnalyticsTimeSeries({ pluginName: PLUGIN }, 'week');
    const month = await repo.getAnalyticsTimeSeries({ pluginName: PLUGIN }, 'month');

    expect(day.map((b) => b.date)).toEqual(['2026-03-01']);
    // Monday-start ISO week containing Sunday 2026-03-01 starts on 2026-02-23.
    expect(week.map((b) => b.date)).toEqual(['2026-02-23']);
    expect(month.map((b) => b.date)).toEqual(['2026-03-01']);
  });

  it('keeps Monday events in their own week bucket in UTC', async () => {
    // Monday 2026-03-02T23:30Z is already Tuesday in Kiritimati (UTC+14).
    process.env.TZ = 'Pacific/Kiritimati';
    await repo.recordAnalyticsEvent(event('e1', 'api_call', '2026-03-02T23:30:00Z'));

    const week = await repo.getAnalyticsTimeSeries({ pluginName: PLUGIN }, 'week');
    expect(week).toEqual([
      { date: '2026-03-02', installs: 0, uninstalls: 0, apiCalls: 1, errors: 0 },
    ]);
  });
});
