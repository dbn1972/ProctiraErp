/**
 * A1 — Factory default for admissions pipeline store.
 * Ensures mounts that omit `pipelineStore` still pick PG when DATABASE_URL is set
 * (via createAdmissionsPipelineStore), and in-memory only when fallback is allowed.
 */
import { describe, expect, it } from 'vitest';

import {
  createAdmissionsPipelineStore,
  isPgRegistrationEnabled,
} from './create-registration-repository.js';
import { PgAdmissionsPipelineStore } from './pipeline/pg-pipeline-store.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline/pipeline-store.js';

describe('createAdmissionsPipelineStore', () => {
  it('falls back to in-memory when DATABASE_URL is unset (assertInMemoryFallbackAllowed)', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(createAdmissionsPipelineStore()).toBeInstanceOf(InMemoryAdmissionsPipelineStore);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it.skipIf(!isPgRegistrationEnabled())('returns the Pg store when DATABASE_URL is set', () => {
    expect(createAdmissionsPipelineStore()).toBeInstanceOf(PgAdmissionsPipelineStore);
  });
});
