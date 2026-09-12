/**
 * P0-10 — ETL createPipelineRepository persistence honesty.
 *
 * DATABASE_URL set  → PgPipelineRepository (never silent InMemory)
 * DATABASE_URL unset → InMemory after assertInMemoryFallbackAllowed
 */
import {
  assertPostgresRepositoryAvailable,
  closeSharedPgPools,
  resetPersistenceWarnings,
} from '@proctira/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { createPipelineRepository, PgPipelineRepository } from './pg-pipeline-repository.js';

describe('createPipelineRepository (P0-10)', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRequire = process.env.REQUIRE_DATABASE;
  const prevAllow = process.env.ALLOW_IN_MEMORY_IN_PRODUCTION;

  beforeEach(() => {
    resetPersistenceWarnings();
    delete process.env.REQUIRE_DATABASE;
    delete process.env.ALLOW_IN_MEMORY_IN_PRODUCTION;
  });

  afterEach(async () => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRequire === undefined) delete process.env.REQUIRE_DATABASE;
    else process.env.REQUIRE_DATABASE = prevRequire;
    if (prevAllow === undefined) delete process.env.ALLOW_IN_MEMORY_IN_PRODUCTION;
    else process.env.ALLOW_IN_MEMORY_IN_PRODUCTION = prevAllow;
    resetPersistenceWarnings();
    await closeSharedPgPools();
  });

  it('uses InMemoryPipelineRepository when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'test';
    const repo = createPipelineRepository();
    expect(repo).toBeInstanceOf(InMemoryPipelineRepository);
  });

  it('uses PgPipelineRepository when DATABASE_URL is set (no silent memory)', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/proctira_p0_10_etl';
    const repo = createPipelineRepository();
    expect(repo).toBeInstanceOf(PgPipelineRepository);
    expect(repo).not.toBeInstanceOf(InMemoryPipelineRepository);
  });

  it('fails closed when Postgres is required but unavailable', () => {
    expect(() => assertPostgresRepositoryAvailable('etl', null)).toThrow(
      /DATABASE_URL is set but Postgres repository is unavailable/,
    );
  });
});
