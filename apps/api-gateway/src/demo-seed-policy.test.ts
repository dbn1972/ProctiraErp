import { describe, expect, it } from 'vitest';

import { shouldSeedDemoData } from './demo-seed-policy.js';

describe('shouldSeedDemoData (G-705)', () => {
  it('never seeds in production unless explicitly forced', () => {
    expect(shouldSeedDemoData({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldSeedDemoData({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toBe(
      false,
    );
    expect(shouldSeedDemoData({ NODE_ENV: 'production', SEED_DEMO_DATA: '1' })).toBe(true);
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
});
