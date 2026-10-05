/**
 * PRC-M066: the SSR tenant-theme cache is keyed by a request-derived slug, so
 * it must stay bounded, never cache malformed slugs, and the middleware must
 * overwrite any client-sent X-Tenant-Slug before server components read it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Headers(),
}));

import {
  clearSSRThemeCache,
  getPublishedTenantTheme,
  normalizeTenantSlug,
  resolveRequestTenantSlug,
  SSR_THEME_CACHE_MAX_ENTRIES,
  ssrThemeCacheSize,
} from './server';
import { withTrustedTenantHeader } from '@/middleware';
import { DEFAULT_BRAND } from '@/providers/BrandConfigProvider';

describe('SSR tenant-theme cache bounds (PRC-M066)', () => {
  beforeEach(() => clearSSRThemeCache());

  it('keeps the cache at or below the cap for 10k distinct tenant ids', async () => {
    const fetcher = vi.fn().mockResolvedValue(DEFAULT_BRAND);
    for (let i = 0; i < 10_000; i += 1) {
      await getPublishedTenantTheme(`tenant-${i}`, fetcher);
    }
    expect(ssrThemeCacheSize()).toBeLessThanOrEqual(SSR_THEME_CACHE_MAX_ENTRIES);
  });

  it('collapses malformed slugs to "default" without fetching them', async () => {
    const fetcher = vi.fn().mockResolvedValue(DEFAULT_BRAND);
    for (const bad of ['../etc', 'a'.repeat(64), 'evil.com', 'tenant id', '%2e%2e']) {
      const theme = await getPublishedTenantTheme(bad, fetcher);
      expect(theme.tenantSlug).toBe('default');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('default');
    expect(normalizeTenantSlug('Acme-1')).toBe('acme-1');
  });
});

describe('middleware tenant header forwarding (PRC-M066)', () => {
  it('overwrites a client-sent X-Tenant-Slug with the Host tenant', async () => {
    const request = new NextRequest('http://acme.proctira.io/dashboard', {
      headers: { 'X-Tenant-Slug': 'victim', 'X-Tenant-ID': 'victim' },
    });
    const forwarded = withTrustedTenantHeader(request, 'acme');
    expect(forwarded.get('x-tenant-slug')).toBe('acme');
    expect(forwarded.get('x-tenant-id')).toBe('acme');
    const slug = await resolveRequestTenantSlug(forwarded);
    expect(slug).toBe('acme');
  });

  it('strips client tenant headers when the Host resolves no tenant', () => {
    const request = new NextRequest('http://localhost/dashboard', {
      headers: { 'X-Tenant-Slug': 'victim' },
    });
    const forwarded = withTrustedTenantHeader(request, null);
    expect(forwarded.get('x-tenant-slug')).toBeNull();
    expect(forwarded.get('x-tenant-id')).toBeNull();
  });
});
