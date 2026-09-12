/**
 * P0-05 — factory fail-closed integration (gateway wiring surface).
 *
 * Proves production-capable factories refuse silent in-memory when
 * DATABASE_URL is set, and still allow memory when it is unset (unit-test path).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAttendanceRepository } from '@proctira/backend-attendance';
import { createPipelineRepository } from '@proctira/backend-etl';
import {
  createFeesRepository,
  InMemoryFeesRepository,
  isPgFeesEnabled,
  PgFeesRepository,
  resetSharedFeesRepositoryForTests,
} from '@proctira/backend-fees';
import { createHealthRepository } from '@proctira/backend-health';
import { createNotificationStack } from '@proctira/backend-notification';
import {
  createAdmissionsPipelineStore,
  createRegistrationRepository,
  InMemoryAdmissionsPipelineStore,
  InMemoryRegistrationRepository,
  isPgRegistrationEnabled,
} from '@proctira/backend-registration';
import { assertInMemoryFallbackAllowed, resetPersistenceWarnings } from '@proctira/database';

describe('P0-05 kill memory fallback (factories)', () => {
  const prevUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    resetPersistenceWarnings();
    resetSharedFeesRepositoryForTests();
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    resetSharedFeesRepositoryForTests();
    resetPersistenceWarnings();
  });

  it('allows in-memory when DATABASE_URL is unset (unit-test path)', () => {
    delete process.env.DATABASE_URL;
    expect(isPgFeesEnabled()).toBe(false);
    expect(createFeesRepository()).toBeInstanceOf(InMemoryFeesRepository);
    expect(createRegistrationRepository()).toBeInstanceOf(InMemoryRegistrationRepository);
    expect(createAdmissionsPipelineStore()).toBeInstanceOf(InMemoryAdmissionsPipelineStore);
    expect(createNotificationStack().persistence).toBe('memory');
    expect(createPipelineRepository().constructor.name).toMatch(/InMemory/);
  });

  it('uses Postgres constructors when DATABASE_URL is set (no silent memory)', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/proctira_p0_05_fail_closed';
    expect(isPgFeesEnabled()).toBe(true);
    expect(isPgRegistrationEnabled()).toBe(true);

    expect(createFeesRepository()).toBeInstanceOf(PgFeesRepository);
    expect(createRegistrationRepository().constructor.name).toMatch(/^Pg/);
    expect(createAdmissionsPipelineStore().constructor.name).toMatch(/^Pg/);
    expect(createNotificationStack().persistence).toBe('postgres');
    expect(createPipelineRepository().constructor.name).toMatch(/^Pg/);
    expect(createAttendanceRepository().constructor.name).toMatch(/Prisma|Pg/);
    // Hybrid still constructed, but PG overlays are required (asserted in factory).
    expect(createHealthRepository().constructor.name).toMatch(/Hybrid/);
  });

  it('assertInMemoryFallbackAllowed throws when DATABASE_URL remains set', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/proctira_p0_05_fail_closed';
    expect(() => assertInMemoryFallbackAllowed('fees')).toThrow(
      /DATABASE_URL is set — refusing in-memory fallback/,
    );
  });
});
