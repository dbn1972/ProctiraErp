/**
 * Server-side tenant theme helper — Task 58.1 / Requirement 28.1, 28.10
 *
 * Resolves the *published* tenant theme tokens at request time so the SSR
 * head can emit a `<style data-tenant-theme>` block. This guarantees the
 * very first paint already carries the tenant's brand colors, logo, login
 * background, and favicon — no flash of default styling while the client
 * bundle hydrates.
 *
 * Boot sequence (Design §N):
 *
 *   1. **SSR baseline.**   `getPublishedTenantTheme(slug)` is called from
 *      `app/layout.tsx` (Server Component) which renders
 *      `renderTenantThemeStyle()` into the `<head>` as
 *      `<style data-tenant-theme>:root { --tenant-* }</style>`.
 *
 *   2. **CSS variables.**  Tailwind v4 classes (`bg-[--tenant-primary]`,
 *      `bg-[image:var(--tenant-logo)]`, etc.) consume those tokens so the
 *      first paint is fully branded.
 *
 *   3. **Hydration reconciliation.** On hydration `<BrandConfigProvider>`
 *      reads the same `--tenant-*` properties off `:root` and only
 *      overwrites the ones whose value differs from the SSR-injected
 *      string. This avoids a duplicate write/repaint when the CDN-cached
 *      payload still matches the just-rendered SSR response.
 *
 *   4. **5-minute refresh.** `<BrandConfigProvider>` keeps a 5-minute cache
 *      and refetches `/api/v1/tenant/branding` so that mid-session theme
 *      publishes propagate without requiring a hard reload.
 *
 * Tenant resolution:
 *   - Prefer the host subdomain (e.g. `ministry-edu.proctira.org` →
 *     `ministry-edu`) which the middleware also resolves via
 *     `resolveTenantFromSubdomain`.
 *   - Fall back to the `X-Tenant-ID` request header (set by the middleware
 *     and respected by every gateway client).
 *   - Default to `default` so that local development and the public
 *     marketing site still render the canonical ProctiraERP theme.
 *
 * Caching:
 *   - In-memory module-level cache, keyed by tenant slug, with a 60-second
 *     TTL. Sized small (per-process) so that a request burst doesn't
 *     stampede the Theme Service.
 */

import type { Brand } from '@/providers/BrandConfigProvider';

// NOTE: `BrandConfigProvider` is a `'use client'` module, so its *runtime*
// exports (DEFAULT_BRAND, normalizeBrandResponse) become client-reference
// proxies when imported into this server module — accessing their fields from a
// Server Component throws ("cannot dot into a client module"). We therefore keep
// server-local copies here and import only the erasable `Brand` *type* above.

/** Canonical fallback brand (server-side copy of the client DEFAULT_BRAND). */
const DEFAULT_BRAND: Brand = {
  name: 'ProctiraERP',
  shortName: 'proctira',
  slug: 'proctira',
  logo: { url: '/logo.svg', alt: 'ProctiraERP' },
  favicon: '/favicon.ico',
  primary_color: 'hsl(222, 47%, 31%)',
  accent_color: 'hsl(174, 62%, 40%)',
  login_background:
    'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
  document_title_template: '{page} | {brand}',
};

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Server-side copy of the client `normalizeBrandResponse`. */
function normalizeBrandResponse(payload: unknown): Brand {
  if (!payload || typeof payload !== 'object') return DEFAULT_BRAND;
  const p = payload as Record<string, unknown>;

  const name =
    pickString(p, ['name', 'organizationName', 'brand_name', 'brandName']) ??
    DEFAULT_BRAND.name;
  const shortName =
    pickString(p, ['shortName', 'short_name']) ??
    pickString(p, ['slug']) ??
    name.toLowerCase().replace(/\s+/g, '-');
  const slug = pickString(p, ['slug']) ?? shortName;
  const logoUrl =
    pickString(p, ['logoUrl', 'logo_url']) ??
    (typeof p['logo'] === 'object' && p['logo'] !== null
      ? pickString(p['logo'] as Record<string, unknown>, ['url'])
      : undefined) ??
    DEFAULT_BRAND.logo.url;
  const logoAlt =
    (typeof p['logo'] === 'object' && p['logo'] !== null
      ? pickString(p['logo'] as Record<string, unknown>, ['alt'])
      : undefined) ?? name;
  const favicon =
    pickString(p, ['favicon', 'faviconUrl', 'favicon_url']) ??
    DEFAULT_BRAND.favicon;
  const primary_color =
    pickString(p, ['primary_color', 'primaryColor', 'primary']) ??
    DEFAULT_BRAND.primary_color;
  const accent_color =
    pickString(p, ['accent_color', 'accentColor', 'accent', 'secondaryColor']) ??
    DEFAULT_BRAND.accent_color;
  const login_background =
    pickString(p, ['login_background', 'loginBackground', 'loginBg', 'login_bg']) ??
    DEFAULT_BRAND.login_background;
  const document_title_template =
    pickString(p, ['document_title_template', 'documentTitleTemplate']) ??
    DEFAULT_BRAND.document_title_template;

  return {
    name,
    shortName,
    slug,
    logo: { url: logoUrl, alt: logoAlt },
    favicon,
    primary_color,
    accent_color,
    login_background,
    document_title_template,
  };
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** The Theme Service published-theme endpoint (relative to the gateway). */
export const PUBLISHED_THEME_PATH = '/api/v1/tenant/theme/published';

/** TTL for the SSR-side tenant-theme cache (60 seconds). */
export const SSR_THEME_CACHE_TTL_MS = 60 * 1000;

/** Base URL for outbound calls to the Theme Service via the API gateway. */
function getGatewayBaseUrl(): string {
  return (
    process.env['NEXT_PUBLIC_GATEWAY_URL'] ??
    process.env['GATEWAY_URL'] ??
    'http://localhost:3000'
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The seven tenant-theme CSS custom properties rendered into the SSR
 * `<style data-tenant-theme>` block. They mirror the `--tenant-*`
 * properties written by `injectBrandCSSVariables()` on the client, so the
 * SSR baseline and the hydrated runtime stay in sync.
 *
 * Naming matches Task 57.1 / Requirement 43.4 exactly.
 */
export interface TenantThemeTokens {
  /** Tenant display name, single-quoted CSS string. */
  name: string;
  /** Lowercase tenant short name, single-quoted CSS string. */
  shortName: string;
  /** Primary brand color (HSL or hex). */
  primary: string;
  /** Accent brand color (HSL or hex). */
  accent: string;
  /** Logo URL — wrapped in CSS `url("...")`. */
  logo: string;
  /** Favicon URL — wrapped in CSS `url("...")`. */
  favicon: string;
  /** Login background image/gradient. */
  loginBackground: string;
}

/** Result returned by `getPublishedTenantTheme`. */
export interface PublishedTenantTheme {
  tenantSlug: string;
  tokens: TenantThemeTokens;
  /** Source brand object, kept for callers that need the raw fields. */
  brand: Brand;
  /** True when the theme came from the in-memory cache. */
  fromCache: boolean;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  tokens: TenantThemeTokens;
  brand: Brand;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Test-only: drop the SSR cache so the next call refetches. */
export function clearSSRThemeCache(): void {
  _cache.clear();
}

// ─── Token derivation ─────────────────────────────────────────────────────────

/**
 * Convert a `Brand` into the seven `--tenant-*` token strings, applying the
 * same CSS escaping rules as `injectBrandCSSVariables()` so the SSR
 * baseline and the client runtime emit identical values.
 */
export function brandToTenantTokens(brand: Brand): TenantThemeTokens {
  // Be resilient to a partial/empty brand object: the SSR head must always
  // render *some* branded baseline (see module contract), so every field falls
  // back to the canonical default rather than throwing on a missing value.
  const b = (brand ?? {}) as Partial<Brand>;
  return {
    name: `'${escapeCss(b.name ?? DEFAULT_BRAND.name)}'`,
    shortName: `'${escapeCss(b.shortName ?? DEFAULT_BRAND.shortName)}'`,
    primary: b.primary_color ?? DEFAULT_BRAND.primary_color,
    accent: b.accent_color ?? DEFAULT_BRAND.accent_color,
    logo: `url("${b.logo?.url ?? DEFAULT_BRAND.logo.url}")`,
    favicon: `url("${b.favicon ?? DEFAULT_BRAND.favicon}")`,
    loginBackground: b.login_background ?? DEFAULT_BRAND.login_background,
  };
}

function escapeCss(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Test seam: lets unit tests inject a fake fetcher that resolves to the
 * normalized `Brand`. In production this is `fetchPublishedThemeFromGateway`.
 */
export type PublishedThemeFetcher = (
  tenantSlug: string,
) => Promise<Brand>;

/**
 * Default fetcher: GETs `/api/v1/tenant/theme/published` from the API
 * gateway, forwarding `X-Tenant-ID: <slug>` so the gateway can route to
 * the correct tenant. Returns `DEFAULT_BRAND` on any non-2xx, network
 * error, or malformed payload — the SSR head must always render *some*
 * branded baseline, even when the Theme Service is unreachable.
 */
export async function fetchPublishedThemeFromGateway(
  tenantSlug: string,
): Promise<Brand> {
  const url = `${getGatewayBaseUrl()}${PUBLISHED_THEME_PATH}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Tenant-ID': tenantSlug,
      },
      // Next.js fetch caching: tag so we can revalidate via tag if needed,
      // and keep the upstream-side TTL aligned with our in-memory cache.
      next: { revalidate: 60, tags: [`tenant-theme:${tenantSlug}`] },
    } as RequestInit);
    if (!response.ok) return DEFAULT_BRAND;
    const payload = (await response.json()) as unknown;
    return normalizeBrandResponse(payload);
  } catch {
    return DEFAULT_BRAND;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the published theme tokens for the given tenant slug. Hits the
 * Theme Service the first time and on cache miss/expiry; subsequent calls
 * within 60 seconds reuse the cached entry so a request burst (e.g., a
 * dashboard that fans out into many parallel server components) does not
 * stampede the upstream service.
 *
 * Always succeeds — falls back to the canonical ProctiraERP brand on any
 * error so the SSR head still renders a valid `<style data-tenant-theme>`
 * block.
 *
 * @param tenantSlug   Tenant identifier resolved from subdomain or
 *                     `X-Tenant-ID` header.
 * @param fetcher      Optional override (for tests).
 */
export async function getPublishedTenantTheme(
  tenantSlug: string,
  fetcher: PublishedThemeFetcher = fetchPublishedThemeFromGateway,
): Promise<PublishedTenantTheme> {
  const slug = (tenantSlug || 'default').toLowerCase();
  const now = Date.now();

  const cached = _cache.get(slug);
  if (cached && cached.expiresAt > now) {
    return {
      tenantSlug: slug,
      tokens: cached.tokens,
      brand: cached.brand,
      fromCache: true,
    };
  }

  let brand: Brand;
  try {
    brand = await fetcher(slug);
  } catch {
    brand = DEFAULT_BRAND;
  }
  const tokens = brandToTenantTokens(brand);

  _cache.set(slug, {
    tokens,
    brand,
    expiresAt: now + SSR_THEME_CACHE_TTL_MS,
  });

  return { tenantSlug: slug, tokens, brand, fromCache: false };
}

/**
 * Resolve the tenant slug for the current request. Used by `app/layout.tsx`
 * to pick the right tenant before injecting the SSR theme block.
 *
 * Source order:
 *   1. The `X-Tenant-Slug` header set by the middleware (preferred — already
 *      reconciled subdomain + header).
 *   2. The `X-Tenant-ID` header set by the middleware.
 *   3. `'default'` — public marketing site / local development.
 *
 * Server-only: relies on `next/headers` which throws when called outside a
 * Server Component / Route Handler.
 */
export async function resolveRequestTenantSlug(
  headerStore: { get(name: string): string | null | undefined },
): Promise<string> {
  const slug =
    headerStore.get('x-tenant-slug') ||
    headerStore.get('x-tenant-id') ||
    'default';
  return String(slug).toLowerCase();
}

// ─── CSS rendering ────────────────────────────────────────────────────────────

/**
 * Render the SSR `<style data-tenant-theme>` block as a *string* CSS body.
 * Called from `app/layout.tsx` and inlined into `<head>` via React's
 * `dangerouslySetInnerHTML` (the content is fully derived from validated
 * tenant config, never user input).
 *
 * The output is structured as:
 *
 *   :root {
 *     --tenant-name: 'EduZo';
 *     --tenant-shortName: 'eduzo';
 *     --tenant-primary: hsl(...);
 *     --tenant-accent: hsl(...);
 *     --tenant-logo: url("...");
 *     --tenant-favicon: url("...");
 *     --tenant-login-bg: linear-gradient(...);
 *   }
 *
 * Note: the CSS variable names match those written by
 * `injectBrandCSSVariables()` on the client (Task 57.1) so the hydration
 * reconciliation in `<BrandConfigProvider>` is a no-op when the CDN has
 * not drifted.
 */
export function renderTenantThemeCSS(tokens: TenantThemeTokens): string {
  // Single-line `:root { ... }` keeps the inline style block compact in the
  // rendered HTML (no whitespace bloat shipped to every visitor) while
  // still being valid CSS.
  return (
    ':root{' +
    `--tenant-name:${tokens.name};` +
    `--tenant-shortName:${tokens.shortName};` +
    `--tenant-primary:${tokens.primary};` +
    `--tenant-accent:${tokens.accent};` +
    `--tenant-logo:${tokens.logo};` +
    `--tenant-favicon:${tokens.favicon};` +
    `--tenant-login-bg:${tokens.loginBackground};` +
    '}'
  );
}

/** The ordered list of CSS variable names rendered by the SSR style block. */
export const TENANT_CSS_VARIABLE_NAMES = [
  '--tenant-name',
  '--tenant-shortName',
  '--tenant-primary',
  '--tenant-accent',
  '--tenant-logo',
  '--tenant-favicon',
  '--tenant-login-bg',
] as const;
