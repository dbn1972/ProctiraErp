/**
 * apps/web/src/lib/api/proxy-download.ts
 *
 * Server-only helper for authenticated binary/text proxy route handlers
 * (file downloads, CSV exports, photos, artifacts).
 *
 * NEW-g1a_web-002: every proxy route previously called `fetch` with no
 * timeout and buffered the whole body with `.text()`/`.arrayBuffer()`. A hung
 * or very large upstream could exhaust the Next.js server. This helper:
 *
 *   • applies a bounded `AbortSignal.timeout` to the upstream request,
 *   • streams the response body straight through (no full-body buffering) when
 *     the caller does not need to transform it,
 *   • enforces an upstream `Content-Length` cap (fail closed on oversize),
 *   • maps failures to a fixed `{ code, message }` JSON error shape.
 *
 * Import only from Route Handlers / Server Components.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from './gateway';

/** Default upstream timeout for proxied downloads (ms). */
export const PROXY_TIMEOUT_MS = 30_000;

/** Default maximum upstream body size we will stream (bytes) — 50 MiB. */
export const PROXY_MAX_BYTES = 50 * 1024 * 1024;

export interface ProxyOptions {
  /** Gateway path relative to the API prefix, e.g. `/fees/reports/dues?format=csv`. */
  path: string;
  /** HTTP method (default GET). */
  method?: string;
  /** Extra request headers merged over the auth/tenant headers. */
  headers?: Record<string, string>;
  /** Request body for non-GET methods. */
  body?: BodyInit | null;
  /** Upstream timeout override (ms). */
  timeoutMs?: number;
  /** Maximum streamed body size (bytes). */
  maxBytes?: number;
  /** Response headers to copy from upstream (lower-case names). */
  copyResponseHeaders?: string[];
  /** Additional response headers to set on the proxied response. */
  responseHeaders?: Record<string, string>;
}

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ code, message }, { status });
}

const DEFAULT_COPY_HEADERS = ['content-type', 'content-disposition', 'content-length'];

/**
 * Proxy an authenticated request to the gateway and stream the response.
 *
 * On any upstream failure a fixed `{ code, message }` JSON error is returned.
 */
export async function proxyToGateway(options: ProxyOptions): Promise<Response> {
  const { accessToken, tenantId } = await getSessionContext();
  if (!accessToken) {
    return errorResponse('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }

  const timeoutMs = options.timeoutMs ?? PROXY_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PROXY_MAX_BYTES;

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Tenant-ID', tenantId);

  let upstream: Response;
  try {
    upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}${options.path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ?? null,
      cache: 'no-store',
      // Fail closed on a hung upstream instead of holding the connection open.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return errorResponse(
      isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      isTimeout
        ? 'The upstream service did not respond in time.'
        : 'The upstream service is unavailable.',
      isTimeout ? 504 : 502,
    );
  }

  // Enforce a declared Content-Length cap before streaming.
  const declaredLength = Number(upstream.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return errorResponse('PAYLOAD_TOO_LARGE', 'The requested file is too large to download.', 413);
  }

  if (!upstream.ok) {
    // Preserve the upstream status but normalise the body to a fixed shape.
    const text = await upstream.text().catch(() => '');
    let message = 'The upstream request failed.';
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } };
      if (typeof parsed.message === 'string') message = parsed.message;
      else if (typeof parsed.error?.message === 'string') message = parsed.error.message;
    } catch {
      /* non-JSON upstream error body — keep the fixed message */
    }
    return errorResponse('UPSTREAM_ERROR', message, upstream.status);
  }

  const responseHeaders = new Headers();
  const copy = options.copyResponseHeaders ?? DEFAULT_COPY_HEADERS;
  for (const name of copy) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set('cache-control', 'private, no-store');
  for (const [key, value] of Object.entries(options.responseHeaders ?? {})) {
    responseHeaders.set(key, value);
  }

  // Stream the body through without buffering the whole payload.
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

/**
 * Fetch an upstream resource with a bounded timeout and size cap, returning the
 * raw `Response` so the caller can transform the body (e.g. CSV relabelling)
 * before responding. Throws a `ProxyError` the caller maps to a response.
 */
export class ProxyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

export async function fetchFromGateway(
  path: string,
  init: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Response> {
  const { accessToken, tenantId } = await getSessionContext();
  if (!accessToken) {
    throw new ProxyError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }
  const timeoutMs = init.timeoutMs ?? PROXY_TIMEOUT_MS;
  const maxBytes = init.maxBytes ?? PROXY_MAX_BYTES;
  let upstream: Response;
  try {
    upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-ID': tenantId },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    throw new ProxyError(
      isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      isTimeout
        ? 'The upstream service did not respond in time.'
        : 'The upstream service is unavailable.',
      isTimeout ? 504 : 502,
    );
  }
  const declaredLength = Number(upstream.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProxyError('PAYLOAD_TOO_LARGE', 'The requested file is too large to download.', 413);
  }
  return upstream;
}
