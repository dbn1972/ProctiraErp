/**
 * PRC-M134: shared helper for the same-origin "[...path]" gateway proxies.
 *
 * The browser cannot read the httpOnly access token and the gateway does not
 * accept the session cookie, so these routes attach the bearer and forward a
 * single, path-pinned sub-tree to the gateway. Every proxy must:
 *   • bound the upstream call with `AbortSignal.timeout` so a hung gateway
 *     cannot pin an SSR worker (504 Gateway Timeout on abort);
 *   • cap the request body it buffers so a client cannot force unbounded
 *     memory use (413);
 *   • map transport failures to 502 Bad Gateway instead of a thrown 500.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

/** Only lowercase/upper alnum plus `/ _ -`, no leading slash, no `..`. */
const SAFE_PATH = /^[a-z0-9][a-z0-9/_-]{0,240}$/i;

/** Default upstream timeout (ms). Overridable per-proxy. */
export const DEFAULT_PROXY_TIMEOUT_MS = 15_000;

/** Default max buffered request body (bytes) for non-GET proxied writes. */
export const DEFAULT_PROXY_MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface GatewayProxyOptions {
  /** Gateway sub-tree prefix, e.g. `scholarships` or `parent-portal/scholarships`. */
  prefix: string;
  /** Upstream timeout in ms. */
  timeoutMs?: number;
  /** Max buffered request body in bytes. */
  maxBodyBytes?: number;
  /** Human label used in validation errors. */
  label?: string;
}

/**
 * Forwards `request` to `${prefix}/${params.path}` on the gateway with the
 * session bearer, returning the upstream response (or a mapped error).
 */
export async function proxyToGateway(
  request: Request,
  path: string[],
  options: GatewayProxyOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_PROXY_MAX_BODY_BYTES;
  const label = options.label ?? 'resource';

  const joined = path.join('/');
  if (!SAFE_PATH.test(joined) || joined.includes('..')) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: `Invalid ${label} path` },
      { status: 400 },
    );
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json(
      { code: 'UNAUTHENTICATED', message: 'Sign in required' },
      { status: 401 },
    );
  }

  const upstreamUrl = new URL(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/${options.prefix}/${joined}`,
  );
  upstreamUrl.search = new URL(request.url).search;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Tenant-ID', tenantId);
  headers.set('Accept', request.headers.get('accept') ?? 'application/json');
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method.toUpperCase();
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (method !== 'GET' && method !== 'HEAD') {
    const buffered = await request.arrayBuffer();
    if (buffered.byteLength > maxBodyBytes) {
      return NextResponse.json(
        { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
        { status: 413 },
      );
    }
    init.body = Buffer.from(buffered);
  }
  init.signal = AbortSignal.timeout(timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return NextResponse.json(
      timedOut
        ? { code: 'GATEWAY_TIMEOUT', message: 'The upstream service did not respond in time' }
        : { code: 'BAD_GATEWAY', message: 'The upstream service is unavailable' },
      { status: timedOut ? 504 : 502 },
    );
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}
