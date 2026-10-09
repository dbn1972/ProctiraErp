/**
 * PRC-H049 (residual): sandboxes, ratings, docs and analytics must be durable in Postgres, not
 * per-process memory. A second PgDeveloperPortalDurableStore instance (restart / replica) must see
 * the same rows — the property the in-memory residual lacked.
 *
 * Skipped unless DATABASE_URL (or MIGRATOR_DATABASE_URL) is set, matching the other *.live.test.ts.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

const CONNECTION = process.env['DATABASE_URL'] ?? process.env['MIGRATOR_DATABASE_URL'] ?? '';
const describeLive = CONNECTION ? describe : describe.skip;

const ACCOUNT_ID = '7b7b7b7b-0000-4000-8000-00000000a001';
const SANDBOX_ID = '7b7b7b7b-0000-4000-8000-00000000b001';
const RATING_ID = '7b7b7b7b-0000-4000-8000-00000000c001';
const DOC_ID = '7b7b7b7b-0000-4000-8000-00000000d001';
const EVENT_ID = '7b7b7b7b-0000-4000-8000-00000000e001';
const PLUGIN = 'live-h049-plugin';
const TENANT = '7b7b7b7b-0000-4000-8000-00000000f001';

describeLive('PgDeveloperPortalDurableStore — H049 residual durability', () => {
  let pool: pg.Pool;
  let store: PgDeveloperPortalDurableStore;

  async function asPlatformAdmin(sql: string, params: unknown[] = []) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      await client.query(sql, params);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION, max: 3 });
    store = new PgDeveloperPortalDurableStore(pool);
    // Clean any residue from a prior failed run.
    await asPlatformAdmin(`DELETE FROM developer_portal_sandboxes WHERE id = $1`, [SANDBOX_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_ratings WHERE id = $1`, [RATING_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_doc_pages WHERE id = $1`, [DOC_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_analytics_events WHERE plugin_name = $1`, [
      PLUGIN,
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    await asPlatformAdmin(`DELETE FROM developer_portal_sandboxes WHERE id = $1`, [SANDBOX_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_ratings WHERE id = $1`, [RATING_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_doc_pages WHERE id = $1`, [DOC_ID]);
    await asPlatformAdmin(`DELETE FROM developer_portal_analytics_events WHERE plugin_name = $1`, [
      PLUGIN,
    ]);
    await pool.end();
  });

  it('persists a sandbox visible to a fresh store instance', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    await store.createSandbox({
      id: SANDBOX_ID,
      accountId: ACCOUNT_ID,
      name: 'Live SB',
      description: 'desc',
      tenantId: TENANT,
      status: 'provisioning',
      expiresAt,
      apiEndpoint: 'https://sandbox.example/api',
      createdAt: new Date(),
    });
    await store.updateSandboxStatus(SANDBOX_ID, 'active');

    const fresh = new PgDeveloperPortalDurableStore(pool);
    const got = await fresh.getSandboxById(SANDBOX_ID);
    expect(got?.status).toBe('active');
    expect(got?.tenantId).toBe(TENANT);
    expect((await fresh.listSandboxes(ACCOUNT_ID)).some((s) => s.id === SANDBOX_ID)).toBe(true);
  });

  it('persists a rating and aggregates the average', async () => {
    await store.createRating({
      id: RATING_ID,
      pluginName: PLUGIN,
      accountId: ACCOUNT_ID,
      rating: 4,
      review: 'good',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.updateRating(RATING_ID, 5, 'great');
    const fresh = new PgDeveloperPortalDurableStore(pool);
    expect((await fresh.getRatingByAccountAndPlugin(ACCOUNT_ID, PLUGIN))?.rating).toBe(5);
    const avg = await fresh.getAverageRating(PLUGIN);
    expect(avg.count).toBe(1);
    expect(avg.average).toBe(5);
  });

  it('persists a doc page by slug and lists it', async () => {
    await store.createDocPage({
      id: DOC_ID,
      slug: 'live-h049-doc',
      title: 'T',
      content: 'C',
      category: 'guides',
      order: 1,
      published: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const fresh = new PgDeveloperPortalDurableStore(pool);
    expect((await fresh.getDocPageBySlug('live-h049-doc'))?.title).toBe('T');
    const list = await fresh.listDocPages({ category: 'guides', published: true });
    expect(list.some((d) => d.id === DOC_ID)).toBe(true);
  });

  it('persists analytics events and summarises them', async () => {
    await store.recordAnalyticsEvent({
      id: EVENT_ID,
      pluginName: PLUGIN,
      eventType: 'install',
      metadata: { tenant: 't1' },
      createdAt: new Date(),
    });
    await store.recordAnalyticsEvent({
      id: '7b7b7b7b-0000-4000-8000-00000000e002',
      pluginName: PLUGIN,
      eventType: 'api_call',
      metadata: null,
      createdAt: new Date(),
    });
    const fresh = new PgDeveloperPortalDurableStore(pool);
    const summary = await fresh.getPluginAnalyticsSummary(PLUGIN);
    expect(summary.totalInstalls).toBe(1);
    expect(summary.totalApiCalls).toBe(1);
    expect(summary.averageRating).toBe(5); // from the rating test's persisted row
    const series = await fresh.getAnalyticsTimeSeries({ pluginName: PLUGIN }, 'day');
    expect(series.reduce((n, s) => n + s.installs, 0)).toBe(1);
  });
});
