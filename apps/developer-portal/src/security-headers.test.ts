import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/no-relative-packages -- config lives at the app root
import nextConfig from '../next.config.mjs';
import { buildSecurityHeaders } from '../security-headers.mjs';

describe('security headers (PRC-H009)', () => {
  it('next.config serves the headers on every route', async () => {
    const rules = await (
      nextConfig as {
        headers: () => Promise<Array<{ source: string; headers: Array<{ key: string }> }>>;
      }
    ).headers();
    const all = rules.find((r) => r.source === '/:path*');
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key);
    for (const key of [
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('forbids framing and plugins, and drops eval + adds HSTS in production', () => {
    const prod = buildSecurityHeaders({ NODE_ENV: 'production' });
    const csp = prod.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(prod.some((h) => h.key === 'Strict-Transport-Security')).toBe(true);
    const dev = buildSecurityHeaders({ NODE_ENV: 'development' });
    expect(dev.some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
  });
});
