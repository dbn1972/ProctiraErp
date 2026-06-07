/**
 * Server-side gateway API client.
 *
 * Centralizes calls to the ProctiraERP API gateway from Server Components and
 * Server Actions. Forwards the authenticated user's access token and the
 * tenant identifier resolved from the session JWT.
 *
 * Tenant resolution rules (Requirement 4.7 / Task 27.5 contract):
 * - The `X-Tenant-ID` header is set on every outbound request.
 * - The value is taken from the `tenantId` claim on the access token cookie,
 *   falling back to the `X-Tenant-ID` request header passed by the middleware.
 * - The middleware only allows authenticated routes through, so a missing
 *   token here means the caller forgot to gate their route.
 */
import { cookies, headers } from 'next/headers';

import { AUTH_COOKIES, decodeTokenPayload } from '@/lib/auth';

/** Base URL for the API gateway. Can be overridden via env. */
export const GATEWAY_BASE_URL =
  process.env['NEXT_PUBLIC_GATEWAY_URL'] ??
  process.env['GATEWAY_URL'] ??
  'http://localhost:3000';

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

/** Reads the current session's tenant + access token from cookies / headers. */
export function getSessionContext(): { tenantId: string; accessToken: string | null } {
  const cookieStore = cookies();
  const headerStore = headers();

  const accessToken = cookieStore.get(AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;
  const payload = accessToken ? decodeTokenPayload(accessToken) : null;

  // Prefer JWT claim; fall back to middleware-injected header; finally to "default".
  const tenantId =
    payload?.tenantId ??
    headerStore.get('x-tenant-id') ??
    'default';

  return { tenantId, accessToken };
}

/**
 * Performs an authenticated request against the API gateway.
 * Always sets `X-Tenant-ID` and `Authorization` headers when available.
 */
export async function gatewayFetch<T>(
  path: string,
  init: GatewayRequestInit = {},
): Promise<GatewayResponse<T>> {
  const { tenantId: ctxTenantId, accessToken } = getSessionContext();
  const tenantId = init.tenantId ?? ctxTenantId;

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
