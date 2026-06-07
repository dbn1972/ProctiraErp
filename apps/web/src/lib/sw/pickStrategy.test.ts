/**
 * pickStrategy() tests — Task 54.1, Requirements 38.1, 38.4
 *
 * Covers every branch of the strategy classifier:
 *
 *   • Mutating verbs (POST/PUT/PATCH/DELETE) always `bypass` so that
 *     the Sync_Queue (task 54.2) is the single source of truth for
 *     offline write handling.
 *   • Read-heavy API prefixes (dashboards, students, institutions,
 *     staff) resolve to `swr`.
 *   • Auth + tenant branding GETs resolve to `network-first`.
 *   • `/_next/static/*`, `/static/*`, and known asset extensions
 *     resolve to `cache-first`.
 *   • Everything else (page navigations, uncategorised endpoints)
 *     resolves to `network-first`.
 *   • Defensive paths (lowercase verbs, query strings, unparseable
 *     URLs) keep classifying correctly.
 */

import { describe, it, expect } from 'vitest';

import { pickStrategy } from './pickStrategy';

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
    // Even an asset URL must bypass when the verb mutates.
    expect(pickStrategy('PUT', '/_next/static/chunk.js')).toBe('bypass');
  });
});

describe('pickStrategy — read-heavy GETs use stale-while-revalidate', () => {
  const swrUrls = [
    '/api/v1/dashboards/country',
    '/api/v1/dashboards/state/123',
    '/api/v1/students',
    '/api/v1/students?page=2',
    '/api/v1/students/42',
    '/api/v1/institutions',
    '/api/v1/institutions/abc/staff',
    '/api/v1/staff',
    '/api/v1/staff/9?include=schedule',
  ];

  for (const url of swrUrls) {
    it(`returns "swr" for GET ${url}`, () => {
      expect(pickStrategy('GET', url)).toBe('swr');
    });
  }

  it('honours absolute URLs against the SWR matchers', () => {
    expect(pickStrategy('GET', 'https://api.example.test/api/v1/students')).toBe(
      'swr',
    );
  });
});

describe('pickStrategy — write-sensitive / freshness-critical GETs use network-first', () => {
  it('classifies auth endpoints as network-first', () => {
    expect(pickStrategy('GET', '/api/v1/auth/session')).toBe('network-first');
    expect(pickStrategy('GET', '/api/v1/auth/refresh')).toBe('network-first');
  });

  it('classifies tenant branding as network-first', () => {
    expect(pickStrategy('GET', '/api/v1/tenant/branding')).toBe('network-first');
    expect(pickStrategy('GET', '/api/v1/tenant/branding?v=2')).toBe(
      'network-first',
    );
  });
});

describe('pickStrategy — static assets use cache-first', () => {
  it('caches Next.js content-hashed bundles', () => {
    expect(pickStrategy('GET', '/_next/static/chunks/main-abc123.js')).toBe(
      'cache-first',
    );
    expect(pickStrategy('GET', '/_next/static/css/app.css')).toBe('cache-first');
  });

  it('caches /static/* public assets', () => {
    expect(pickStrategy('GET', '/static/illustrations/empty.svg')).toBe(
      'cache-first',
    );
  });

  it('caches fonts by extension', () => {
    expect(pickStrategy('GET', '/fonts/Inter.woff2')).toBe('cache-first');
    expect(pickStrategy('GET', '/fonts/Inter.woff')).toBe('cache-first');
    expect(pickStrategy('GET', '/fonts/Custom.ttf')).toBe('cache-first');
  });

  it('caches images by extension', () => {
    expect(pickStrategy('GET', '/brand/logo.svg')).toBe('cache-first');
    expect(pickStrategy('GET', '/brand/logo.PNG')).toBe('cache-first');
    expect(pickStrategy('GET', '/avatars/user.jpeg')).toBe('cache-first');
    expect(pickStrategy('GET', '/favicon.ico')).toBe('cache-first');
  });
});

describe('pickStrategy — default behaviour', () => {
  it('falls back to network-first for HTML navigations', () => {
    expect(pickStrategy('GET', '/')).toBe('network-first');
    expect(pickStrategy('GET', '/auth/signin')).toBe('network-first');
    expect(pickStrategy('GET', '/app/dashboard')).toBe('network-first');
  });

  it('falls back to network-first for uncategorised API endpoints', () => {
    expect(pickStrategy('GET', '/api/v1/reports/summary')).toBe('network-first');
    expect(pickStrategy('GET', '/api/v1/health')).toBe('network-first');
  });

  it('returns bypass for unparseable URLs as a defensive fallback', () => {
    // `URL` will throw on a bare empty input — but since the helper
    // accepts a base, the realistic "unparseable" case is a malformed
    // string that the runtime cannot resolve. We assert the contract:
    // when input is empty we still return a valid Strategy.
    expect(pickStrategy('GET', '')).toBe('bypass');
  });
});
