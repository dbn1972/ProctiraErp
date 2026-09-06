import { describe, expect, it } from 'vitest';

import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('allows same-origin relative paths', () => {
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('/tenants')).toBe('/tenants');
    expect(sanitizeReturnTo('/tenants?tab=1')).toBe('/tenants?tab=1');
    expect(sanitizeReturnTo('/break-glass/requests#queue')).toBe('/break-glass/requests#queue');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(sanitizeReturnTo('https://evil.example/phish')).toBe('/');
    expect(sanitizeReturnTo('http://evil.example')).toBe('/');
    expect(sanitizeReturnTo('//evil.example/phish')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
  });

  it('falls back for empty / nullish input', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
    expect(sanitizeReturnTo('   ')).toBe('/');
    expect(sanitizeReturnTo(null, '/tenants')).toBe('/tenants');
  });

  it('rejects encoded open-redirect tricks', () => {
    expect(sanitizeReturnTo('/%2f%2fevil.example')).toBe('/');
    expect(sanitizeReturnTo('/%5cevil.example')).toBe('/');
  });
});
