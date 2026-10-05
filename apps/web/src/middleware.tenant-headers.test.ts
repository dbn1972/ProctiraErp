/**
 * @vitest-environment node
 *
 * PRC-M153: tenant context is forwarded to Server Components as request headers
 * (what `headers()` reads), and client-sent x-tenant-* headers never survive.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTenantConfigCache, middleware } from './middleware';

function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('middleware forwards trusted tenant request headers (PRC-M153)', () => {
  beforeEach(() => {
    clearTenantConfigCache();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'tenant-acme', slug: 'acme', name: 'Acme', active: true }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards x-tenant-slug=acme for acme.proctira.io', async () => {
    const response = await middleware(new NextRequest('https://acme.proctira.io/login'));
    expect(forwarded(response, 'x-tenant-slug')).toBe('acme');
    expect(forwarded(response, 'x-tenant-id')).toBe('acme');
  });

  it('overwrites a client-sent X-Tenant-Slug: victim', async () => {
    const response = await middleware(
      new NextRequest('https://acme.proctira.io/login', {
        headers: { 'X-Tenant-Slug': 'victim', 'X-Tenant-ID': 'victim' },
      }),
    );
    expect(forwarded(response, 'x-tenant-slug')).toBe('acme');
    expect(forwarded(response, 'x-tenant-id')).toBe('acme');
  });

  it('drops client tenant headers entirely when the host resolves no tenant', async () => {
    const response = await middleware(
      new NextRequest('http://localhost:3001/login', {
        headers: { 'X-Tenant-Slug': 'victim', 'X-Tenant-ID': 'victim' },
      }),
    );
    const overridden = response.headers.get('x-middleware-override-headers') ?? '';
    expect(overridden.split(',')).not.toContain('x-tenant-slug');
    expect(forwarded(response, 'x-tenant-slug')).toBeNull();
    expect(forwarded(response, 'x-tenant-id')).toBeNull();
  });
});
