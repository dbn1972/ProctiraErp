/**
 * W1-SEC-12 — custom-field factory persistence policy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetPersistenceWarnings } from '@proctira/database';

import {
  createCustomFieldRepositories,
  isPgCustomFieldEnabled,
  resetSharedCustomFieldRepositoriesForTests,
} from './create-custom-field-repositories.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';

describe('createCustomFieldRepositories (W1-SEC-12)', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRequire = process.env.REQUIRE_DATABASE;

  beforeEach(() => {
    resetPersistenceWarnings();
    resetSharedCustomFieldRepositoriesForTests();
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRequire === undefined) delete process.env.REQUIRE_DATABASE;
    else process.env.REQUIRE_DATABASE = prevRequire;
    resetSharedCustomFieldRepositoriesForTests();
    resetPersistenceWarnings();
  });

  it('returns shared in-memory repos when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REQUIRE_DATABASE;
    process.env.NODE_ENV = 'test';
    expect(isPgCustomFieldEnabled()).toBe(false);
    const a = createCustomFieldRepositories();
    const b = createCustomFieldRepositories();
    expect(a).toBe(b);
    expect(a.definitionRepository).toBeInstanceOf(InMemoryCustomFieldDefinitionRepository);
    expect(a.valueRepository).toBeInstanceOf(InMemoryCustomFieldValueRepository);
  });

  it('fails closed when DATABASE_URL is set (no durable schema yet)', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/proctira_sec12_custom_field';
    process.env.NODE_ENV = 'test';
    expect(isPgCustomFieldEnabled()).toBe(true);
    expect(() => createCustomFieldRepositories()).toThrow(
      /DATABASE_URL is set but Postgres repository is unavailable/,
    );
  });

  it('fails closed in production without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REQUIRE_DATABASE;
    process.env.NODE_ENV = 'production';
    expect(() => createCustomFieldRepositories()).toThrow(/NODE_ENV=production/);
  });
});
