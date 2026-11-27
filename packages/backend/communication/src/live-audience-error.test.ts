/**
 * PRC-L089: a failed live audience query is surfaced on the preview response
 * (`liveCountError`) instead of silently falling back to the v1 estimator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ fail: false }));

vi.mock('@proctira/database', () => ({
  getSharedPgPool: () => ({}),
  withPgTenant: async (
    _pool: unknown,
    _tenantId: string,
    fn: (client: { query: () => Promise<unknown> }) => Promise<unknown>,
  ) =>
    fn({
      query: async () => {
        if (db.fail) throw new Error('relation "hostel_assignments" does not exist');
        return { rows: [{ c: 7 }] };
      },
    }),
}));

import { LIVE_COUNT_FAILED_MESSAGE, estimateAudience } from './audience.js';
import { fetchLiveAudienceCounts } from './live-audience.js';

const TENANT = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';

afterEach(() => {
  db.fail = false;
});

describe('live audience preview errors (PRC-L089)', () => {
  it('a successful live query is a live count with no error', async () => {
    const live = await fetchLiveAudienceCounts(TENANT, { scope: 'hostel' });
    const preview = estimateAudience({ scope: 'hostel' }, live);
    expect(preview).toMatchObject({ source: 'live', estimatedRecipients: 7 });
    expect(preview.liveCountError).toBeUndefined();
  });

  it('a failed live query reports liveCountError on the estimator fallback', async () => {
    db.fail = true;
    const live = await fetchLiveAudienceCounts(TENANT, { scope: 'route' });
    expect(live.liveError).toBe(true);
    const preview = estimateAudience({ scope: 'route' }, live);
    expect(preview.source).toBe('estimator');
    expect(preview.liveCountError).toEqual({
      code: 'LIVE_COUNT_FAILED',
      message: LIVE_COUNT_FAILED_MESSAGE,
    });
    // The driver error text does not reach the response.
    expect(JSON.stringify(preview)).not.toContain('does not exist');
  });

  it('a scope with no live source carries no error', async () => {
    db.fail = true;
    const preview = estimateAudience(
      { scope: 'grade' },
      await fetchLiveAudienceCounts(TENANT, { scope: 'grade' }),
    );
    expect(preview.liveCountError).toBeUndefined();
  });
});
