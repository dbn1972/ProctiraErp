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
 *
 * ## Tenant resolution
 *
 * The tenant comes from the access-token cookie's own `tenantId` claim and from
 * nowhere else. This route deliberately does **not** use `getSessionContext()`, which
 * falls back to the inbound `X-Tenant-ID` header and then to the literal `'default'`:
 * the middleware returns early for `/api` paths, so that header is whatever the client
 * sent. The gateway rejects an authenticated request that carries a client-supplied
 * tenant header, so forwarding one would only turn a resolvable request into a
 * confusing 4xx — and it would make the security property here depend on the
 * gateway's check instead of on this route.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';
import { AUTH_COOKIES, decodeTokenPayload } from '@/lib/auth';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;

  // Anonymous visitor: no tenant context, so there is no branding to resolve.
  // 204 keeps BrandConfigProvider on DEFAULT_BRAND without logging an auth failure
  // on every public page.
  if (!accessToken) {
    return new NextResponse(null, { status: 204 });
  }

  const tenantId = decodeTokenPayload(accessToken)?.tenantId ?? null;

  try {
    const upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/tenant/branding`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Only ever the session's own claim. Omitted when the token carries none,
        // rather than substituted with a header value or a placeholder.
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
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
  } catch (error) {
    // The gateway being unreachable is exactly the case the provider's fallback
    // exists for. Return 503 rather than throwing a 500 through the route.
    //
    // Log it, though: the provider is silent by design, so a swallowed 503 here is
    // the difference between "the gateway is down" and "branding is misconfigured"
    // and nothing else in the request will say which.
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
    console.error(
      `[api/v1/tenant/branding] upstream request to ${GATEWAY_BASE_URL} failed:`,
      error instanceof Error ? error.message : error,
      // `fetch failed` on its own is unactionable; the cause carries the DNS/TLS/
      // connect detail that says which of the three went wrong.
      cause?.message ?? '',
    );
    return new NextResponse(null, { status: 503 });
  }
}
