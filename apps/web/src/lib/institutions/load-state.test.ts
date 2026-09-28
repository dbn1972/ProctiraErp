import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyInstitutionLoadError, coordinateMapPreview } from './load-state';

describe('classifyInstitutionLoadError', () => {
  it('treats a dead gateway as an error, not a missing school or an active one', () => {
    expect(classifyInstitutionLoadError({ statusCode: 0 })).toBe('gateway-down');
    expect(classifyInstitutionLoadError({ statusCode: 404 })).toBe('not-found');
    expect(classifyInstitutionLoadError({ statusCode: 500 })).toBe('unexpected');
  });
});

describe('coordinateMapPreview', () => {
  it('links decimal degrees and rejects empty or out-of-range values', () => {
    expect(coordinateMapPreview('28.6072', '77.2965')).toContain('mlat=28.6072');
    expect(coordinateMapPreview('', '77')).toBeNull();
    expect(coordinateMapPreview('91', '0')).toBeNull();
  });
});

describe('institution request cache', () => {
  it('wraps the institution and overview reads in React cache for one request', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'request-cache.ts'),
      'utf8',
    );
    expect(source).toMatch(/export const getCachedInstitution = cache\(getInstitution\)/);
    expect(source).toMatch(
      /export const getCachedInstitutionOverview = cache\(getInstitutionOverview\)/,
    );
  });
});
