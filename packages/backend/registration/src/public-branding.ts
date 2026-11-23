/**
 * PRC-M132: public, Host-resolved tenant branding for SSR first paint.
 *
 * Served on the public registration surface (`GET /registrations/branding`) because that is the
 * gateway's only unauthenticated surface whose tenant comes exclusively from the request Host
 * through the verified host mapping (`PublicTenantResolver`). Only an allow-listed brand subset
 * is ever returned: display name, logo URL, favicon URL and the two colour tokens.
 */
import type { FastifyInstance } from 'fastify';

/** Branding facts the public endpoint is allowed to see. */
export interface PublicBrandingRecord {
  slug: string;
  name: string;
  tokens: Record<string, unknown> | null;
}

/** Reads a tenant's published branding (tenant id comes from the verified Host only). */
export type PublicBrandingSource = (tenantId: string) => Promise<PublicBrandingRecord | null>;

/** The allow-listed response. */
export interface PublicBrandingResponse {
  slug: string;
  name: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

const MAX_VALUE_LENGTH = 2048;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN_COLOR = /^(?:hsla?|rgba?)\(\s*[0-9.,%\s/]+\)$/i;
const HSL_TRIPLE = /^\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%$/;

function tokenString(tokens: Record<string, unknown> | null, key: string): string | undefined {
  const value = tokens?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_VALUE_LENGTH ? trimmed : undefined;
}

/** `url("...")` or a bare URL -> an https URL or a site-relative path; anything else dropped. */
function safeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = /^url\(\s*(.*?)\s*\)$/i.exec(raw);
  const inner = (match?.[1] ?? raw).trim().replace(/^["']|["']$/g, '');
  if (!inner || /["'()<>\s\\]/.test(inner)) return undefined;
  if (inner.startsWith('/') && !inner.startsWith('//')) return inner;
  try {
    return new URL(inner).protocol === 'https:' ? inner : undefined;
  } catch {
    return undefined;
  }
}

function safeColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return HEX_COLOR.test(raw) || FN_COLOR.test(raw) || HSL_TRIPLE.test(raw) ? raw : undefined;
}

/** Project a branding record onto the public allow-list. */
export function toPublicBranding(record: PublicBrandingRecord): PublicBrandingResponse {
  const response: PublicBrandingResponse = { slug: record.slug, name: record.name };
  const logoUrl = safeUrl(tokenString(record.tokens, '--tenant-logo'));
  const faviconUrl = safeUrl(tokenString(record.tokens, '--tenant-favicon'));
  const primaryColor = safeColor(tokenString(record.tokens, '--tenant-primary'));
  const accentColor = safeColor(tokenString(record.tokens, '--tenant-accent'));
  if (logoUrl) response.logoUrl = logoUrl;
  if (faviconUrl) response.faviconUrl = faviconUrl;
  if (primaryColor) response.primaryColor = primaryColor;
  if (accentColor) response.accentColor = accentColor;
  return response;
}

/** Structural view of the gateway's root `tenantService` decorator (no package edge). */
interface TenantBrandingReader {
  getTenantById(id: string): Promise<{
    slug: string;
    name: string;
    config?: { branding?: { organizationName?: unknown } };
  }>;
  getActiveBranding(id: string): Promise<{ tokens: Record<string, unknown> | null }>;
}

/**
 * Default source: the lifecycle `tenantService` decorated on the gateway root. Resolved lazily
 * per request; when absent the endpoint answers 404 (fail closed).
 */
export function brandingSourceFromDecorator(fastify: FastifyInstance): PublicBrandingSource {
  return async (tenantId) => {
    const reader = (fastify as unknown as { tenantService?: TenantBrandingReader }).tenantService;
    if (!reader || typeof reader.getActiveBranding !== 'function') return null;
    try {
      const tenant = await reader.getTenantById(tenantId);
      const active = await reader.getActiveBranding(tenantId);
      const orgName = tenant.config?.branding?.organizationName;
      return {
        slug: tenant.slug,
        name: typeof orgName === 'string' && orgName.trim() ? orgName.trim() : tenant.name,
        tokens: active.tokens ?? null,
      };
    } catch {
      return null;
    }
  };
}
