/**
 * Server-only resolution of the API gateway base URL for the registration portal.
 *
 * The portal never calls a relative `/api` URL from the server: server-side
 * `fetch('/api/...')` is invalid and browser calls would hit the portal itself.
 * Browser calls go to the same-origin proxy (`/api/registrations/*`), which uses
 * this base URL at runtime. Nothing here is exposed through NEXT_PUBLIC_*.
 */

/** Gateway version prefix under which the registration plugin is mounted. */
export const GATEWAY_API_PREFIX = '/api/v1';

/** Local-development default (gateway on its compose/dev port). */
const DEV_DEFAULT_GATEWAY_URL = 'http://localhost:3000';

/**
 * Returns the gateway API base, e.g. `http://api-gateway:3000/api/v1`.
 *
 * Reads `GATEWAY_URL` (runtime env). In production an unset or invalid value
 * throws instead of silently falling back to a relative URL.
 */
export function getGatewayApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.GATEWAY_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'GATEWAY_URL is required in production for the registration portal (e.g. http://api-gateway:3000)',
      );
    }
    return `${DEV_DEFAULT_GATEWAY_URL}${GATEWAY_API_PREFIX}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`GATEWAY_URL must be an absolute http(s) URL, got "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`GATEWAY_URL must use http or https, got "${url.protocol}"`);
  }
  const base = url.toString().replace(/\/+$/, '');
  return base.endsWith(GATEWAY_API_PREFIX) ? base : `${base}${GATEWAY_API_PREFIX}`;
}

/**
 * Maps the proxy catch-all segments to the upstream gateway path, rejecting
 * dot/empty segments that could escape `/registrations` after URL normalisation.
 */
export function buildRegistrationProxyPath(
  segments: string[] | undefined,
  search: string,
): string | null {
  const parts = segments ?? [];
  if (parts.some((part) => part === '.' || part === '..' || part === '')) return null;
  const suffix = parts.map((part) => `/${encodeURIComponent(part)}`).join('');
  return `/registrations${suffix}${search}`;
}

/** Minimal header reader (Next `headers()`, `Headers`, `NextRequest.headers`). */
export interface HeaderReader {
  get(name: string): string | null;
}

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/**
 * Public hostname of the incoming portal request, forwarded to the gateway as
 * `Host` so its public-registration resolver selects the applicant's tenant.
 *
 * Trust boundary: the gateway resolves anonymous registration tenants from the
 * raw Host only. The portal is the only caller on the internal network that
 * sets it, from the ingress-provided `X-Forwarded-Host` (first hop) or `Host`.
 * Selecting a tenant this way grants nothing beyond that tenant's public
 * registration surface, which the client can already reach via its hostname.
 * Malformed values are dropped (the gateway then returns its not-found state).
 */
export function resolvePublicHost(headers: HeaderReader): string | undefined {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const candidate = forwarded || headers.get('host')?.trim();
  if (!candidate || !HOST_PATTERN.test(candidate)) return undefined;
  return candidate.toLowerCase();
}
