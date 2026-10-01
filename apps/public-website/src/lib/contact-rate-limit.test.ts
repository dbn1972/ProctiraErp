import { describe, expect, it, beforeEach } from 'vitest';

import {
  allowContactRequest,
  readTrustedProxyHops,
  resetContactRateLimitForTests,
  resolveClientKey,
} from './contact-rate-limit';

describe('allowContactRequest', () => {
  beforeEach(() => {
    resetContactRateLimitForTests();
  });

  it('allows the first requests in a window', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(allowContactRequest('10.0.0.1', 1_000)).toBe(true);
    }
  });

  it('blocks after the window budget is exhausted', () => {
    for (let i = 0; i < 5; i += 1) {
      allowContactRequest('10.0.0.2', 1_000);
    }
    expect(allowContactRequest('10.0.0.2', 1_000)).toBe(false);
  });

  it('resets after the window elapses', () => {
    for (let i = 0; i < 5; i += 1) {
      allowContactRequest('10.0.0.3', 1_000);
    }
    expect(allowContactRequest('10.0.0.3', 1_000 + 60_001)).toBe(true);
  });
});
describe('resolveClientKey (trusted proxy hops)', () => {
  beforeEach(() => {
    resetContactRateLimitForTests();
  });
  it('ignores client-prepended XFF entries behind one trusted proxy', () => {
    const a = resolveClientKey(new Headers({ 'x-forwarded-for': 'spoof-1, 203.0.113.9' }), 1);
    const b = resolveClientKey(new Headers({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }), 1);
    expect(a).toBe('203.0.113.9');
    expect(b).toBe('203.0.113.9');
  });
  it('varying XFF does not reset the limit behind trusted-proxy config', () => {
    for (let i = 0; i < 5; i += 1) {
      const key = resolveClientKey(
        new Headers({ 'x-forwarded-for': `10.9.9.${i}, 203.0.113.50` }),
        1,
      );
      expect(allowContactRequest(key, 1_000)).toBe(true);
    }
    const key = resolveClientKey(new Headers({ 'x-forwarded-for': 'fresh, 203.0.113.50' }), 1);
    expect(allowContactRequest(key, 1_000)).toBe(false);
  });
  it('honours two trusted hops (CDN + ingress)', () => {
    const h = new Headers({ 'x-forwarded-for': 'spoof, 203.0.113.9, 10.0.0.2' });
    expect(resolveClientKey(h, 2)).toBe('203.0.113.9');
  });
  it('uses X-Real-IP when hops=0 or XFF absent, else "unknown"', () => {
    const h = new Headers({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '203.0.113.1' });
    expect(resolveClientKey(h, 0)).toBe('203.0.113.1');
    expect(resolveClientKey(new Headers({ 'x-real-ip': '203.0.113.2' }), 1)).toBe('203.0.113.2');
    expect(resolveClientKey(new Headers(), 1)).toBe('unknown');
  });
  it('parses TRUSTED_PROXY_HOPS with a safe default', () => {
    expect(readTrustedProxyHops({})).toBe(1);
    expect(readTrustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2);
    expect(readTrustedProxyHops({ TRUSTED_PROXY_HOPS: '0' })).toBe(0);
    expect(readTrustedProxyHops({ TRUSTED_PROXY_HOPS: 'nope' })).toBe(1);
  });
});
