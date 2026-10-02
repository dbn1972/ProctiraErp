/**
 * PRC-L121 — academics schema readiness must gate startup, not be fire-and-forget.
 */
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAcademicsDeps } from './academics-factory.js';
import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { institutionPlugin } from './institution-plugin.js';

describe('PRC-L121 academics schema readiness', () => {
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('fails plugin registration when the readiness check rejects (missing table)', async () => {
    const base = createAcademicsDeps();
    const app = Fastify();
    const missing = new Error('institution infrastructure schema is not ready: missing table');
    await expect(
      app
        .register(institutionPlugin, {
          repository: new InMemoryInstitutionRepository(),
          academics: { ...base, ready: () => Promise.reject(missing) },
        })
        .ready(),
    ).rejects.toThrow(/schema is not ready/);
    await app.close().catch(() => undefined);
  });

  it('registers normally when the readiness check resolves', async () => {
    const base = createAcademicsDeps();
    const ready = vi.fn(async () => undefined);
    const app = Fastify();
    await app
      .register(institutionPlugin, {
        repository: new InMemoryInstitutionRepository(),
        academics: { ...base, ready },
      })
      .ready();
    expect(ready).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('Postgres composition exposes an awaited readiness gate', () => {
    const deps = createAcademicsDeps({
      databaseUrl: 'postgres://user:pass@127.0.0.1:1/none',
      prisma: {} as never,
    });
    expect(deps.persistence).toBe('prisma+pg');
    expect(typeof deps.ready).toBe('function');
  });
});
