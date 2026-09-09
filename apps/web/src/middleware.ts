import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { defaultLocale, isValidLocale, getDirection } from './i18n/config';
import { isSecureCookieContext } from './lib/auth/cookies';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfCookieOptions,
  csrfRejectionBody,
  generateCsrfToken,
  isUnsafeMethod,
  verifyCsrf,
} from './lib/auth/csrf';

/** Routes that do not require authentication. */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/mfa',
  '/mfa-setup',
  '/mfa/setup',
  '/auth/mfa-setup',
  '/oauth',
  '/callback',
  '/logout',
  '/healthz',
  // Public Application Tracking page (Requirement 16.6, 16.11). Anonymous
  // applicants must be able to look up their submission status with the
  // tracking number alone — no auth, no tenant subdomain required.
  '/track',
];

/** Cookie name for the access token. */
const ACCESS_TOKEN_COOKIE = 'access_token';
/** Cookie name for the refresh token. */
const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Cookie name for the user's preferred locale. */
const LOCALE_COOKIE = 'locale';

/** Base domain for subdomain extraction. */
const BASE_DOMAIN = process.env.TENANT_BASE_DOMAIN || 'proctira.io';

/** How many seconds of slack we allow before treating a token as expired. */
const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

// ─── Tenant Config Cache (5-minute TTL) ──────────────────────────────────────

/**
 * Tenant configuration resolved from the backend. Contains the minimal
 * information needed by the middleware to set downstream headers and
 * propagate branding tokens for SSR.
 */
export interface TenantConfig {
  /** Tenant UUID or slug identifier. */
  id: string;
  /** Human-readable tenant slug (used in subdomain). */
  slug: string;
  /** Display name for the tenant (Brand_Name). */
  name: string;
  /** Primary brand color (hsl/hex). */
  primaryColor: string;
  /** Accent brand color (hsl/hex). */
  accentColor: string;
  /** Whether the tenant is active. */
  active: boolean;
}

interface TenantCacheEntry {
  config: TenantConfig;
  expiresAt: number;
}

/** TTL for the tenant config cache: 5 minutes (Design §M, Task 60A.8). */
export const TENANT_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

/** Module-level tenant config cache keyed by slug. */
const _tenantConfigCache = new Map<string, TenantCacheEntry>();

/** In-flight fetch deduplication. */
const _tenantConfigInFlight = new Map<string, Promise<TenantConfig | null>>();

/** Test-only: clear the tenant config cache. */
export function clearTenantConfigCache(): void {
  _tenantConfigCache.clear();
  _tenantConfigInFlight.clear();
}

/** Test-only: peek at the cache for a given slug. */
export function _peekTenantConfigCache(slug: string): TenantCacheEntry | undefined {
  return _tenantConfigCache.get(slug);
}

/**
 * Default tenant config used when the backend is unreachable or the tenant
 * slug is not found. Ensures the middleware always produces a valid response.
 */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  id: 'default',
  slug: 'default',
  name: 'ProctiraERP',
  primaryColor: 'hsl(222, 47%, 31%)',
  accentColor: 'hsl(174, 62%, 40%)',
  active: true,
};

/** Gateway base URL for tenant config lookups. */
function getGatewayBaseUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? 'http://localhost:3000';
}

/**
 * Fetches tenant configuration from the API gateway. Returns null when the
 * tenant is not found (404) or the service is unreachable.
 */
async function fetchTenantConfig(slug: string): Promise<TenantConfig | null> {
  try {
    const url = `${getGatewayBaseUrl()}/api/v1/tenant/config`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Tenant-ID': slug,
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    return normalizeTenantConfig(payload, slug);
  } catch {
    return null;
  }
}

/**
 * Normalizes a raw API response into a TenantConfig, accepting multiple
 * field naming conventions from the backend.
 */
function normalizeTenantConfig(
  payload: Record<string, unknown>,
  fallbackSlug: string,
): TenantConfig {
  const id =
    (typeof payload['id'] === 'string' && payload['id']) ||
    (typeof payload['tenantId'] === 'string' && payload['tenantId']) ||
    fallbackSlug;
  const slug = (typeof payload['slug'] === 'string' && payload['slug']) || fallbackSlug;
  const name =
    (typeof payload['name'] === 'string' && payload['name']) ||
    (typeof payload['organizationName'] === 'string' && payload['organizationName']) ||
    DEFAULT_TENANT_CONFIG.name;
  const primaryColor =
    (typeof payload['primaryColor'] === 'string' && payload['primaryColor']) ||
    (typeof payload['primary_color'] === 'string' && payload['primary_color']) ||
    DEFAULT_TENANT_CONFIG.primaryColor;
  const accentColor =
    (typeof payload['accentColor'] === 'string' && payload['accentColor']) ||
    (typeof payload['accent_color'] === 'string' && payload['accent_color']) ||
    DEFAULT_TENANT_CONFIG.accentColor;
  const active = payload['active'] !== false;

  return { id, slug, name, primaryColor, accentColor, active };
}

/**
 * Resolves tenant configuration with a 5-minute in-memory cache.
 * De-duplicates concurrent in-flight requests for the same slug.
 *
 * Falls back to DEFAULT_TENANT_CONFIG when the backend is unreachable,
 * ensuring the middleware never blocks page rendering.
 */
export async function getTenantConfig(slug: string): Promise<TenantConfig> {
  const normalizedSlug = (slug || 'default').toLowerCase();
  const now = Date.now();

  // Check cache
  const cached = _tenantConfigCache.get(normalizedSlug);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  // De-duplicate concurrent fetches
  const existing = _tenantConfigInFlight.get(normalizedSlug);
  if (existing) {
    const result = await existing;
    return result ?? DEFAULT_TENANT_CONFIG;
  }

  // Fetch from backend
  const promise = fetchTenantConfig(normalizedSlug)
    .then((config) => {
      const resolved = config ?? DEFAULT_TENANT_CONFIG;
      _tenantConfigCache.set(normalizedSlug, {
        config: resolved,
        expiresAt: Date.now() + TENANT_CONFIG_CACHE_TTL_MS,
      });
      _tenantConfigInFlight.delete(normalizedSlug);
      return config;
    })
    .catch(() => {
      _tenantConfigInFlight.delete(normalizedSlug);
      return null;
    });

  _tenantConfigInFlight.set(normalizedSlug, promise);
  const result = await promise;
  return result ?? DEFAULT_TENANT_CONFIG;
}

// ─── Subdomain Resolution ────────────────────────────────────────────────────

/**
 * Resolves the tenant slug from the request hostname subdomain.
 * Example: 'ministry-edu.proctira.io' → 'ministry-edu'
 */
export function resolveTenantFromSubdomain(hostname: string): string | null {
  const host = hostname.split(':')[0] || '';

  if (host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return null;
  }

  if (!host.endsWith(`.${BASE_DOMAIN}`)) {
    return null;
  }

  const subdomain = host.slice(0, -(BASE_DOMAIN.length + 1));
  if (subdomain.length > 0 && !subdomain.includes('.')) {
    return subdomain;
  }

  return null;
}

// ─── Token Helpers ───────────────────────────────────────────────────────────

/**
 * Returns true when the JWT looks structurally valid AND its `exp` claim is
 * still in the future (with a small buffer).
 */
function isAccessTokenFresh(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(atob(parts[1]!)) as { exp?: number };
    if (!payload.exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp - TOKEN_EXPIRY_BUFFER_SECONDS > now;
  } catch {
    return false;
  }
}

/**
 * Returns true when a token is structurally valid (regardless of expiry).
 * Used to decide whether we should attempt a refresh vs. force a re-login.
 */
function isStructurallyValid(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    JSON.parse(atob(parts[1]!));
    return true;
  } catch {
    return false;
  }
}

/** Normalised role ids from a JWT payload (`roleId` preferred over `roleName`). */
export function jwtRoleIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const roles = (payload as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  const ids: string[] = [];
  for (const role of roles) {
    if (typeof role === 'string') {
      const normalised = role.toLowerCase().replace(/_/g, '-').trim();
      if (normalised) ids.push(normalised);
      continue;
    }
    if (role && typeof role === 'object') {
      const rec = role as Record<string, unknown>;
      const raw =
        (typeof rec.roleId === 'string' && rec.roleId) ||
        (typeof rec.roleName === 'string' && rec.roleName) ||
        (typeof rec.id === 'string' && rec.id) ||
        '';
      const normalised = raw.toLowerCase().replace(/_/g, '-').trim();
      if (normalised) ids.push(normalised);
    }
  }
  return ids;
}

export function isStudentOnlyRoles(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((role) => role === 'student');
}

export function isParentOnlyRoles(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((role) => role === 'parent' || role === 'guardian');
}

/**
 * Bounce student-only actors off `/parent` and parent-only actors off `/student`.
 * Staff/admin (any non-portal-only role) keep access so a11y sessions still work.
 */
export function portalRoleRedirect(
  pathname: string,
  roles: readonly string[],
): '/parent' | '/student' | null {
  const onParent = pathname === '/parent' || pathname.startsWith('/parent/');
  const onStudent = pathname === '/student' || pathname.startsWith('/student/');
  if (onParent && isStudentOnlyRoles(roles)) return '/student';
  if (onStudent && isParentOnlyRoles(roles)) return '/parent';
  return null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Next.js middleware (Task 60A.8):
 * 1. Tenant resolution from subdomain with fallback to X-Tenant-ID header
 * 2. Tenant config lookup from cache (5-min TTL) for validation and branding
 * 3. Set tenant context headers for downstream requests and BrandConfigProvider
 * 4. Auth token validation with automatic refresh on expiration
 * 5. Locale detection and direction setting
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets.
  if (pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // API routes: enforce CSRF on state-changing requests (G-719), otherwise
  // pass straight through — tenant/auth handling lives in the handlers.
  if (pathname.startsWith('/api')) {
    return handleApiRequest(request);
  }

  const response = NextResponse.next();
  ensureCsrfCookie(request, response);
  const hostname = request.headers.get('host') || '';

  // --- Tenant Resolution (Design §M, Task 60A.8) ---
  // Priority: subdomain → X-Tenant-ID header → 'default'
  const tenantSlug = resolveTenantFromSubdomain(hostname);
  const headerTenantId = request.headers.get('x-tenant-id');
  const resolvedTenantSlug = tenantSlug || headerTenantId || 'default';

  // Look up tenant config from cache (5-min TTL). This validates the tenant
  // exists and provides branding tokens for the SSR layer.
  const tenantConfig = await getTenantConfig(resolvedTenantSlug);

  // Set tenant context headers for downstream Server Components and API calls.
  response.headers.set('X-Tenant-ID', tenantConfig.id);
  response.headers.set('X-Tenant-Slug', tenantConfig.slug);
  response.headers.set('X-Tenant-Name', tenantConfig.name);
  response.headers.set('X-Tenant-Primary-Color', tenantConfig.primaryColor);
  response.headers.set('X-Tenant-Accent-Color', tenantConfig.accentColor);

  // --- Locale Resolution ---
  const localeCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = request.headers.get('accept-language')?.split(',')[0]?.split('-')[0];
  const locale =
    localeCookie && isValidLocale(localeCookie)
      ? localeCookie
      : acceptLanguage && isValidLocale(acceptLanguage)
        ? acceptLanguage
        : defaultLocale;
  response.headers.set('X-Locale', locale);
  response.headers.set('X-Direction', getDirection(locale));

  // --- Auth Token Validation ---
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!isPublicPath) {
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

    if (!accessToken || !isStructurallyValid(accessToken)) {
      return redirectToLogin(request, pathname);
    }

    // If the access token is expired but a refresh token is present, attempt
    // a transparent refresh by calling our own /api/auth/refresh route.
    if (!isAccessTokenFresh(accessToken)) {
      if (!refreshToken) {
        return redirectToLogin(request, pathname);
      }

      const refreshed = await tryRefresh(request);
      if (!refreshed) {
        const expiredResponse = redirectToLogin(request, pathname);
        // Clear the stale tokens so the user gets a clean state on retry.
        expiredResponse.cookies.delete(ACCESS_TOKEN_COOKIE);
        expiredResponse.cookies.delete(REFRESH_TOKEN_COOKIE);
        return expiredResponse;
      }

      // Replay the original navigation now that cookies have been rotated.
      const replay = NextResponse.redirect(request.url);
      // Carry the rotated cookies onto the redirect so the browser sees them
      // before the next request hits the middleware again.
      forwardSetCookies(refreshed, replay);
      return replay;
    }

    // Forward tenant from the JWT claim when present (takes precedence over
    // subdomain/header for authenticated requests — Design §M priority 3).
    try {
      const parts = accessToken.split('.');
      const payload = JSON.parse(atob(parts[1]!)) as { tenantId?: string; roles?: unknown };
      if (payload.tenantId) {
        response.headers.set('X-Tenant-ID', payload.tenantId);
      }
      const bounce = portalRoleRedirect(pathname, jwtRoleIds(payload));
      if (bounce) {
        return NextResponse.redirect(new URL(bounce, request.url));
      }
    } catch {
      // Token parsing failed, continue with subdomain-resolved tenant.
    }
  }

  return response;
}

/**
 * CSRF gate for `/api/*` (G-719). Safe methods pass through untouched; unsafe
 * methods must satisfy the origin + double-submit checks or receive a 403.
 */
export function handleApiRequest(request: NextRequest): NextResponse {
  if (!isUnsafeMethod(request.method)) {
    return NextResponse.next();
  }
  const verdict = verifyCsrf(request);
  if (!verdict.ok) {
    return NextResponse.json(csrfRejectionBody(verdict.reason), { status: 403 });
  }
  return NextResponse.next();
}

/**
 * Issues the readable double-submit CSRF cookie on page navigations when the
 * browser does not already hold one, so the first mutating fetch from any
 * page (including /login) can echo it back.
 */
export function ensureCsrfCookie(request: NextRequest, response: NextResponse): void {
  if (request.cookies.get(CSRF_COOKIE)?.value) return;
  response.cookies.set(
    CSRF_COOKIE,
    generateCsrfToken(),
    csrfCookieOptions(isSecureCookieContext(request)),
  );
}

/**
 * Calls the internal /api/auth/refresh route to rotate tokens. Returns the
 * upstream Response when successful so the caller can inspect Set-Cookie.
 *
 * The call is server-to-server, so it mints its own double-submit pair: the
 * token is placed both in the forwarded cookie jar and in the CSRF header.
 * An attacker cannot do this because they cannot set cookies on our origin.
 */
async function tryRefresh(request: NextRequest): Promise<Response | null> {
  try {
    const refreshUrl = new URL('/api/auth/refresh', request.url);
    const tenantId = request.headers.get('x-tenant-id') ?? 'default';
    const csrfToken = request.cookies.get(CSRF_COOKIE)?.value ?? generateCsrfToken();
    const cookieHeader = [request.headers.get('cookie') ?? '', `${CSRF_COOKIE}=${csrfToken}`]
      .filter(Boolean)
      .join('; ');
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
        cookie: cookieHeader,
        [CSRF_HEADER]: csrfToken,
      },
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

function redirectToLogin(request: NextRequest, returnTo: string): NextResponse {
  const loginUrl = new URL('/login', request.url);
  // Only bounce back to same-origin relative paths (open-redirect guard).
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  loginUrl.searchParams.set('returnTo', safeReturnTo);
  return NextResponse.redirect(loginUrl);
}

/**
 * Forward all Set-Cookie headers from one Response onto a NextResponse.
 * Used after a token refresh so the browser receives the rotated cookies
 * on the same response that performs the redirect replay.
 */
function forwardSetCookies(source: Response, target: NextResponse): void {
  // Headers#getSetCookie is the canonical way to read multi-valued
  // Set-Cookie. Falls back to getAll/raw when running on older runtimes.
  const headers = source.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = headers.getSetCookie ? headers.getSetCookie() : [];
  cookies.forEach((cookie) => {
    target.headers.append('set-cookie', cookie);
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
