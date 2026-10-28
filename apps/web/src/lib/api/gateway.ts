/**
 * Server-side gateway API client.
 *
 * Centralizes calls to the ProctiraERP API gateway from Server Components and
 * Server Actions. Forwards the authenticated user's access token and the
 * tenant identifier resolved from the session JWT.
 *
 * Tenant resolution rules (Requirement 4.7 / Task 27.5 contract; PRC-L265):
 * - The `X-Tenant-ID` header is set on every outbound request.
 * - With an access token the tenant comes only from the token's verified
 *   tenant claim (`tenantId`, or Keycloak `tenant_id`). A token that does not
 *   verify or carries no single tenant claim is refused: no request is sent.
 * - Without a token the tenant is the middleware's Host-derived `x-tenant-id`
 *   (the middleware strips every client copy, so it is a verified host
 *   mapping). There is no `'default'` fallback: an unresolved tenant is
 *   refused.
 */
import { cookies, headers } from 'next/headers';

import { AUTH_COOKIES } from '@/lib/auth';
import { readSessionToken, tenantIdFromClaims } from '@/lib/auth/verified-token';

/** Base URL for the API gateway. Can be overridden via env. */
export const GATEWAY_BASE_URL =
  process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? process.env['GATEWAY_URL'] ?? 'http://localhost:3000';

/** API version prefix used by the gateway. */
export const GATEWAY_API_PREFIX = '/api/v1';

export interface GatewayRequestInit extends Omit<RequestInit, 'body'> {
  /** Optional structured body that will be JSON encoded. */
  json?: unknown;
  /** Raw body (for multipart uploads etc.). Overrides `json`. */
  body?: BodyInit | null;
  /** Tenant override (defaults to JWT claim). */
  tenantId?: string;
  /** Whether to throw on non-2xx (default: true). */
  throwOnError?: boolean;
  /** Next.js fetch caching options. */
  next?: { revalidate?: number | false; tags?: string[] };
}

export interface GatewayResponse<T> {
  status: number;
  ok: boolean;
  data: T | null;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * Reads the current session's tenant + access token (PRC-L265).
 *
 * - Token present: `tenantId` is the verified token claim. A token that does
 *   not verify, or has no single tenant claim, is not forwarded: the result is
 *   `{ tenantId: '', accessToken: null }`, which every caller treats as
 *   unauthenticated (gatewayFetch sends nothing).
 * - No token: `tenantId` is the middleware's Host-derived `x-tenant-id`, or
 *   `''` when the host maps to no tenant. Never the literal `'default'`.
 */
export async function getSessionContext(): Promise<{
  tenantId: string;
  accessToken: string | null;
}> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const accessToken = cookieStore.get(AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;
  if (accessToken) {
    const tenantId = tenantIdFromClaims(
      await readSessionToken(accessToken, { ignoreExpiry: true }),
    );
    return tenantId ? { tenantId, accessToken } : { tenantId: '', accessToken: null };
  }

  return { tenantId: headerStore.get('x-tenant-id')?.trim() ?? '', accessToken: null };
}

/**
 * Performs an authenticated request against the API gateway.
 * Always sets `X-Tenant-ID` and `Authorization` headers when available.
 */
export async function gatewayFetch<T>(
  path: string,
  init: GatewayRequestInit = {},
): Promise<GatewayResponse<T>> {
  const { tenantId: ctxTenantId, accessToken } = await getSessionContext();
  // PRC-L265: an authenticated call always uses the verified token tenant.
  const tenantId = accessToken ? ctxTenantId : (init.tenantId ?? ctxTenantId);
  if (!tenantId) {
    // No verified tenant claim and no Host-derived tenant: refuse, send nothing.
    const refusal = {
      status: 401,
      code: 'TENANT_UNRESOLVED',
      message: 'No verified tenant for this request.',
    };
    if (init.throwOnError !== false) throw new GatewayError(refusal);
    return {
      status: refusal.status,
      ok: false,
      data: null,
      error: { code: refusal.code, message: refusal.message },
    };
  }

  const requestHeaders = new Headers(init.headers);
  requestHeaders.set('X-Tenant-ID', tenantId);
  requestHeaders.set('Accept', 'application/json');

  if (accessToken) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  let body: BodyInit | null | undefined = init.body;
  if (body == null && init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }
  }

  const url = path.startsWith('http')
    ? path
    : `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

  const fetchInit: RequestInit & { next?: GatewayRequestInit['next'] } = {
    ...init,
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers: requestHeaders,
    body: body ?? null,
  };
  if (init.next) {
    fetchInit.next = init.next;
  }
  // `next: { revalidate: 0 }` still opts into the Data Cache. That cache key
  // ignores Authorization, so a stale or anonymous body can be reused after
  // a write (Spiral PAL plan lookup). Treat revalidate 0 as no-store and
  // drop `next` so it cannot override `cache`.
  if (init.next?.revalidate === 0) {
    fetchInit.cache = 'no-store';
    delete fetchInit.next;
  } else if (accessToken && !fetchInit.cache && !init.next) {
    // Authenticated reads must not be served from the Next.js data cache.
    fetchInit.cache = 'no-store';
  }

  let response: Response;
  try {
    response = await fetch(url, fetchInit);
  } catch (error) {
    if (init.throwOnError !== false) {
      throw new GatewayError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      });
    }
    return {
      status: 0,
      ok: false,
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      },
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (response.status !== 204 && contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = isErrorPayload(payload)
      ? payload
      : {
          code: 'GATEWAY_ERROR',
          message: response.statusText || 'Gateway request failed',
        };
    if (init.throwOnError !== false) {
      throw new GatewayError({
        status: response.status,
        code: error.code,
        message: error.message,
        details: payload,
      });
    }
    return {
      status: response.status,
      ok: false,
      data: null,
      error: { code: error.code, message: error.message, details: payload },
    };
  }

  return {
    status: response.status,
    ok: true,
    data: (payload as T) ?? null,
  };
}

function isErrorPayload(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

export interface GatewayErrorInit {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Error thrown by gatewayFetch when a non-2xx response is received. */
export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(init: GatewayErrorInit) {
    super(init.message);
    this.name = 'GatewayError';
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) this.details = init.details;
  }
}
