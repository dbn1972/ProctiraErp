'use client';

/**
 * BrandConfigProvider — Tenant branding context (Design Section M, Requirement 43)
 *
 * Owns the tenant brand configuration (name, short name, logo, favicon, colors,
 * login background) and exposes it via the `useBrand()` hook so no component
 * source ever has to mention a literal brand string.
 *
 * Behaviors (Design §M):
 *
 *   1. **Boot-time fetch.** On first mount the provider calls
 *      `GET /api/v1/tenant/branding`. The response is cached in a module-level
 *      Map for 5 minutes (TTL). A fresh tab on the same browser within the
 *      TTL window reuses the cached value without a round-trip.
 *
 *   2. **CSS variable injection.** The resolved brand is written to
 *      `document.documentElement.style` as the `--tenant-name`,
 *      `--tenant-shortName`, `--tenant-primary`, `--tenant-accent`,
 *      `--tenant-logo`, `--tenant-favicon`, and `--tenant-login-bg` custom
 *      properties so any component can `bg-[--tenant-primary]` /
 *      `text-[--tenant-name]` without touching the brand object directly
 *      (Requirement 43.2, 43.4).
 *
 *   3. **Safe defaults.** When the API is unreachable the provider falls back
 *      to the canonical `ProctiraERP` brand baked into the bundle so public
 *      marketing screens always render (Requirement 43.4).
 *
 *   4. **SSR-safe.** All `window`, `document`, and `fetch` access is gated
 *      by `typeof window !== 'undefined'` and runs from `useEffect`, so the
 *      provider can be rendered from a Next.js Server Component layout.
 *
 *   5. **`useBrand()` hook.** Returns `{ brand, loading, error, refresh }`
 *      with `brand` exposing both the canonical token names
 *      (`primary_color`, `accent_color`, `login_background`,
 *      `document_title_template`) used by Design §M and convenience aliases
 *      (`primary`, `accent`, `logoUrl`, `faviconUrl`, `loginBg`) used by
 *      Task 57.2.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The full tenant brand contract. Field names use snake_case for the
 * server-aligned shape (Design §M) and camelCase aliases that 57.2 consumes.
 */
export interface Brand {
  /** Brand display name, e.g., "ProctiraERP" or "EduZo". */
  name: string;
  /**
   * Short, lowercase identifier used for storage keys and the
   * `--tenant-shortName` CSS variable. Mirrors the brand's slug for
   * tenants that have not configured a separate short name.
   */
  shortName: string;
  /** Lowercase identifier used in storage keys (kept for backward compat). */
  slug: string;
  /** Logo asset (URL + alt text). */
  logo: { url: string; alt: string };
  /** Favicon URL. */
  favicon: string;
  /** Primary color (hsl/hex) injected as `--tenant-primary`. */
  primary_color: string;
  /** Accent color injected as `--tenant-accent`. */
  accent_color: string;
  /** Login background image URL or CSS gradient injected as `--tenant-login-bg`. */
  login_background: string;
  /** Document title template, e.g., `"{page} | {brand}"` (Task 57.2). */
  document_title_template: string;
}

export interface BrandConfigContextValue {
  /** The currently resolved tenant brand. */
  brand: Brand;
  /** True while the boot-time fetch is in flight. */
  loading: boolean;
  /** Last fetch error (if any); `null` once a successful fetch has populated. */
  error: Error | null;
  /** Force-refresh the brand from the API (bypasses the 5-minute cache). */
  refresh: () => Promise<void>;

  // ─── Flat aliases (Design §M canonical shape, Task 57.2) ─────────────
  //
  // The full `brand` object stays on the context for callers that need
  // every field, but consumers that only want the canonical
  // `{ name, shortName, logoUrl, faviconUrl, primary, accent, document_title_template }`
  // can destructure them directly off `useBrand()`:
  //
  //     const { name, primary, document_title_template } = useBrand();
  //

  /** Brand display name. Mirrors `brand.name`. */
  name: string;
  /** Lowercase short identifier. Mirrors `brand.shortName`. */
  shortName: string;
  /** Logo asset URL. Mirrors `brand.logo.url`. */
  logoUrl: string;
  /** Favicon URL. Mirrors `brand.favicon`. */
  faviconUrl: string;
  /** Primary brand color. Mirrors `brand.primary_color`. */
  primary: string;
  /** Accent brand color. Mirrors `brand.accent_color`. */
  accent: string;
  /** Document title template, e.g. `"{page} | {brand}"`. */
  document_title_template: string;
}

/** Optional fetcher abstraction so tests can swap in their own implementation. */
export type BrandFetcher = () => Promise<Brand>;

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Canonical ProctiraERP default. Used when the `/api/v1/tenant/branding`
 * endpoint is unreachable or returns a malformed payload (Requirement 43.4).
 */
export const DEFAULT_BRAND: Brand = {
  name: 'ProctiraERP',
  shortName: 'proctira',
  slug: 'proctira',
  logo: { url: '/logo.svg', alt: 'ProctiraERP' },
  favicon: '/favicon.ico',
  primary_color: 'hsl(222, 47%, 31%)',
  accent_color: 'hsl(174, 62%, 40%)',
  login_background: 'linear-gradient(135deg, hsl(222, 47%, 22%), hsl(222, 47%, 40%))',
  document_title_template: '{page} | {brand}',
};

/** TTL for the module-level brand cache, in milliseconds. (5 minutes.) */
export const BRAND_CACHE_TTL_MS = 5 * 60 * 1000;

/** Endpoint the provider hits at boot (Design §M, Task 57.1). */
export const BRAND_ENDPOINT = '/api/v1/tenant/branding';

// ─── Module-level cache (Task 57.1: cached for 5 minutes) ────────────────────

interface CacheEntry {
  brand: Brand;
  expiresAt: number;
}

let _brandCache: CacheEntry | null = null;
let _inFlight: Promise<Brand> | null = null;

/** Test-only: drop the cached brand so the next fetch hits the network. */
export function clearBrandCache(): void {
  _brandCache = null;
  _inFlight = null;
}

/** Test-only: read the current cache entry. */
export function _peekBrandCache(): CacheEntry | null {
  return _brandCache;
}

// ─── SSR-safe helpers ────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Inject the seven `--tenant-*` CSS custom properties onto `:root` via
 * `document.documentElement.style`. SSR-safe: no-ops on the server.
 *
 * Requirement 43.2 — variables flowed through Tailwind v4 classes never
 * embed brand strings in component source.
 *
 * **Reconciliation with the SSR baseline (Task 58.1).** When the Next.js
 * Server Component layout renders a `<style data-tenant-theme="ssr">` block
 * at first paint, those `--tenant-*` values are visible via
 * `getComputedStyle(:root)` once the document is parsed. To avoid a redundant
 * second write (and the layout-shift / repaint that comes with it), we ONLY
 * call `setProperty` when the resolved-on-the-element value differs from
 * what we are about to write. This makes the common case — CDN cache and
 * Theme Service agree — a true zero-paint hydration.
 */
export function injectBrandCSSVariables(brand: Brand): void {
  if (!isBrowser()) return;
  const root = document.documentElement;
  const computed = window.getComputedStyle(root);

  // Strings are wrapped in single quotes so e.g. `content: var(--tenant-name)`
  // works in CSS rules without further escaping.
  const desired: Record<string, string> = {
    '--tenant-name': `'${escapeForCss(brand.name)}'`,
    '--tenant-shortName': `'${escapeForCss(brand.shortName)}'`,
    '--tenant-primary': brand.primary_color,
    '--tenant-accent': brand.accent_color,
    '--tenant-logo': `url("${brand.logo.url}")`,
    '--tenant-favicon': `url("${brand.favicon}")`,
    '--tenant-login-bg': brand.login_background,
  };

  for (const [name, value] of Object.entries(desired)) {
    // `getPropertyValue` returns the resolved string from any cascade
    // source (the inline `style` attribute *and* the SSR-injected
    // `<style data-tenant-theme>` block), normalized with leading
    // whitespace stripped. Compare against `value` to skip no-op writes
    // — the common case after a fresh SSR render with an unchanged
    // tenant theme.
    const current = computed.getPropertyValue(name).trim();
    if (current === value.trim()) continue;
    root.style.setProperty(name, value);
  }
}

function escapeForCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── SSR token extraction (Task 58.1) ────────────────────────────────────────

/**
 * Read the SSR-injected `<style data-tenant-theme>` block (rendered by
 * `app/layout.tsx`) and parse its `--tenant-*` declarations back into a
 * partial `Brand` object.
 *
 * Used by `<BrandConfigProvider>` as its initial state when no
 * `initialBrand` prop is supplied — this guarantees that the very first
 * client render reflects the same tokens as the SSR baseline, eliminating
 * the brief default-themed flash that would otherwise occur between
 * hydration and the boot-time `/api/v1/tenant/branding` fetch.
 *
 * Parsing strategy:
 *   1. Locate `document.querySelector('style[data-tenant-theme]')`.
 *   2. Scan its `textContent` for `--tenant-<name>: <value>;` declarations.
 *   3. Unwrap the CSS string conventions used by `renderTenantThemeCSS()`:
 *        - `'…'` → unquoted name (with `\'` un-escaped to `'`).
 *        - `url("…")` → bare URL string.
 *      Other values (colors, gradients) are returned verbatim.
 *   4. Return `null` when the element is absent OR when the parsed result
 *      is missing one of the seven required tokens. Callers fall back to
 *      `DEFAULT_BRAND` in that case.
 *
 * SSR-safe: returns `null` immediately when `document` is not available.
 */
export function extractTenantTokensFromHead(): Brand | null {
  if (!isBrowser()) return null;
  const styleEl = document.querySelector('style[data-tenant-theme]');
  if (!styleEl) return null;
  const css = styleEl.textContent ?? '';
  if (css.length === 0) return null;

  const tokens = parseTenantCssTokens(css);
  return tokensToBrand(tokens);
}

/**
 * Parse `--tenant-*` declarations out of a CSS string. Exported for
 * testing — production callers should use `extractTenantTokensFromHead()`.
 */
export function parseTenantCssTokens(css: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match `--tenant-<name>: <value>;` declarations. `<value>` is captured
  // up to the next `;` so multi-line gradients / url() values still parse.
  const re = /--tenant-([a-zA-Z-]+)\s*:\s*([^;]+?)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const key = m[1];
    const value = m[2];
    if (key && value !== undefined) result[key] = value.trim();
  }
  return result;
}

/**
 * Reverse of `brandToTenantTokens` (server) + `injectBrandCSSVariables`
 * (client). Returns `null` if any required token is missing so the
 * provider can fall back to `DEFAULT_BRAND`.
 */
function tokensToBrand(tokens: Record<string, string>): Brand | null {
  const required = [
    'name',
    'shortName',
    'primary',
    'accent',
    'logo',
    'favicon',
    'login-bg',
  ] as const;
  for (const key of required) {
    if (typeof tokens[key] !== 'string' || tokens[key].length === 0) {
      return null;
    }
  }

  const name = unquoteCssString(tokens['name']!);
  const shortName = unquoteCssString(tokens['shortName']!);
  const logoUrl = unwrapCssUrl(tokens['logo']!);
  const faviconUrl = unwrapCssUrl(tokens['favicon']!);

  return {
    name,
    shortName,
    slug: shortName,
    logo: { url: logoUrl, alt: name },
    favicon: faviconUrl,
    primary_color: tokens['primary']!,
    accent_color: tokens['accent']!,
    login_background: tokens['login-bg']!,
    document_title_template: DEFAULT_BRAND.document_title_template,
  };
}

/**
 * Strip the surrounding single quotes from a CSS string token, undoing
 * the `\'` and `\\` escapes applied by `renderTenantThemeCSS()`.
 */
function unquoteCssString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return trimmed;
}

/**
 * Pull the URL out of `url("…")` / `url('…')` / `url(…)`. Returns the
 * raw value untouched if the wrapper is not present.
 */
function unwrapCssUrl(value: string): string {
  const trimmed = value.trim();
  const match = /^url\(\s*(['"]?)([^)'"]*)\1\s*\)$/.exec(trimmed);
  return match ? match[2]! : trimmed;
}

// ─── Brand response normalization ────────────────────────────────────────────

/**
 * The `/api/v1/tenant/branding` endpoint may return either the canonical
 * `Brand` shape or the backend-aligned shape used by `BrandingConfigSchema`
 * (`organizationName`, `logoUrl`, `primaryColor`, …). We accept both and
 * coerce the result into our internal `Brand`.
 */
export function normalizeBrandResponse(payload: unknown): Brand {
  if (!payload || typeof payload !== 'object') return DEFAULT_BRAND;
  const p = payload as Record<string, unknown>;

  const name =
    pickString(p, ['name', 'organizationName', 'brand_name', 'brandName']) ?? DEFAULT_BRAND.name;
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
  const favicon = pickString(p, ['favicon', 'faviconUrl', 'favicon_url']) ?? DEFAULT_BRAND.favicon;
  const primary_color =
    pickString(p, ['primary_color', 'primaryColor', 'primary']) ?? DEFAULT_BRAND.primary_color;
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

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

// ─── Default fetcher ─────────────────────────────────────────────────────────

/**
 * Default fetcher: hits `/api/v1/tenant/branding`. Falls back to
 * `DEFAULT_BRAND` on any network/parse error so the UI keeps rendering.
 *
 * Returns the *normalized* `Brand`, never throws — the provider relies on
 * this contract to keep public marketing screens visible even when the
 * gateway is offline.
 */
export async function defaultBrandFetcher(): Promise<Brand> {
  if (!isBrowser()) return DEFAULT_BRAND;
  try {
    const response = await fetch(BRAND_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return DEFAULT_BRAND;
    const payload = (await response.json()) as unknown;
    return normalizeBrandResponse(payload);
  } catch {
    return DEFAULT_BRAND;
  }
}

/**
 * Cached brand fetch. Honors a 5-minute module-level TTL and de-dupes
 * concurrent in-flight requests so two providers mounting at the same time
 * only trigger one network round-trip.
 *
 * @param fetcher the underlying fetcher (defaults to `defaultBrandFetcher`).
 * @param force when true, bypass the cache.
 */
export async function fetchBrandCached(
  fetcher: BrandFetcher = defaultBrandFetcher,
  force = false,
): Promise<Brand> {
  const now = Date.now();
  if (!force && _brandCache && _brandCache.expiresAt > now) {
    return _brandCache.brand;
  }
  if (!force && _inFlight) {
    return _inFlight;
  }
  const promise = fetcher()
    .then((brand) => {
      _brandCache = { brand, expiresAt: Date.now() + BRAND_CACHE_TTL_MS };
      _inFlight = null;
      return brand;
    })
    .catch((err) => {
      _inFlight = null;
      throw err;
    });
  _inFlight = promise;
  return promise;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const BrandConfigContext = createContext<BrandConfigContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface BrandConfigProviderProps {
  children: React.ReactNode;
  /**
   * Override the initial brand. When provided, the boot-time fetch is
   * skipped — useful for tests and Storybook.
   */
  initialBrand?: Brand;
  /**
   * Optional override for the underlying fetcher. Defaults to
   * `defaultBrandFetcher` which hits `/api/v1/tenant/branding`.
   */
  fetcher?: BrandFetcher;
}

export function BrandConfigProvider({ children, initialBrand, fetcher }: BrandConfigProviderProps) {
  // ─── Initial brand resolution (Task 58.1) ───────────────────────────────
  //
  // Priority for the FIRST client render:
  //
  //   1. `initialBrand` prop      — explicit override (tests, Storybook).
  //   2. SSR `<style data-tenant-theme>` — read back the tokens that
  //      `app/layout.tsx` injected at request time. This makes the first
  //      hydrated render match the server-painted CSS variables exactly,
  //      so the user never sees the canonical ProctiraERP defaults flash on
  //      a tenant-branded page.
  //   3. `DEFAULT_BRAND`          — pre-bundled ProctiraERP fallback used by
  //      tests and any caller that mounts the provider outside of the
  //      Next.js layout (e.g., the Vite host shell).
  //
  // The boot-time fetch still runs after mount to reconcile against the
  // latest published tokens (handles CDN cache drift mid-session).
  const ssrBrand = initialBrand ?? extractTenantTokensFromHead();
  const initialResolved: Brand = ssrBrand ?? DEFAULT_BRAND;

  const [brand, setBrand] = useState<Brand>(initialResolved);
  const [loading, setLoading] = useState<boolean>(!initialBrand);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef<BrandFetcher>(fetcher ?? defaultBrandFetcher);
  fetcherRef.current = fetcher ?? defaultBrandFetcher;

  const applyBrand = useCallback((next: Brand) => {
    setBrand(next);
    injectBrandCSSVariables(next);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isBrowser()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchBrandCached(fetcherRef.current, /* force */ true);
      applyBrand(next);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Failed to load brand config');
      setError(wrapped);
      // Even on failure we still render the safe default (Requirement 43.4).
      applyBrand(DEFAULT_BRAND);
    } finally {
      setLoading(false);
    }
  }, [applyBrand]);

  // Boot: inject defaults so the first paint is branded, then resolve the
  // real brand from the API (cached for 5 minutes module-wide).
  useEffect(() => {
    // Always paint the current brand variables (even when initialBrand is set).
    injectBrandCSSVariables(brand);

    if (initialBrand) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const next = await fetchBrandCached(fetcherRef.current);
        if (cancelled) return;
        applyBrand(next);
      } catch (err) {
        if (cancelled) return;
        const wrapped = err instanceof Error ? err : new Error('Failed to load brand config');
        setError(wrapped);
        applyBrand(DEFAULT_BRAND);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The fetcher is held in a ref so we intentionally only run this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<BrandConfigContextValue>(
    () => ({
      brand,
      loading,
      error,
      refresh,
      // Flat aliases — Design §M canonical shape (Task 57.2). Surfaced on
      // the context value so consumers never have to dig into nested
      // fields like `brand.logo.url` or `brand.primary_color`.
      name: brand.name,
      shortName: brand.shortName,
      logoUrl: brand.logo.url,
      faviconUrl: brand.favicon,
      primary: brand.primary_color,
      accent: brand.accent_color,
      document_title_template: brand.document_title_template,
    }),
    [brand, loading, error, refresh],
  );

  return <BrandConfigContext.Provider value={value}>{children}</BrandConfigContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the current tenant brand configuration.
 *
 * Returns both the full `brand` object and the canonical Design §M shape
 * as flat aliases for ergonomic destructuring (Task 57.2):
 *
 * ```tsx
 * const {
 *   brand,                     // the full Brand object
 *   loading, error, refresh,
 *   name, shortName,           // brand.name / brand.shortName
 *   logoUrl, faviconUrl,       // brand.logo.url / brand.favicon
 *   primary, accent,           // brand.primary_color / brand.accent_color
 *   document_title_template,   // brand.document_title_template
 * } = useBrand();
 * ```
 *
 * Must be used within a `<BrandConfigProvider>`.
 */
export function useBrand(): BrandConfigContextValue {
  const context = useContext(BrandConfigContext);
  if (context === undefined) {
    throw new Error('useBrand must be used within a <BrandConfigProvider>');
  }
  return context;
}

/**
 * Optional brand access for providers that must stay mountable outside
 * `<BrandConfigProvider>` (Storybook, isolated unit tests). Always calls
 * `useContext` unconditionally so hooks rules stay satisfied.
 */
export function useOptionalBrand(): BrandConfigContextValue | undefined {
  return useContext(BrandConfigContext);
}
