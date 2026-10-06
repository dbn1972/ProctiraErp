/**
 * PRC-M003: the console sends anti-framing, HSTS and a nonce CSP, and no longer leaks the
 * X-Platform-Admin marker on responses.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config.mjs';
import { middleware } from '../middleware';

import { STATIC_SECURITY_HEADERS, buildContentSecurityPolicy } from './security-headers';

describe('security headers', () => {
  it('next.config headers() applies the static set to every path', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }]);
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'X-Frame-Options',
        'Strict-Transport-Security',
        'Referrer-Policy',
        'Permissions-Policy',
      ]),
    );
  });

  it('builds a nonce CSP that forbids framing and inline scripts', () => {
    const csp = buildContentSecurityPolicy('abc123');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
  });

  it.each(['/login', '/tenants'])('middleware sets a fresh nonce CSP on %s', (path) => {
    const a = middleware(new NextRequest(`https://admin.example${path}`));
    const b = middleware(new NextRequest(`https://admin.example${path}`));
    const cspA = a.headers.get('Content-Security-Policy');
    expect(cspA).toMatch(/frame-ancestors 'none'/);
    expect(cspA).not.toEqual(b.headers.get('Content-Security-Policy'));
    expect(a.headers.get('X-Platform-Admin')).toBeNull();
  });
});
