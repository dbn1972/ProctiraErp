/**
 * pickStrategy() tests — Task 54.1, Requirements 38.1, 38.4; PRC-H026 / PRC-H032
 *
 *   • Mutating verbs always `bypass`.
 *   • Every `/api/*` GET is `bypass` (never cached) except the
 *     non-personal tenant-branding allow-list (`network-first`).
 *   • `/_next/static/*`, `/static/*`, and known asset extensions outside
 *     `/api/` resolve to `cache-first`.
 *   • Navigations / HTML resolve to `network-only` (never cached).
 *   • `isCacheableResponse` refuses no-store / private / Set-Cookie /
 *     Vary: Cookie responses and Authorization-bearing requests.
 */
import { describe, it, expect } from 'vitest';
import { isCacheableResponse, pickStrategy } from './pickStrategy';

describe('pickStrategy — mutating verbs always bypass', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`returns "bypass" for ${method}`, () => {
      expect(pickStrategy(method, '/api/v1/students')).toBe('bypass');
    });
  }
  it('treats lowercase verbs as bypass too', () => {
    expect(pickStrategy('post', '/api/v1/dashboards/country')).toBe('bypass');
    expect(pickStrategy('delete', '/api/v1/students/42')).toBe('bypass');
  });
  it('bypass takes priority over the URL classifier', () => {
    expect(pickStrategy('PUT', '/_next/static/chunk.js')).toBe('bypass');
  });
});

describe('pickStrategy — authenticated API GETs are never cached (PRC-H026 / PRC-H032)', () => {
  const personalUrls = [
    '/api/v1/dashboards/country',
    '/api/v1/students',
    '/api/v1/students?page=2',
    '/api/v1/students/42',
    '/api/students/1/photo',
    '/api/v1/students/1/photo.jpg',
    '/api/v1/institutions',
    '/api/v1/staff',
    '/api/v1/fees/invoices',
    '/api/v1/health/records',
    '/api/v1/auth/session',
    '/api/v1/reports/summary',
    'https://erp.example.test/api/v1/students',
  ];
  for (const url of personalUrls) {
    it(`returns "bypass" for GET ${url}`, () => {
      expect(pickStrategy('GET', url)).toBe('bypass');
    });
  }
  it('keeps the non-personal tenant branding endpoint network-first', () => {
    expect(pickStrategy('GET', '/api/v1/tenant/branding')).toBe('network-first');
    expect(pickStrategy('GET', '/api/v1/tenant/branding?v=2')).toBe('network-first');
  });
});

describe('pickStrategy — static assets use cache-first', () => {
  it('caches Next.js content-hashed bundles', () => {
    expect(pickStrategy('GET', '/_next/static/chunks/main-abc123.js')).toBe('cache-first');
    expect(pickStrategy('GET', '/_next/static/css/app.css')).toBe('cache-first');
  });
  it('caches /static/* public assets', () => {
    expect(pickStrategy('GET', '/static/illustrations/empty.svg')).toBe('cache-first');
  });
  it('caches fonts and images by extension', () => {
    expect(pickStrategy('GET', '/fonts/Inter.woff2')).toBe('cache-first');
    expect(pickStrategy('GET', '/brand/logo.PNG')).toBe('cache-first');
    expect(pickStrategy('GET', '/favicon.ico')).toBe('cache-first');
  });
});

describe('pickStrategy — navigations are network-only', () => {
  it('never caches HTML pages', () => {
    expect(pickStrategy('GET', '/')).toBe('network-only');
    expect(pickStrategy('GET', '/students')).toBe('network-only');
    expect(pickStrategy('GET', '/institutions/abc/schedule')).toBe('network-only');
  });
  it('returns bypass for unparseable URLs as a defensive fallback', () => {
    expect(pickStrategy('GET', '')).toBe('bypass');
  });
});

describe('isCacheableResponse', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('refuses Cache-Control no-store and private', () => {
    expect(isCacheableResponse(h({ 'cache-control': 'no-store' }))).toBe(false);
    expect(isCacheableResponse(h({ 'cache-control': 'private, max-age=60' }))).toBe(false);
    expect(isCacheableResponse(h({ 'cache-control': 'max-age=0, no-store' }))).toBe(false);
  });
  it('refuses Set-Cookie and Vary on credentials', () => {
    expect(isCacheableResponse(h({ 'set-cookie': 'a=b' }))).toBe(false);
    expect(isCacheableResponse(h({ vary: 'Accept, Cookie' }))).toBe(false);
    expect(isCacheableResponse(h({ vary: 'Authorization' }))).toBe(false);
    expect(isCacheableResponse(h({ vary: '*' }))).toBe(false);
  });
  it('refuses responses to Authorization-bearing requests', () => {
    expect(isCacheableResponse(h({}), h({ authorization: 'Bearer x' }))).toBe(false);
  });
  it('allows public cacheable responses', () => {
    expect(isCacheableResponse(h({ 'cache-control': 'public, max-age=31536000' }))).toBe(true);
    expect(isCacheableResponse(h({ vary: 'Accept-Encoding' }))).toBe(true);
  });
});
