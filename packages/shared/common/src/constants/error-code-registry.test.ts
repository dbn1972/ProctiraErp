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
      { setHeader: (n, v) => { got[n] = v; } },
      { deprecation: 'true', sunset: 'Wed, 01 Jul 2026 00:00:00 GMT', note: 'migrate' },
    );
    expect(got.Deprecation).toBe('true');
    expect(got.Sunset).toContain('Jul');
    expect(got['X-API-Deprecation-Note']).toBe('migrate');
  });
});
