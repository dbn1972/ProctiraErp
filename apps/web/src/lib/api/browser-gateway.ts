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

import { classifyStatusFailure, createTimeout } from './timeout';

/** Base URL of the API gateway, configurable per environment. */
export const BROWSER_GATEWAY_BASE_URL = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? '';

/** API version prefix used by every gateway path. */
export const BROWSER_GATEWAY_API_PREFIX = '/api/v1';

/**
 * Browser-side request deadline. See `./timeout.ts` for why this exists at all.
 *
 * Shorter than the server client's 30s: this one runs in front of a person watching a
 * spinner, and a browser call that has not answered in 20s is not going to.
 */
export const BROWSER_GATEWAY_TIMEOUT_MS = 20_000;

export interface BrowserGatewayRequestInit extends Omit<RequestInit, 'body' | 'method'> {
  method?: RequestInit['method'];
  /** Optional structured body that will be JSON encoded. */
  json?: unknown;
  /** Raw body (for multipart uploads etc.). Overrides `json`. */
  body?: BodyInit | null;
  /** Tenant override (defaults to the JWT claim). */
  tenantId?: string;
  /** Abort signal for cancellation. Composed with the deadline below. */
  signal?: AbortSignal;
  /** Abandon the request after this many ms. Defaults to {@link BROWSER_GATEWAY_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export class BrowserGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** Seconds the server asked the caller to wait, from `Retry-After` (429). */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = 'BrowserGatewayError';
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) this.details = init.details;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/** Name of the event raised when the gateway reports the session is gone. */
export const SESSION_EXPIRED_EVENT = 'proctira:session-expired';

export interface SessionExpiredDetail {
  /** Gateway path that returned 401, for the log line. */
  path: string;
  /** Envelope code, e.g. `UNAUTHORIZED` or `TOKEN_REVOKED`. */
  code: string;
}

/**
 * Announce an expired session once, on the document.
 *
 * A `CustomEvent` rather than a direct redirect: this module is imported by server-render
 * paths and by tests, and a hard `window.location` assignment here would make it
 * untestable and would discard unsaved work without asking. The shell subscribes and
 * decides — which keeps draft preservation a UI concern, where the draft actually lives.
 */
function notifySessionExpired(detail: SessionExpiredDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail }));
  } catch {
    /* CustomEvent is unavailable in some non-browser runtimes; the throw must not mask
       the original 401, which the caller still receives. */
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

  const timeout = createTimeout(init.timeoutMs ?? BROWSER_GATEWAY_TIMEOUT_MS, init.signal);

  let response: Response;
  try {
    response = await fetch(resolveUrl(path), {
      ...init,
      method: init.method ?? (body ? 'POST' : 'GET'),
      headers,
      body: body ?? null,
      credentials: 'include',
      signal: timeout.signal,
    });
  } catch (error) {
    // `TIMEOUT` rather than `NETWORK_ERROR` when the deadline fired: the server was
    // reachable and simply did not answer, which is a different thing to tell a user.
    throw new BrowserGatewayError({ status: 0, ...timeout.classify(error) });
  } finally {
    timeout.clear();
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
    // V15-12 / V15-13: 429 and 413 get their own message and the `Retry-After` the gateway
    // already sends. Previously every non-2xx went through one branch, so a rate limit and
    // a server fault were indistinguishable to the call site.
    const error = classifyStatusFailure(response, isErrorPayload(payload) ? payload : null);

    // V15-11: a session that expired mid-interaction. There was no handling at all — the
    // error was thrown and, with no toast system mounted, usually vanished, leaving the
    // user clicking a control that silently did nothing until the next navigation bounced
    // them to the login page with no explanation. Recovery is delegated rather than forced:
    // the client cannot know whether there is unsaved work worth preserving, so it raises a
    // typed, subscribable event and lets the shell decide.
    if (response.status === 401) {
      notifySessionExpired({ path, code: error.code });
    }

    throw new BrowserGatewayError({
      status: response.status,
      code: error.code,
      message: error.message,
      details: payload,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
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
