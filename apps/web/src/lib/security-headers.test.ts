/**
 * @vitest-environment node
 *
 * PRC-H009 / NEW-g1a_web-001 — apps/web must send a strict security-header
 * baseline (CSP with frame-ancestors 'none', X-Frame-Options DENY, nosniff,
 * Referrer-Policy, HSTS in prod) on every route. Before this fix apps/web sent
 * none of these; this test fails if the baseline regresses.
 */
import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from '../../security-headers.mjs';

function headerMap(headers: Array<{ key: string; value: string }>) {
  return Object.fromEntries(headers.map((h) => [h.key, h.value]));
}

function cspDirectives(csp: string | undefined): Map<string, string> {
  if (!csp) throw new Error('Content-Security-Policy header is missing');
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(/\s+/);
        return [name ?? '', rest.join(' ')] as const;
      }),
  );
}

describe('apps/web security headers (PRC-H009)', () => {
  it('sets the clickjacking + content-type + referrer baseline on every route', () => {
    const map = headerMap(buildSecurityHeaders({ NODE_ENV: 'production' }));
    expect(map['X-Frame-Options']).toBe('DENY');
    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Content-Security-Policy']).toBeTruthy();
  });

  it('CSP forbids being framed and disallows plugins/base hijack', () => {
    const map = headerMap(buildSecurityHeaders({ NODE_ENV: 'production' }));
    const csp = cspDirectives(map['Content-Security-Policy']);
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('default-src')).toBe("'self'");
  });

  it('CSP allows the inline theme <style>/<script> the layout injects (nonce-less)', () => {
    const csp = cspDirectives(
      headerMap(buildSecurityHeaders({ NODE_ENV: 'production' }))['Content-Security-Policy'],
    );
    expect(csp.get('style-src')).toContain("'unsafe-inline'");
    expect(csp.get('script-src')).toContain("'self'");
    expect(csp.get('script-src')).toContain("'unsafe-inline'");
    // Self-hosted next/font + tenant logos must not be blocked.
    expect(csp.get('font-src')).toContain("'self'");
    expect(csp.get('img-src')).toContain("'self'");
    expect(csp.get('connect-src')).toContain("'self'");
  });

  it('enables HSTS only in production', () => {
    const prod = headerMap(buildSecurityHeaders({ NODE_ENV: 'production' }));
    expect(prod['Strict-Transport-Security']).toMatch(/max-age=\d+/);

    const dev = headerMap(buildSecurityHeaders({ NODE_ENV: 'development' }));
    expect(dev['Strict-Transport-Security']).toBeUndefined();
  });

  it('allows eval only outside production (dev tooling)', () => {
    const prod = cspDirectives(
      headerMap(buildSecurityHeaders({ NODE_ENV: 'production' }))['Content-Security-Policy'],
    );
    expect(prod.get('script-src')).not.toContain("'unsafe-eval'");

    const dev = cspDirectives(
      headerMap(buildSecurityHeaders({ NODE_ENV: 'development' }))['Content-Security-Policy'],
    );
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
  });
});
