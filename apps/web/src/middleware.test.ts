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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const config = await getTenantConfig('nonexistent');
    expect(config).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('normalizes tenant slug to lowercase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'uuid-123',
          slug: 'myschool',
          name: 'My School',
          primaryColor: 'hsl(200, 50%, 50%)',
          accentColor: 'hsl(100, 50%, 50%)',
          active: true,
        }),
      }),
    );

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
    return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
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

// ─── G-719: CSRF gate on /api/* + double-submit cookie issuance ──────────────

describe('API CSRF gate (G-719)', () => {
  const token = 'a'.repeat(64);

  async function api(
    method: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const { NextRequest } = await import('next/server');
    const { handleApiRequest } = await import('./middleware');
    const req = new NextRequest('https://app.proctira.io/api/auth/login', {
      method,
      headers: { host: 'app.proctira.io', ...headers },
    });
    const res = handleApiRequest(req);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  it('lets GET through untouched', async () => {
    const { status } = await api('GET', { origin: 'https://evil.example' });
    expect(status).toBe(200);
  });

  it('rejects a cross-site POST with 403 + CSRF_REJECTED', async () => {
    const { status, body } = await api('POST', {
      origin: 'https://evil.example',
      cookie: `csrf_token=${token}`,
      'x-csrf-token': token,
    });
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 'CSRF_REJECTED', reason: 'origin-mismatch' });
  });

  it('rejects a same-origin POST that lacks the double-submit header', async () => {
    const { status, body } = await api('POST', {
      origin: 'https://app.proctira.io',
      cookie: `csrf_token=${token}`,
    });
    expect(status).toBe(403);
    expect(body).toMatchObject({ reason: 'missing-header' });
  });

  it('accepts a same-origin POST carrying a matching cookie + header', async () => {
    const { status } = await api('POST', {
      origin: 'https://app.proctira.io',
      cookie: `csrf_token=${token}`,
      'x-csrf-token': token,
    });
    expect(status).toBe(200);
  });

  it('issues the csrf_token cookie on page navigations when absent', async () => {
    const { NextRequest, NextResponse } = await import('next/server');
    const { ensureCsrfCookie } = await import('./middleware');
    const req = new NextRequest('https://app.proctira.io/login', {
      headers: { host: 'app.proctira.io', 'x-forwarded-proto': 'https' },
    });
    const res = NextResponse.next();
    ensureCsrfCookie(req, res);
    const cookie = res.cookies.get('csrf_token');
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie?.httpOnly).toBeFalsy();
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
  });

  it('does not rotate an existing csrf_token cookie', async () => {
    const { NextRequest, NextResponse } = await import('next/server');
    const { ensureCsrfCookie } = await import('./middleware');
    const req = new NextRequest('https://app.proctira.io/dashboard', {
      headers: { host: 'app.proctira.io', cookie: `csrf_token=${token}` },
    });
    const res = NextResponse.next();
    ensureCsrfCookie(req, res);
    expect(res.cookies.get('csrf_token')).toBeUndefined();
  });
});

describe('institution bare detail redirect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends /institutions/:id to /overview and leaves other institution routes', async () => {
    const { institutionBareDetailRedirect } = await import('./middleware');
    const id = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
    expect(institutionBareDetailRedirect(`/institutions/${id}`)).toBe(
      `/institutions/${id}/overview`,
    );
    expect(institutionBareDetailRedirect('/institutions/new')).toBeNull();
    expect(institutionBareDetailRedirect('/institutions')).toBeNull();
    expect(institutionBareDetailRedirect(`/institutions/${id}/overview`)).toBeNull();
    expect(institutionBareDetailRedirect(`/institutions/${id}/classes`)).toBeNull();
    expect(institutionBareDetailRedirect('/institutions/new/overview')).toBeNull();
  });

  it('307s GET /institutions/:id before any tenant fetch', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware');
    const id = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
    const req = new NextRequest(`https://app.proctira.io/institutions/${id}?tab=1`, {
      headers: { host: 'app.proctira.io' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `https://app.proctira.io/institutions/${id}/overview?tab=1`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not rewrite /institutions/new into an overview redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );
    const { NextRequest } = await import('next/server');
    const { middleware, clearTenantConfigCache } = await import('./middleware');
    clearTenantConfigCache();
    const req = new NextRequest('https://app.proctira.io/institutions/new', {
      headers: { host: 'app.proctira.io' },
    });
    const res = await middleware(req);
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('/institutions/new/overview');
    expect(location).toContain('/login');
  });
});

describe('G-904 portal role bounce', () => {
  it('sends a student-only JWT from /parent to /student', async () => {
    const { portalRoleRedirect, jwtRoleIds, isStudentOnlyRoles } = await import('./middleware');
    const roles = jwtRoleIds({
      roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
    });
    expect(isStudentOnlyRoles(roles)).toBe(true);
    expect(portalRoleRedirect('/parent', roles)).toBe('/student');
    expect(portalRoleRedirect('/parent/attendance', roles)).toBe('/student');
  });

  it('sends a parent-only JWT from /student to /parent', async () => {
    const { portalRoleRedirect, jwtRoleIds, isParentOnlyRoles } = await import('./middleware');
    const roles = jwtRoleIds({
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    });
    expect(isParentOnlyRoles(roles)).toBe(true);
    expect(portalRoleRedirect('/student', roles)).toBe('/parent');
    expect(portalRoleRedirect('/student/pal', roles)).toBe('/parent');
    expect(portalRoleRedirect('/parent/grades', roles)).toBeNull();
  });

  it('lets staff and admin keep /parent and /student for a11y scans', async () => {
    const { portalRoleRedirect, jwtRoleIds } = await import('./middleware');
    const admin = jwtRoleIds({
      roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    });
    expect(portalRoleRedirect('/parent', admin)).toBeNull();
    expect(portalRoleRedirect('/student', admin)).toBeNull();
    const mixed = jwtRoleIds({
      roles: [
        { roleId: 'parent', roleName: 'Parent', areaId: null },
        { roleId: 'teacher', roleName: 'Teacher', areaId: null },
      ],
    });
    expect(portalRoleRedirect('/student', mixed)).toBeNull();
  });
});

describe('UATENV-D06 / D13: Keycloak session claims in middleware', () => {
  function keycloakJwt(realmRoles: string[]): string {
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
      sub: 'kc-subject-1',
      iss: 'https://keycloak.test/realms/proctira',
      azp: 'proctira-gateway',
      exp: now + 600,
      iat: now,
      tenant_id: 'tenant-kc-1',
      realm_access: { roles: [...realmRoles, 'offline_access', 'default-roles-proctira'] },
    })}.sig`;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  });

  async function navigate(path: string, realmRoles: string[]) {
    const { NextRequest } = await import('next/server');
    const { middleware, clearTenantConfigCache } = await import('./middleware');
    clearTenantConfigCache();
    return middleware(
      new NextRequest(`https://app.proctira.io${path}`, {
        headers: {
          host: 'app.proctira.io',
          cookie: `access_token=${keycloakJwt(realmRoles)}; refresh_token=rt-1`,
        },
      }),
    );
  }

  it('reads Keycloak realm roles, without the Keycloak built-in roles', async () => {
    const { jwtRoleIds } = await import('./middleware');
    expect(
      jwtRoleIds({
        tenant_id: 't1',
        azp: 'proctira-gateway',
        realm_access: { roles: ['student', 'offline_access', 'default-roles-proctira'] },
      }),
    ).toEqual(['student']);
  });

  it('bounces a Keycloak student off /parent and a Keycloak guardian off /student', async () => {
    expect((await navigate('/parent/grades', ['student'])).headers.get('location')).toBe(
      'https://app.proctira.io/student',
    );
    expect((await navigate('/student/timetable', ['guardian'])).headers.get('location')).toBe(
      'https://app.proctira.io/parent',
    );
  });

  it('forwards the Keycloak tenant_id claim as X-Tenant-ID', async () => {
    const res = await navigate('/students', ['teacher']);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Tenant-ID')).toBe('tenant-kc-1');
  });

  it('D13: sends portal-only roles from the staff dashboard home to their portal', async () => {
    expect((await navigate('/', ['student'])).headers.get('location')).toBe(
      'https://app.proctira.io/student',
    );
    expect((await navigate('/', ['guardian'])).headers.get('location')).toBe(
      'https://app.proctira.io/parent',
    );
    expect((await navigate('/', ['teacher'])).headers.get('location')).toBeNull();
  });

  it('D13: portalRoleRedirect sends portal-only roles from / to their portal', async () => {
    const { portalRoleRedirect } = await import('./middleware');
    expect(portalRoleRedirect('/', ['student'])).toBe('/student');
    expect(portalRoleRedirect('/', ['parent'])).toBe('/parent');
    expect(portalRoleRedirect('/', ['guardian'])).toBe('/parent');
    expect(portalRoleRedirect('/', ['parent', 'teacher'])).toBeNull();
    expect(portalRoleRedirect('/', [])).toBeNull();
  });
});

describe('UATENV-D18: idle session with only the refresh cookie left', () => {
  const refreshUrls = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.includes('/api/auth/refresh'));

  function stubRefresh(ok: boolean) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (!String(url).includes('/api/auth/refresh')) {
          return new Response('{}', { status: 404 });
        }
        if (!ok) return new Response('{}', { status: 401 });
        const headers = new Headers();
        headers.append('set-cookie', 'access_token=rotated-at; Path=/; HttpOnly');
        headers.append('set-cookie', 'refresh_token=rt-rotated; Path=/; HttpOnly');
        return new Response('{"success":true}', { status: 200, headers });
      }),
    );
  }

  async function navigate(cookie: string) {
    const { NextRequest } = await import('next/server');
    const { middleware, clearTenantConfigCache, __resetRefreshSingleFlight } =
      await import('./middleware');
    clearTenantConfigCache();
    __resetRefreshSingleFlight();
    return middleware(
      new NextRequest('https://app.proctira.io/students?page=2', {
        headers: { host: 'app.proctira.io', ...(cookie ? { cookie } : {}) },
      }),
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes and replays the navigation instead of redirecting to /login', async () => {
    stubRefresh(true);
    const res = await navigate('refresh_token=rt-idle');
    expect(refreshUrls()).toEqual(['https://app.proctira.io/api/auth/refresh']);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.proctira.io/students?page=2');
    const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.some((c) => c.startsWith('access_token=rotated-at'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token=rt-rotated'))).toBe(true);
  });

  it('sends the user to /login and clears the cookies when the refresh is refused', async () => {
    stubRefresh(false);
    const res = await navigate('refresh_token=rt-revoked');
    expect(refreshUrls()).toHaveLength(1);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/students');
    const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.some((c) => /^refresh_token=;/.test(c))).toBe(true);
    expect(cookies.some((c) => /^access_token=;/.test(c))).toBe(true);
  });

  it('still sends a request with no session cookies to /login without a refresh call', async () => {
    stubRefresh(true);
    const res = await navigate('');
    expect(refreshUrls()).toHaveLength(0);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});
