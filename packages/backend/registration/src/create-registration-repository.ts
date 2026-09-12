/**
 * Registration repository / CRM store factories — Postgres when DATABASE_URL
 * is set, else in-memory (subject to the shared fallback policy).
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import { InMemoryAdmissionsCrmStore, type AdmissionsCrmStore } from './admissions-crm-store.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { PgAdmissionsCrmStore } from './pg-admissions-crm-store.js';
import {
  getSharedRegistrationPool,
  PgRegistrationRepository,
} from './pg-registration-repository.js';
import { PgAdmissionsPipelineStore } from './pipeline/pg-pipeline-store.js';
import {
  InMemoryAdmissionsPipelineStore,
  type AdmissionsPipelineStore,
} from './pipeline/pipeline-store.js';
import type { RegistrationRepository } from './registration-repository.js';

export function isPgRegistrationEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createRegistrationRepository(): RegistrationRepository {
  if (isPgRegistrationEnabled()) {
    const pool = getSharedRegistrationPool();
    assertPostgresRepositoryAvailable('registration', pool);
    return new PgRegistrationRepository(pool);
  }
  assertInMemoryFallbackAllowed('registration');
  return new InMemoryRegistrationRepository();
}

/** Waitlist / interview CRM store on db/sql/014 when Postgres is configured (G-717). */
export function createAdmissionsCrmStore(): AdmissionsCrmStore {
  if (isPgRegistrationEnabled()) {
    const pool = getSharedRegistrationPool();
    assertPostgresRepositoryAvailable('registration-crm', pool);
    return new PgAdmissionsCrmStore(pool);
  }
  assertInMemoryFallbackAllowed('registration-crm');
  return new InMemoryAdmissionsCrmStore();
}

/** Enquiry / merit / seat / offer store on db/sql/034 when Postgres is configured (G-906). */
export function createAdmissionsPipelineStore(): AdmissionsPipelineStore {
  if (isPgRegistrationEnabled()) {
    const pool = getSharedRegistrationPool();
    assertPostgresRepositoryAvailable('registration-pipeline', pool);
    return new PgAdmissionsPipelineStore(pool);
  }
  assertInMemoryFallbackAllowed('registration-pipeline');
  return new InMemoryAdmissionsPipelineStore();
}
