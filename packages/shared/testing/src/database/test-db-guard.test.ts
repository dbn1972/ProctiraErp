/**
 * PRC-L585 — cleanTables / assertTestDatabase must fail closed off a test DB.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { assertTestDatabase } from './test-db.js';

const prevNodeEnv = process.env['NODE_ENV'];
const prevUrl = process.env['TEST_DATABASE_URL'];

afterEach(() => {
  process.env['NODE_ENV'] = prevNodeEnv;
  if (prevUrl === undefined) delete process.env['TEST_DATABASE_URL'];
  else process.env['TEST_DATABASE_URL'] = prevUrl;
});

describe('assertTestDatabase (PRC-L585)', () => {
  it('refuses in production regardless of URL', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => assertTestDatabase('postgres://x/proctira_test')).toThrow(/production/);
  });

  it('refuses when no connection URL is resolvable', () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['TEST_DATABASE_URL'];
    expect(() => assertTestDatabase(undefined)).toThrow(/no TEST_DATABASE_URL/);
  });

  it('refuses a connection that does not look like a test DB', () => {
    process.env['NODE_ENV'] = 'test';
    expect(() => assertTestDatabase('postgres://localhost/proctira_prod')).toThrow(/test database/);
  });

  it('allows an explicit test database URL', () => {
    process.env['NODE_ENV'] = 'test';
    expect(() => assertTestDatabase('postgres://localhost/proctira_test')).not.toThrow();
  });
});
