/**
 * UATENV-D22: public brand for the signed-in session's own tenant.
 *
 * Bursar, registrar, warden, librarian, nurse and other roles get 403 from the gateway's
 * tenant branding, so their sidebar card and header showed the product name. The
 * `/api/v1/tenant/branding` route then calls this helper, which reads the public brand
 * subset (`PUBLISHED_THEME_PATH`, no role grant, PRC-M132) with the inbound Host and
 * `?slug=` set to the session's `tenant_slug` claim. The gateway answers 404 when the
 * Host's tenant is not that slug, and the returned `slug` is checked again here. A session
 * on another tenant's host (UATENV-D09) therefore gets `null` and keeps the product default
 * instead of the Host tenant's name.
 *
 * Server-only (node:http transport).
 */
import { GATEWAY_BASE_URL } from '@/lib/api/gateway';
import { decodeJwtPayload } from '@/lib/auth/jwt-payload';

import {
  PUBLISHED_THEME_PATH,
  hostRoutedGet,
  normalizeRequestHost,
  type HostRoutedTransport,
} from './server';

const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Definitive answers are kept this long: every call comes from the web pod's one IP. */
export const SESSION_PUBLIC_BRAND_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { body: string | null; expiresAt: number }>();

/** Test seam: empties the cache. */
export function clearSessionPublicBrandCache(): void {
  cache.clear();
}

/** The session's own tenant slug (Keycloak `tenant_slug`), single-valued only. */
export function sessionTenantSlug(accessToken: string): string | null {
  const claims = decodeJwtPayload<Record<string, unknown>>(accessToken);
  const raw = claims?.['tenant_slug'] ?? claims?.['tenantSlug'];
  const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return TENANT_SLUG_PATTERN.test(slug) ? slug : null;
}

/**
 * Returns the public brand JSON when the Host's tenant is the session's tenant, `null` when
 * it does not apply (no slug claim, no usable Host, 404 or a slug mismatch). Throws on 429,
 * 5xx, transport or parse failure, so the caller answers 503 and nothing is cached.
 */
export async function fetchSessionPublicBrand(
  accessToken: string,
  requestHost: string | null | undefined,
  transport: HostRoutedTransport = hostRoutedGet,
): Promise<string | null> {
  const slug = sessionTenantSlug(accessToken);
  const host = normalizeRequestHost(requestHost);
  if (!slug || !host) return null;

  const cacheKey = `${host}|${slug}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.body;

  const url = `${GATEWAY_BASE_URL}${PUBLISHED_THEME_PATH}?slug=${encodeURIComponent(slug)}`;
  const response = await transport(url, host);
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`public branding answered HTTP ${response.status}`);
  }
  let body: string | null = null;
  if (response.status === 200) {
    const payload = JSON.parse(response.body) as { slug?: unknown } | null;
    if (typeof payload?.slug === 'string' && payload.slug.toLowerCase() === slug) {
      body = JSON.stringify(payload);
    }
  }
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(cacheKey, { body, expiresAt: now + SESSION_PUBLIC_BRAND_TTL_MS });
  return body;
}
