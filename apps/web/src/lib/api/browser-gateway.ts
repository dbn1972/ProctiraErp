/**
 * Browser-side gateway client (Task 60.3).
 *
 * Centralises authenticated `fetch` calls to the API gateway from
 * client components and SPA-mounted pages (`apps/web/src/features/*`).
 * The server-side `gatewayFetch` in `./gateway.ts` is unsuitable for
 * the browser because it reads `cookies()` / `headers()` from
 * `next/headers`, which only resolve on the server.
 *
 * Auth + tenant resolution
 * ------------------------
 * The browser call sets `credentials: 'include'` so the auth cookie is
 * forwarded automatically. The middleware at the gateway re-injects the
 * `X-Tenant-ID` header from the JWT claim, so the browser does not need
 * to know the tenant id. A tenant override is supported for tests and
 * tenant-switching scenarios.
 *
 * Errors
 * ------
 * `BrowserGatewayError` carries the HTTP status, an error code, and the
 * raw response payload. Callers may either surface the error to the UI
 * (e.g., via a `useDashboardData` hook returning `{ error }`) or fall
 * back to a default value when the endpoint is not yet wired in dev.
 */

import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/auth/csrf';

/** Base URL of the API gateway, configurable per environment. */
export const BROWSER_GATEWAY_BASE_URL = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? '';

/** API version prefix used by every gateway path. */
export const BROWSER_GATEWAY_API_PREFIX = '/api/v1';

export interface BrowserGatewayRequestInit extends Omit<RequestInit, 'body' | 'method'> {
  method?: RequestInit['method'];
  /** Optional structured body that will be JSON encoded. */
  json?: unknown;
  /** Raw body (for multipart uploads etc.). Overrides `json`. */
  body?: BodyInit | null;
  /** Tenant override (defaults to the JWT claim). */
  tenantId?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export class BrowserGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'BrowserGatewayError';
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) this.details = init.details;
  }
}

/**
 * Resolve a path relative to the gateway. Absolute URLs are returned
 * unchanged so callers can target ad-hoc endpoints in tests.
 */
function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const prefixed = path.startsWith('/') ? path : `/${path}`;
  return `${BROWSER_GATEWAY_BASE_URL}${BROWSER_GATEWAY_API_PREFIX}${prefixed}`;
}

/**
 * Performs an authenticated request against the API gateway from the
 * browser. Returns the parsed JSON payload on 2xx, throws a
 * `BrowserGatewayError` otherwise.
 */
export async function browserGatewayFetch<T>(
  path: string,
  init: BrowserGatewayRequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.tenantId) headers.set('X-Tenant-ID', init.tenantId);
  const csrfToken = readCsrfTokenFromDocument();
  if (csrfToken && !headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrfToken);

  let body: BodyInit | null | undefined = init.body;
  if (body == null && init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(path), {
      ...init,
      method: init.method ?? (body ? 'POST' : 'GET'),
      headers,
      body: body ?? null,
      credentials: 'include',
    });
  } catch (error) {
    throw new BrowserGatewayError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network error',
    });
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
    const error =
      isErrorPayload(payload) && payload
        ? payload
        : {
            code: 'GATEWAY_ERROR',
            message: response.statusText || 'Gateway request failed',
          };
    throw new BrowserGatewayError({
      status: response.status,
      code: error.code,
      message: error.message,
      details: payload,
    });
  }

  return payload as T;
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
