import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, getSiteUrl, isIndexable } from './seo.js';
import robots from '../app/robots.js';
import sitemap from '../app/sitemap.js';

describe('seo env helpers', () => {
  it('derives the canonical origin from NEXT_PUBLIC_SITE_URL', () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://preview.proctira.dev/' })).toBe(
      'https://preview.proctira.dev',
    );
    expect(getSiteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'javascript:alert(1)' })).toBe(DEFAULT_SITE_URL);
  });

  it('marks preview/staging and non-production NODE_ENV builds as noindex', () => {
    expect(isIndexable({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_ENV: 'preview' })).toBe(false);
    expect(isIndexable({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_ENV: 'staging' })).toBe(false);
    expect(isIndexable({ NODE_ENV: 'development' })).toBe(false);
    expect(isIndexable({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_ENV: 'production' })).toBe(true);
    expect(isIndexable({ NODE_ENV: 'production' })).toBe(true);
  });
});

describe('robots.txt / sitemap.xml', () => {
  it('disallows everything on non-indexable builds (vitest NODE_ENV=test)', () => {
    const r = robots();
    expect(r.rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(r.sitemap).toBeUndefined();
  });

  it('lists canonical absolute URLs in the sitemap', () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(5);
    for (const e of entries) {
      expect(e.url.startsWith(getSiteUrl())).toBe(true);
    }
    expect(entries.map((e) => e.url)).toContain(`${getSiteUrl()}/privacy`);
  });
});
