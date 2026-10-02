import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { assertSafeSourceFilter, assertSafeTableMapping } from './sql-safety.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

const creds = {
  LEGACY_MYSQL_USER: 'legacy_reader',
  LEGACY_MYSQL_PASSWORD: 'legacy-secret',
  TARGET_PG_USER: 'proctira_migrator',
  TARGET_PG_PASSWORD: 'pg-secret',
};

describe('loadConfig credentials (PRC-L376)', () => {
  it('throws when TARGET_PG_PASSWORD is unset in NODE_ENV=production', () => {
    const env: NodeJS.ProcessEnv = { ...creds, NODE_ENV: 'production' };
    delete env.TARGET_PG_PASSWORD;
    expect(() => loadConfig(env)).toThrow(/TARGET_PG_PASSWORD is required in production/);
  });

  it('never defaults users to root/postgres', () => {
    const env: NodeJS.ProcessEnv = { ...creds };
    delete env.TARGET_PG_USER;
    expect(() => loadConfig(env)).toThrow(/TARGET_PG_USER is required/);
    const env2: NodeJS.ProcessEnv = { ...creds };
    delete env2.LEGACY_MYSQL_USER;
    expect(() => loadConfig(env2)).toThrow(/LEGACY_MYSQL_USER is required/);
  });

  it('allows an empty password only for local runs that opt in', () => {
    const local: NodeJS.ProcessEnv = { ...creds, TARGET_PG_PASSWORD: '' };
    expect(() => loadConfig(local)).toThrow(/MIGRATION_ALLOW_EMPTY_PASSWORD/);
    expect(loadConfig({ ...local, MIGRATION_ALLOW_EMPTY_PASSWORD: '1' }).pg.password).toBe('');
    expect(() =>
      loadConfig({ ...local, NODE_ENV: 'production', MIGRATION_ALLOW_EMPTY_PASSWORD: '1' }),
    ).toThrow(/TARGET_PG_PASSWORD is required in production/);
  });

  it('defaults production to verified TLS and refuses silent plaintext', () => {
    const env: NodeJS.ProcessEnv = { ...creds, NODE_ENV: 'production' };
    loadConfig(env);
    expect(env.PGSSLMODE).toBe('verify-full');
    expect(() =>
      loadConfig({ ...creds, NODE_ENV: 'production', TARGET_PG_SSL: 'disable' }),
    ).toThrow(/MIGRATION_ALLOW_INSECURE_PG/);
    expect(() => loadConfig({ ...creds, TARGET_PG_SSL: 'sometimes' })).toThrow(/TARGET_PG_SSL/);
    const explicit: NodeJS.ProcessEnv = {
      ...creds,
      PGSSLMODE: 'require',
      TARGET_PG_SSL: 'disable',
    };
    loadConfig(explicit);
    expect(explicit.PGSSLMODE).toBe('require');
  });
});

describe('sourceFilter allowlist (PRC-L376)', () => {
  it('rejects a sourceFilter containing ";"', () => {
    expect(() => assertSafeSourceFilter('is_student = 1; DROP TABLE students')).toThrow(
      /allowlist/,
    );
  });

  it('rejects unsafe identifiers in a mapping', () => {
    expect(() =>
      assertSafeTableMapping({ ...TABLE_MAPPINGS[0]!, sourceTable: 'users; --' }),
    ).toThrow(/safe SQL identifier/);
  });

  it('accepts every shipped mapping', () => {
    for (const m of TABLE_MAPPINGS) expect(() => assertSafeTableMapping(m)).not.toThrow();
  });
});
