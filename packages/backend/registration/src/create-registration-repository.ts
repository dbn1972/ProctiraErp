/**
 * Registration repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import {
  getSharedRegistrationPool,
  PgRegistrationRepository,
} from './pg-registration-repository.js';
import type { RegistrationRepository } from './registration-repository.js';

export function isPgRegistrationEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createRegistrationRepository(): RegistrationRepository {
  if (isPgRegistrationEnabled()) {
    const pool = getSharedRegistrationPool();
    if (pool) return new PgRegistrationRepository(pool);
  }
  assertInMemoryFallbackAllowed('registration');
  return new InMemoryRegistrationRepository();
}
