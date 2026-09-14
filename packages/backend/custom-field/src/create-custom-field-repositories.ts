/**
 * Custom-field repository factory — W1-SEC-12 / P0-05.
 *
 * Durable Postgres schema for definitions/values is not shipped yet. When
 * DATABASE_URL is set we fail closed (no silent in-memory, no fake Pg).
 * Otherwise assertInMemoryFallbackAllowed then return shared in-memory stores
 * (dev/unit only; never production).
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import type {
  CustomFieldDefinitionRepository,
  CustomFieldValueRepository,
} from './custom-field-repository.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';

export interface CustomFieldRepositories {
  definitionRepository: CustomFieldDefinitionRepository;
  valueRepository: CustomFieldValueRepository;
}

let sharedMemory: CustomFieldRepositories | null = null;

/** True when operators configured Postgres (durable path required). */
export function isPgCustomFieldEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

/** Test helper — clear shared in-memory custom-field stores. */
export function resetSharedCustomFieldRepositoriesForTests(): void {
  sharedMemory = null;
}

/**
 * Resolve custom-field repositories for gateway mounts.
 *
 * - DATABASE_URL set → refuse (no Pg schema yet; honesty over fake Pg)
 * - else → in-memory after {@link assertInMemoryFallbackAllowed}
 */
export function createCustomFieldRepositories(): CustomFieldRepositories {
  if (isPgCustomFieldEnabled()) {
    // No durable custom-field tables yet — do not greenwash with memory or a stub Pg.
    assertPostgresRepositoryAvailable('custom-field', null);
  }
  assertInMemoryFallbackAllowed('custom-field');
  if (!sharedMemory) {
    sharedMemory = {
      definitionRepository: new InMemoryCustomFieldDefinitionRepository(),
      valueRepository: new InMemoryCustomFieldValueRepository(),
    };
  }
  return sharedMemory;
}
