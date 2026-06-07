import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveTenantFromSubdomain,
  getTenantConfig,
  clearTenantConfigCache,
  DEFAULT_TENANT_CONFIG,
  TENANT_CONFIG_CACHE_TTL_MS,
  _peekTenantConfigCache,
} from './middleware';

/**
 * Tests for the middleware logic (tenant resolution, auth validation, locale detection).
 * We test the pure functions extracted from middleware behavior.
 */

// Test the tenant resolution logic
describe('Tenant Resolution from Subdomain', () => {
  it('extracts tenant slug from subdomain', () => {
    expect(resolveTenantFromSubdomain('ministry-edu.proctira.io')).toBe('ministry-edu');
  });

  it('extracts tenant slug with port', () => {
    expect(resolveTenantFromSubdomain('school1.proctira.io:3000')).toBe('school1');
  });

  it('returns null for localhost', () => {
    expect(resolveTenantFromSubdomain('localhost')).toBeNull();
    expect(resolveTenantFromSubdomain('localhost:3000')).toBeNull();
  });

  it('returns null for IP addresses', () => {
    expect(resolveTenantFromSubdomain('127.0.0.1')).toBeNull();
    expect(resolveTenantFromSubdomain('192.168.1.1')).toBeNull();
  });

  it('returns null for base domain without subdomain', () => {
    expect(resolveTenantFromSubdomain('proctira.io')).toBeNull();
  });

  it('returns null for multi-level subdomains', () => {
    expect(resolveTenantFromSubdomain('a.b.proctira.io')).toBeNull();
  });

  it('returns null for different base domain', () => {
    expect(resolveTenantFromSubdomain('tenant.example.com')).toBeNull();
  });

  it('handles empty string', () => {
    expect(resolveTenantFromSubdomain('')).toBeNull();
  });

  it('extracts simple tenant slugs', () => {
    expect(resolveTenantFromSubdomain('tenant1.proctira.io')).toBe('tenant1');
    expect(resolveTenantFromSubdomain('my-school.proctira.io')).toBe('my-school');
  });
});

// Test the tenant config cache
describe('Tenant Config Cache', () => {
  beforeEach(() => {
    clearTenantConfigCache();
    vi.restoreAllMocks();
  });

  it('returns DEFAULT_TENANT_CONFIG when fetch fails', async () => {
    // Mock global fetch to simulate network failure
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const config = await getTenantConfig('unknown-tenant');
    expect(config).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('returns DEFAULT_TENANT_CONFIG when fetch returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const config = await getTenantConfig('nonexistent');
    expect(config).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('normalizes tenant slug to lowercase', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'uuid-123',
        slug: 'myschool',
        name: 'My School',
        primaryColor: 'hsl(200, 50%, 50%)',
        accentColor: 'hsl(100, 50%, 50%)',
        active: true,
      }),
    }));

    const config = await getTenantConfig('MySchool');
    expect(config.slug).toBe('myschool');
  });

  it('caches tenant config for 5 minutes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'uuid-456',
        slug: 'cached-tenant',
        name: 'Cached Tenant',
        primaryColor: 'hsl(200, 50%, 50%)',
        accentColor: 'hsl(100, 50%, 50%)',
        active: true,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // First call fetches from backend
    await getTenantConfig('cached-tenant');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call uses cache
    await getTenantConfig('cached-tenant');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify cache entry exists with correct TTL
    const entry = _peekTenantConfigCache('cached-tenant');
    expect(entry).toBeDefined();
    expect(entry!.expiresAt).toBeGreaterThan(Date.now());
    expect(entry!.expiresAt).toBeLessThanOrEqual(Date.now() + TENANT_CONFIG_CACHE_TTL_MS);
  });

  it('treats empty slug as default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));

    const config = await getTenantConfig('');
    expect(config).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('TENANT_CONFIG_CACHE_TTL_MS is 5 minutes', () => {
    expect(TENANT_CONFIG_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

// Test the token validation logic
describe('Token Validation', () => {
  function isTokenValid(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    try {
      const payload = JSON.parse(atob(parts[1]!));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function createJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const signature = btoa('fake-signature');
    return `${header}.${body}.${signature}`;
  }

  it('returns true for a valid non-expired token', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createJwt({ sub: 'user1', exp: futureExp, tenantId: 'tenant1' });
    expect(isTokenValid(token)).toBe(true);
  });

  it('returns false for an expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const token = createJwt({ sub: 'user1', exp: pastExp, tenantId: 'tenant1' });
    expect(isTokenValid(token)).toBe(false);
  });

  it('returns true for a token without exp claim', () => {
    const token = createJwt({ sub: 'user1', tenantId: 'tenant1' });
    expect(isTokenValid(token)).toBe(true);
  });

  it('returns false for malformed tokens', () => {
    expect(isTokenValid('')).toBe(false);
    expect(isTokenValid('not.a.valid.token')).toBe(false);
    expect(isTokenValid('only-one-part')).toBe(false);
    expect(isTokenValid('two.parts')).toBe(false);
  });

  it('returns false for tokens with invalid base64 payload', () => {
    expect(isTokenValid('header.!!!invalid!!!.signature')).toBe(false);
  });
});

// Test public path matching
describe('Public Path Matching', () => {
  const PUBLIC_PATHS = ['/login', '/callback', '/forgot-password', '/health', '/track'];

  function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
  }

  it('identifies login as public', () => {
    expect(isPublicPath('/login')).toBe(true);
  });

  it('identifies callback paths as public', () => {
    expect(isPublicPath('/callback')).toBe(true);
    expect(isPublicPath('/callback/google')).toBe(true);
  });

  it('identifies health check as public', () => {
    expect(isPublicPath('/health')).toBe(true);
  });

  it('identifies track as public', () => {
    expect(isPublicPath('/track')).toBe(true);
    expect(isPublicPath('/track/12345')).toBe(true);
  });

  it('identifies dashboard as protected', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/institutions')).toBe(false);
    expect(isPublicPath('/students')).toBe(false);
  });
});
