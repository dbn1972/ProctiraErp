import { describe, expect, it } from 'vitest';

import { shouldSeedDemoData } from './demo-seed-policy.js';

describe('shouldSeedDemoData (G-705)', () => {
  it('never seeds in production unless explicitly forced', () => {
    expect(shouldSeedDemoData({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldSeedDemoData({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toBe(
      false,
    );
    // PRC-L207: SEED_DEMO_DATA=1 alone is ignored in production.
    expect(shouldSeedDemoData({ NODE_ENV: 'production', SEED_DEMO_DATA: '1' })).toBe(false);
    expect(shouldSeedDemoData({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true' })).toBe(false);
    expect(
      shouldSeedDemoData({
        NODE_ENV: 'production',
        SEED_DEMO_DATA: '1',
        ALLOW_DEMO_SEED_IN_PRODUCTION: '1',
      }),
    ).toBe(true);
  });

  it('seeds in dev only when no database is configured', () => {
    expect(shouldSeedDemoData({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldSeedDemoData({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' })).toBe(
      false,
    );
  });

  it('honours explicit opt-out', () => {
    expect(shouldSeedDemoData({ NODE_ENV: 'test', SEED_DEMO_DATA: '0' })).toBe(false);
    expect(shouldSeedDemoData({ NODE_ENV: 'test', SEED_DEMO_DATA: 'false' })).toBe(false);
  });

  it('SEED_DEMO_DATA=1 still forces seeding outside production', () => {
    expect(shouldSeedDemoData({ NODE_ENV: 'test', SEED_DEMO_DATA: '1' })).toBe(true);
    expect(
      shouldSeedDemoData({ NODE_ENV: 'development', SEED_DEMO_DATA: '1', DATABASE_URL: 'x' }),
    ).toBe(true);
  });

  it('PRC-L207: in-memory workflow UI store obeys the seed policy', async () => {
    const { createWorkflowUiStore } = await import('./workflow-ui-pg-store.js');
    const { WORKFLOW_DEMO_TENANT_ID } = await import('./workflow-ui-seed.js');
    const previous = process.env['SEED_DEMO_DATA'];
    try {
      process.env['SEED_DEMO_DATA'] = '0';
      const empty = createWorkflowUiStore(undefined, { forceMemory: true });
      expect(await empty.listDefinitions(WORKFLOW_DEMO_TENANT_ID)).toEqual([]);
      process.env['SEED_DEMO_DATA'] = '1';
      const seeded = createWorkflowUiStore(undefined, { forceMemory: true });
      expect((await seeded.listDefinitions(WORKFLOW_DEMO_TENANT_ID)).length).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env['SEED_DEMO_DATA'];
      else process.env['SEED_DEMO_DATA'] = previous;
    }
  });
});
