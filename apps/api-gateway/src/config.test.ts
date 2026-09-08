import { describe, expect, it } from 'vitest';

import { DEV_JWT_SECRET, resolveJwtSecret } from './config.js';

describe('resolveJwtSecret (G-703)', () => {
  const strong = 'a'.repeat(48);

  it('falls back to the dev secret outside production', () => {
    expect(resolveJwtSecret('development', undefined)).toBe(DEV_JWT_SECRET);
    expect(resolveJwtSecret('test', '')).toBe(DEV_JWT_SECRET);
    expect(resolveJwtSecret('development', 'custom')).toBe('custom');
  });

  it('throws in production when the secret is missing', () => {
    expect(() => resolveJwtSecret('production', undefined)).toThrow(/JWT_SECRET is required/);
    expect(() => resolveJwtSecret('production', '   ')).toThrow(/JWT_SECRET is required/);
  });

  it('throws in production on placeholder or short secrets', () => {
    expect(() => resolveJwtSecret('production', DEV_JWT_SECRET)).toThrow(/placeholder/);
    expect(() => resolveJwtSecret('production', 'CHANGE_ME_IN_PRODUCTION')).toThrow(/placeholder/);
    expect(() => resolveJwtSecret('production', 'short-secret')).toThrow(/at least 32/);
  });

  it('accepts a strong production secret', () => {
    expect(resolveJwtSecret('production', strong)).toBe(strong);
  });
});
