import { afterEach, describe, expect, it } from 'vitest';

import { runReadinessProbe } from './readiness-probe.js';

describe('runReadinessProbe (W3-C2)', () => {
  afterEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    delete process.env['NODE_ENV'];
    delete process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'];
  });

  it('reports in-memory when DATABASE_URL is unset in test', async () => {
    const result = await runReadinessProbe({ env: { NODE_ENV: 'test' } });
    expect(result.ready).toBe(true);
    expect(result.dependencies.database).toBe('in-memory');
  });

  it('fails closed when DATABASE_URL is set but probe fails', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://bad:5432/x' },
      probeDatabase: async () => ({ ok: false, message: 'Connection refused', latencyMs: 12 }),
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('down');
    expect(result.message).toMatch(/Connection refused/);
  });

  it('passes when DATABASE_URL is set and probe succeeds', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://good:5432/x' },
      probeDatabase: async () => ({ ok: true, latencyMs: 4 }),
    });
    expect(result.ready).toBe(true);
    expect(result.dependencies.database).toBe('up');
  });

  it('fails closed when REQUIRE_DATABASE=1 but DATABASE_URL is missing', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'test', REQUIRE_DATABASE: '1' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
  });

  it('fails closed in production without DATABASE_URL', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
  });

  it('W1-SEC-12: fails closed in production even when ALLOW_IN_MEMORY_IN_PRODUCTION=1', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', ALLOW_IN_MEMORY_IN_PRODUCTION: '1' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
    expect(result.message).toMatch(/ALLOW_IN_MEMORY_IN_PRODUCTION is disabled/);
  });
});
