/**
 * Same-origin proxy for `GET /api/v1/tenant/branding`.
 *
 * ## Why this route has to exist
 *
 * `BrandConfigProvider.defaultBrandFetcher` fetches `BRAND_ENDPOINT`
 * (`/api/v1/tenant/branding`) **same-origin** with `credentials: 'same-origin'`, so
 * the browser sends the session cookie rather than a bearer token. That is a
 * deliberate design choice — the provider documents that it "never throws" and falls
 * back to `DEFAULT_BRAND` so public marketing screens stay visible when the gateway
 * is offline.
 *
 * `apps/web` hosted 23 routes under `/api` and none under `/api/v1`, so that fetch
 * had nowhere to land. It returned 404 on **159 of 193 pages** in a live capture.
 * Because the provider swallows a non-ok response by design, nothing looked broken —
 * every page simply rendered `DEFAULT_BRAND`. The practical consequence is that
 * per-tenant branding never applied in the browser at all: a tenant that published
 * colours and a logo through `/tenant/branding` got the default theme anyway.
 *
 * The fetch cannot simply be pointed at the gateway host instead:
 * `credentials: 'same-origin'` would stop sending the cookie cross-origin, and the
 * provider runs on public pages where no bearer token exists. Proxying here keeps the
 * cookie-based contract and lets the server exchange it for the gateway call.
 *
 * Unauthenticated requests get 204 rather than 401: the provider treats any non-ok
 * status as "use the default", and a 401 on every public page would be misleading
 * noise in logs and in the browser console. 204 says "no tenant branding applies
 * here", which is the truth for an anonymous visitor.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

export async function GET(): Promise<Response> {
  const { tenantId, accessToken } = await getSessionContext();

  // Anonymous visitor: no tenant context, so there is no branding to resolve.
  // 204 keeps BrandConfigProvider on DEFAULT_BRAND without logging an auth failure
  // on every public page.
  if (!accessToken) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/tenant/branding`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // The caller cannot choose the tenant: the id comes from the session's own
        // JWT claim (`getSessionContext`), never from the request. Always sent, as
        // `gatewayFetch` does, so the gateway sees a consistent contract.
        'X-Tenant-ID': tenantId,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        // Branding is per-tenant and changes on publish; the provider keeps its own
        // 5-minute in-memory TTL, so nothing is gained by caching at the edge.
        'cache-control': 'no-store',
      },
    });
  } catch {
    // The gateway being unreachable is exactly the case the provider's fallback
    // exists for. Return 503 rather than throwing a 500 through the route.
    return new NextResponse(null, { status: 503 });
  }
}
