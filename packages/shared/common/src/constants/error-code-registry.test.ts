import { describe, expect, it } from 'vitest';

import { ErrorCode } from './index.js';
import {
  applyDeprecationHeaders,
  defaultSunsetDate,
  ERROR_CODE_REGISTRY,
  getErrorCodeDefinition,
} from './error-code-registry.js';

describe('W2-API-02 error-code registry', () => {
  it('covers every ErrorCode enum value', () => {
    const registryCodes = new Set(ERROR_CODE_REGISTRY.map((e) => e.code));
    for (const code of Object.values(ErrorCode)) {
      expect(registryCodes.has(code)).toBe(true);
    }
  });

  it('looks up definitions by code', () => {
    expect(getErrorCodeDefinition('FORBIDDEN')?.httpStatus).toBe(403);
    expect(getErrorCodeDefinition('nope')).toBeUndefined();
  });

  /**
   * V15-19 — enum coverage was the only property asserted, and it was satisfied while the
   * registry omitted 34 of the 41 codes the gateway actually emits. The enum is an internal
   * vocabulary; the wire is the contract. `tools/scripts/check-error-code-registry.mjs`
   * enforces the wire side by re-deriving it from source. These assertions guard the
   * properties a client depends on once a code is listed.
   */
  it('covers the most-emitted rejection the platform produces', () => {
    // 424 emit sites and absent from the registry, so no client could branch on it.
    expect(getErrorCodeDefinition('TENANT_REQUIRED')).toMatchObject({ httpStatus: 400 });
  });

  it('marks the idempotency and dependency codes retryable', () => {
    // The distinction that carries real consequence: a client treating
    // IDEMPOTENCY_REPLAY_PENDING as terminal drops a mutation that may already have applied.
    for (const code of [
      'IDEMPOTENCY_REPLAY_PENDING',
      'IDEMPOTENCY_STORE_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT',
      'CIRCUIT_OPEN',
      'AUDIT_UNAVAILABLE',
    ]) {
      expect(getErrorCodeDefinition(code), code).toMatchObject({ retryable: true });
    }
  });

  it('never marks an authorization answer retryable', () => {
    // Retrying a denial re-runs a request whose answer will not change; advertising it as
    // retryable would invite a client to loop.
    for (const code of [
      'FORBIDDEN',
      'TENANT_SUSPENDED',
      'FEATURE_NOT_ENTITLED',
      'INSTITUTION_OUT_OF_SCOPE',
      'BOARD_FORBIDDEN',
    ]) {
      expect(getErrorCodeDefinition(code), code).toMatchObject({ retryable: false });
    }
  });

  it('has no duplicate codes and a plausible status for every entry', () => {
    const codes = ERROR_CODE_REGISTRY.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of ERROR_CODE_REGISTRY) {
      expect(entry.httpStatus, entry.code).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus, entry.code).toBeLessThan(600);
      expect(entry.description.length, entry.code).toBeGreaterThan(10);
    }
  });
});

describe('W2-API-03 deprecation policy helpers', () => {
  it('defaultSunsetDate is ~180 days ahead', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const sunset = new Date(defaultSunsetDate(from));
    const days = (sunset.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(179);
    expect(days).toBeLessThanOrEqual(181);
  });

  it('applyDeprecationHeaders writes required headers', () => {
    const got: Record<string, string> = {};
    applyDeprecationHeaders(
      {
        setHeader: (n, v) => {
          got[n] = v;
        },
      },
      { deprecation: 'true', sunset: 'Wed, 01 Jul 2026 00:00:00 GMT', note: 'migrate' },
    );
    expect(got.Deprecation).toBe('true');
    expect(got.Sunset).toContain('Jul');
    expect(got['X-API-Deprecation-Note']).toBe('migrate');
  });
});
