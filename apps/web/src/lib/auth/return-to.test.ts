import { describe, expect, it } from 'vitest';

import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('allows same-origin relative paths', () => {
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('/students')).toBe('/students');
    expect(sanitizeReturnTo('/students?tab=1')).toBe('/students?tab=1');
    expect(sanitizeReturnTo('/a/b#section')).toBe('/a/b#section');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(sanitizeReturnTo('https://evil.example/phish')).toBe('/');
    expect(sanitizeReturnTo('http://evil.example')).toBe('/');
    expect(sanitizeReturnTo('//evil.example/phish')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
  });

  it('rejects empty / nullish input with fallback', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
    expect(sanitizeReturnTo('   ')).toBe('/');
    expect(sanitizeReturnTo(null, '/dashboard')).toBe('/dashboard');
  });

  it('rejects encoded protocol-relative tricks', () => {
    expect(sanitizeReturnTo('/%2f%2fevil.example')).toBe('/');
    expect(sanitizeReturnTo('/%5cevil.example')).toBe('/');
  });
});
