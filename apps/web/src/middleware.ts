import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { defaultLocale, isValidLocale, getDirection } from './i18n/config';
import { isSecureCookieContext } from './lib/auth/cookies';
import { resolveTenantFromSubdomain, resolveTenantForRequest } from './lib/api/request-tenant';
import { decodeBase64Url } from './lib/auth/jwt-payload';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfCookieOptions,
  csrfRejectionBody,
  generateCsrfToken,
  isUnsafeMethod,
  verifyCsrf,
} from './lib/auth/csrf';

export { resolveTenantFromSubdomain };

/** Routes that do not require authentication. */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/mfa',
  // PRC-H019: `/mfa-setup` (and its `/auth/mfa-setup` alias) enrols a TOTP
  // secret for the *signed-in* user, so it is deliberately NOT public.
  // `/mfa/setup` only redirects to `/mfa-setup`, which is then gated.
  '/oauth',
  '/callback',
  '/logout',
  '/healthz',
  // Public Application Tracking page (Requirement 16.6, 16.11). Anonymous
  // applicants must be able to look up their submission status with the
  // tracking number alone — no auth, no tenant subdomain required.
  '/track',
  // Privacy policy and terms of service. The signup consent copy links to both,
  // so they are read by definition *before* a session exists — gating them
  // behind auth means asking someone to accept terms they cannot open. Prefix
  // match, so it covers `/legal/*`.
  '/legal',
  // PRC-M154: landing page for a suspended (inactive) tenant; must not loop.
  '/tenant-suspended',
];

/** Cookie name for the access token. */
const ACCESS_TOKEN_COOKIE = 'access_token';
/** Cookie name for the refresh token. */
const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Cookie name for the user's preferred locale. */
const LOCALE_COOKIE = 'locale';

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

/** PRC-M154: failures (404 / unreachable) are cached briefly so recovery is quick. */
export const TENANT_CONFIG_NEGATIVE_TTL_MS = 30 * 1000;

/** PRC-M154: the gateway lookup must not hold up navigation indefinitely. */
export const TENANT_CONFIG_FETCH_TIMEOUT_MS = 2000;

/** PRC-M154: hard cap on cached slugs so distinct inputs cannot grow memory without bound. */
export const TENANT_CONFIG_CACHE_MAX_ENTRIES = 1000;

/** PRC-M154: shape of a tenant slug (DNS label). Anything else resolves to `default`. */
const TENANT_SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;

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
      signal: AbortSignal.timeout(TENANT_CONFIG_FETCH_TIMEOUT_MS),
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
  const lowered = (slug || 'default').toLowerCase();
  const normalizedSlug = TENANT_SLUG_PATTERN.test(lowered) ? lowered : 'default';
  const now = Date.now();

  // Check cache (LRU: a hit moves the entry to the most-recent end).
  const cached = _tenantConfigCache.get(normalizedSlug);
  if (cached && cached.expiresAt > now) {
    _tenantConfigCache.delete(normalizedSlug);
    _tenantConfigCache.set(normalizedSlug, cached);
    return cached.config;
  }
  if (cached) _tenantConfigCache.delete(normalizedSlug);

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
      while (_tenantConfigCache.size >= TENANT_CONFIG_CACHE_MAX_ENTRIES) {
        const oldest = _tenantConfigCache.keys().next().value;
        if (oldest === undefined) break;
        _tenantConfigCache.delete(oldest);
      }
      _tenantConfigCache.set(normalizedSlug, {
        config: resolved,
        expiresAt:
          Date.now() + (config ? TENANT_CONFIG_CACHE_TTL_MS : TENANT_CONFIG_NEGATIVE_TTL_MS),
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

// Subdomain resolution lives in `lib/api/request-tenant.ts` (PRC-H027) and is
// re-exported above for existing callers.

// ─── Token Helpers ───────────────────────────────────────────────────────────

/**
 * Returns true when the JWT looks structurally valid AND its `exp` claim is
 * still in the future (with a small buffer).
 */
function isAccessTokenFresh(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]!)) as { exp?: number };
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
    JSON.parse(decodeBase64Url(parts[1]!));
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

/**
 * Bare `/institutions/:id` has no screen of its own — it should land on the
 * overview tab. `redirect()` in `[id]/page.tsx` does not run until
 * `[id]/layout.tsx` finishes `getInstitution` and the lookup fetches. Once
 * that layout has started streaming, Next sends a client navigation instead
 * of an HTTP redirect. That hop aborts the in-flight document
 * (`net::ERR_ABORTED`) and can miss a 20s `waitForURL`.
 *
 * Returning the overview path here lets middleware emit a 307 before any RSC
 * render or gateway read. `/institutions/new` is the register form.
 */
export function institutionBareDetailRedirect(pathname: string): string | null {
  const match = /^\/institutions\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const id = match[1];
  if (!id || id === 'new') return null;
  return `/institutions/${id}/overview`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Next.js middleware (Task 60A.8):
 * 1. Tenant resolution from the Host subdomain (client X-Tenant-ID ignored)
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

  // Before tenant lookup and auth so the hop does not wait on gateway I/O.
  // The follow-up request to /overview runs the full middleware.
  if (request.method === 'GET' || request.method === 'HEAD') {
    const overviewPath = institutionBareDetailRedirect(pathname);
    if (overviewPath) {
      const url = request.nextUrl.clone();
      url.pathname = overviewPath;
      return NextResponse.redirect(url);
    }
  }

  // --- Tenant Resolution (Design §M, Task 60A.8; PRC-H027) ---
  // Priority: Host subdomain → server TENANT_FALLBACK_SLUG → 'default'
  // (branding only). A client-supplied X-Tenant-ID is never trusted.
  const hostTenant = resolveTenantForRequest(request);
  const resolvedTenantSlug = hostTenant || 'default';
  // Look up tenant config from cache (5-min TTL). This validates the tenant
  // exists and provides branding tokens for the SSR layer.
  const tenantConfig = await getTenantConfig(resolvedTenantSlug);

  // PRC-M153: tenant context must reach Server Components as *request* headers
  // (`headers()` reads the request, not the response). Client-supplied
  // x-tenant-* values are stripped first so they can never select a tenant.
  const response = NextResponse.next({
    request: {
      headers: withTrustedTenantHeader(request, hostTenant, hostTenant ? tenantConfig.slug : null),
    },
  });
  ensureCsrfCookie(request, response);

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

  // PRC-M154: a suspended tenant (active:false) cannot use the app. Public pages
  // (login, legal, the suspended notice itself) stay reachable.
  if (!tenantConfig.active && !isPublicPath) {
    const suspendedUrl = request.nextUrl.clone();
    suspendedUrl.pathname = '/tenant-suspended';
    suspendedUrl.search = '';
    return NextResponse.redirect(suspendedUrl);
  }

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

      // PRC-M493: single-flight per refresh token; parallel navigations share one
      // /api/auth/refresh call and its rotated cookies instead of racing the rotation.
      const refreshed = await refreshOnce(request, refreshToken);
      if (!refreshed) {
        const expiredResponse = redirectToLogin(request, pathname);
        // Clear the stale tokens so the user gets a clean state on retry.
        expiredResponse.cookies.delete(ACCESS_TOKEN_COOKIE);
        expiredResponse.cookies.delete(REFRESH_TOKEN_COOKIE);
        return expiredResponse;
      }
      if (refreshed.setCookies.length === 0) {
        // PRC-M493: a 200 without rotated cookies would replay with the same expired token
        // and loop forever; send the user to sign in instead.
        return redirectToLogin(request, pathname);
      }
      // Replay the original navigation now that cookies have been rotated.
      const replay = NextResponse.redirect(request.url);
      // Carry the rotated cookies onto the redirect so the browser sees them
      // before the next request hits the middleware again.
      refreshed.setCookies.forEach((cookie) => replay.headers.append('set-cookie', cookie));
      return replay;
    }

    // Forward tenant from the JWT claim when present (takes precedence over
    // subdomain/header for authenticated requests — Design §M priority 3).
    try {
      const parts = accessToken.split('.');
      const payload = JSON.parse(decodeBase64Url(parts[1]!)) as {
        tenantId?: string;
        roles?: unknown;
      };
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
  const forward = () =>
    NextResponse.next({
      request: { headers: withTrustedTenantHeader(request, resolveTenantForRequest(request)) },
    });
  if (!isUnsafeMethod(request.method)) {
    return forward();
  }
  const verdict = verifyCsrf(request);
  if (!verdict.ok) {
    return NextResponse.json(csrfRejectionBody(verdict.reason), { status: 403 });
  }
  return forward();
}

/**
 * PRC-H027: replaces any client-supplied `X-Tenant-ID` on the forwarded
 * request with the Host-derived tenant (or removes it when unresolved), so
 * route handlers and server components never see a spoofed tenant.
 */
export function withTrustedTenantHeader(
  request: NextRequest,
  tenant: string | null,
  /** PRC-M153: trusted slug from the resolved tenant config, forwarded as x-tenant-slug. */
  slug: string | null = null,
): Headers {
  const headers = new Headers(request.headers);
  for (const name of TENANT_CONTEXT_REQUEST_HEADERS) headers.delete(name);
  if (tenant) headers.set('x-tenant-id', tenant);
  if (tenant && slug) headers.set('x-tenant-slug', slug);
  return headers;
}

/**
 * PRC-M153: tenant context headers only the middleware may set on the forwarded
 * request; any inbound copy from the client is discarded.
 */
const TENANT_CONTEXT_REQUEST_HEADERS = [
  'x-tenant-id',
  'x-tenant-slug',
  'x-tenant-name',
  'x-tenant-primary-color',
  'x-tenant-accent-color',
] as const;

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
/** PRC-M493: outcome of a refresh shared by concurrent requests. */
interface RefreshOutcome {
  setCookies: string[];
}
/** How long a completed refresh is reused for late parallel requests (ms). */
const REFRESH_REUSE_MS = 10_000;
const refreshInFlight = new Map<
  string,
  { promise: Promise<RefreshOutcome | null>; expiresAt: number }
>();
/**
 * PRC-M493: single-flight refresh keyed by the refresh-token cookie. The first
 * request performs the refresh; concurrent (and shortly-after) requests carrying
 * the same, now-rotated, refresh token reuse its Set-Cookie headers instead of
 * presenting a revoked token and deleting the session.
 */
export async function refreshOnce(
  request: NextRequest,
  refreshToken: string,
): Promise<RefreshOutcome | null> {
  const now = Date.now();
  for (const [key, entry] of refreshInFlight) {
    if (entry.expiresAt <= now) refreshInFlight.delete(key);
  }
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing.promise;
  const promise = tryRefresh(request).then((response) =>
    response ? { setCookies: readSetCookies(response) } : null,
  );
  refreshInFlight.set(refreshToken, { promise, expiresAt: now + REFRESH_REUSE_MS });
  const outcome = await promise;
  // Failures are not cached: a later retry may succeed.
  if (!outcome) refreshInFlight.delete(refreshToken);
  return outcome;
}
/** Test hook: forget all cached refresh outcomes. */
export function __resetRefreshSingleFlight(): void {
  refreshInFlight.clear();
}
function readSetCookies(source: Response): string[] {
  const headers = source.headers as Headers & { getSetCookie?: () => string[] };
  if (headers.getSetCookie) return headers.getSetCookie();
  const single = source.headers.get('set-cookie');
  return single ? [single] : [];
}
async function tryRefresh(request: NextRequest): Promise<Response | null> {
  try {
    // Same-origin URL: the refresh handler derives the tenant from its Host
    // (PRC-H027), so no client X-Tenant-ID is forwarded.
    const refreshUrl = new URL('/api/auth/refresh', request.url);
    const csrfToken = request.cookies.get(CSRF_COOKIE)?.value ?? generateCsrfToken();
    const cookieHeader = [request.headers.get('cookie') ?? '', `${CSRF_COOKIE}=${csrfToken}`]
      .filter(Boolean)
      .join('; ');
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
