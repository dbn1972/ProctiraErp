import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

describe('next.config security headers', () => {
  it('applies CSP, HSTS, frame, nosniff, referrer and permissions headers to all routes', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const rules = await nextConfig.headers!();
    const all = rules.find((r: { source: string }) => r.source === '/:path*');
    const map = new Map(
      (all?.headers ?? []).map((h: { key: string; value: string }) => [h.key, h.value]),
    );
    expect(map.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(map.get('Content-Security-Policy')).toContain("object-src 'none'");
    expect(map.get('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    expect(map.get('X-Frame-Options')).toBe('DENY');
    expect(map.get('X-Content-Type-Options')).toBe('nosniff');
    expect(map.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(map.get('Permissions-Policy')).toContain('camera=()');
  });
});
