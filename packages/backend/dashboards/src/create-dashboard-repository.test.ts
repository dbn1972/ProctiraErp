/**
 * W1-SEC-12 — dashboard factory persistence policy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetPersistenceWarnings } from '@proctira/database';

import {
  createDashboardRepository,
  isPgDashboardEnabled,
  resetSharedDashboardRepositoryForTests,
} from './create-dashboard-repository.js';
import { InMemoryDashboardRepository } from './in-memory-repository.js';

describe('createDashboardRepository (W1-SEC-12)', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRequire = process.env.REQUIRE_DATABASE;

  beforeEach(() => {
    resetPersistenceWarnings();
    resetSharedDashboardRepositoryForTests();
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRequire === undefined) delete process.env.REQUIRE_DATABASE;
    else process.env.REQUIRE_DATABASE = prevRequire;
    resetSharedDashboardRepositoryForTests();
    resetPersistenceWarnings();
  });

  it('returns shared in-memory repo when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REQUIRE_DATABASE;
    process.env.NODE_ENV = 'test';
    expect(isPgDashboardEnabled()).toBe(false);
    const a = createDashboardRepository();
    const b = createDashboardRepository();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(InMemoryDashboardRepository);
  });

  it('fails closed when DATABASE_URL is set (no durable schema yet)', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/proctira_sec12_dashboards';
    process.env.NODE_ENV = 'test';
    expect(isPgDashboardEnabled()).toBe(true);
    expect(() => createDashboardRepository()).toThrow(
      /DATABASE_URL is set but Postgres repository is unavailable/,
    );
  });

  it('fails closed in production without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REQUIRE_DATABASE;
    process.env.NODE_ENV = 'production';
    expect(() => createDashboardRepository()).toThrow(/NODE_ENV=production/);
  });
});
