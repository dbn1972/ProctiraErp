/**
 * @vitest-environment jsdom
 *
 * BrandConfigProvider tests — Task 57.1 / Requirement 43
 *
 * Covers:
 *   • Boot-time fetch of `GET /api/v1/tenant/branding` (Design §M, Task 57.1)
 *   • 5-minute module-level cache TTL with timer fakes (Task 57.1)
 *   • CSS custom property injection on `:root` for all 7 `--tenant-*` vars
 *   • Safe `ProctiraERP` defaults when the API fails (Requirement 43.4)
 *   • SSR-safe boot path (initialBrand prop short-circuits the fetch)
 *   • Backend `BrandingConfigSchema` payload shape coercion
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import {
  BrandConfigProvider,
  useBrand,
  DEFAULT_BRAND,
  BRAND_CACHE_TTL_MS,
  BRAND_ENDPOINT,
  clearBrandCache,
  fetchBrandCached,
  injectBrandCSSVariables,
  normalizeBrandResponse,
  extractTenantTokensFromHead,
  parseTenantCssTokens,
  _peekBrandCache,
  type Brand,
} from './BrandConfigProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SAMPLE_BRAND: Brand = {
  name: 'EduZo',
  shortName: 'eduzo',
  slug: 'eduzo',
  logo: { url: 'https://cdn.example.test/eduzo/logo.svg', alt: 'EduZo' },
  favicon: 'https://cdn.example.test/eduzo/favicon.ico',
  primary_color: 'hsl(280, 70%, 45%)',
  accent_color: 'hsl(40, 90%, 55%)',
  login_background: 'linear-gradient(135deg, hsl(280, 70%, 30%), hsl(280, 70%, 50%))',
  document_title_template: '{page} · {brand}',
};

function readTenantVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

function clearTenantVars(): void {
  const root = document.documentElement;
  for (const name of [
    '--tenant-name',
    '--tenant-shortName',
    '--tenant-primary',
    '--tenant-accent',
    '--tenant-logo',
    '--tenant-favicon',
    '--tenant-login-bg',
  ]) {
    root.style.removeProperty(name);
  }
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  clearBrandCache();
  clearTenantVars();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BrandConfigProvider — defaults & contract', () => {
  it('useBrand throws outside of <BrandConfigProvider>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBrand())).toThrow(/within a <BrandConfigProvider>/);
    spy.mockRestore();
  });

  it('exports DEFAULT_BRAND with the canonical ProctiraERP shape', () => {
    expect(DEFAULT_BRAND.name).toBe('ProctiraERP');
    expect(DEFAULT_BRAND.shortName).toBe('proctira');
    expect(DEFAULT_BRAND.slug).toBe('proctira');
    expect(DEFAULT_BRAND.logo.url).toBeTruthy();
    expect(DEFAULT_BRAND.favicon).toBeTruthy();
    expect(DEFAULT_BRAND.primary_color).toBeTruthy();
    expect(DEFAULT_BRAND.accent_color).toBeTruthy();
    expect(DEFAULT_BRAND.login_background).toBeTruthy();
    expect(DEFAULT_BRAND.document_title_template).toContain('{page}');
  });

  it('skips the boot fetch when initialBrand is supplied', async () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider initialBrand={SAMPLE_BRAND} fetcher={fetcher}>
          {children}
        </BrandConfigProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand).toEqual(SAMPLE_BRAND);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('BrandConfigProvider — CSS variable injection (Task 57.1)', () => {
  it('injects all seven --tenant-* custom properties on <html>', () => {
    injectBrandCSSVariables(SAMPLE_BRAND);
    expect(readTenantVar('--tenant-name')).toBe(`'${SAMPLE_BRAND.name}'`);
    expect(readTenantVar('--tenant-shortName')).toBe(`'${SAMPLE_BRAND.shortName}'`);
    expect(readTenantVar('--tenant-primary')).toBe(SAMPLE_BRAND.primary_color);
    expect(readTenantVar('--tenant-accent')).toBe(SAMPLE_BRAND.accent_color);
    expect(readTenantVar('--tenant-logo')).toBe(`url("${SAMPLE_BRAND.logo.url}")`);
    expect(readTenantVar('--tenant-favicon')).toBe(`url("${SAMPLE_BRAND.favicon}")`);
    expect(readTenantVar('--tenant-login-bg')).toBe(SAMPLE_BRAND.login_background);
  });

  it('paints CSS variables on mount when initialBrand is supplied', async () => {
    render(
      <BrandConfigProvider initialBrand={SAMPLE_BRAND}>
        <span>child</span>
      </BrandConfigProvider>,
    );
    await waitFor(() => {
      expect(readTenantVar('--tenant-primary')).toBe(SAMPLE_BRAND.primary_color);
    });
    expect(readTenantVar('--tenant-name')).toBe(`'${SAMPLE_BRAND.name}'`);
  });

  it('escapes single-quotes in brand names so the generated CSS is valid', () => {
    const tricky: Brand = { ...DEFAULT_BRAND, name: "Tom's School", shortName: "tom's" };
    injectBrandCSSVariables(tricky);
    expect(readTenantVar('--tenant-name')).toBe("'Tom\\'s School'");
    expect(readTenantVar('--tenant-shortName')).toBe("'tom\\'s'");
  });
});

describe('BrandConfigProvider — boot-time fetch & cache TTL', () => {
  it('calls the configured fetcher exactly once on first mount', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider fetcher={fetcher}>{children}</BrandConfigProvider>
      ),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.brand).toEqual(SAMPLE_BRAND);
    expect(readTenantVar('--tenant-primary')).toBe(SAMPLE_BRAND.primary_color);
  });

  it('reuses the cached brand within the 5-minute TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);

    // First call: hits the fetcher.
    const a = await fetchBrandCached(fetcher);
    expect(a).toEqual(SAMPLE_BRAND);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call inside the TTL: reuses the cache (no extra fetcher call).
    const b = await fetchBrandCached(fetcher);
    expect(b).toEqual(SAMPLE_BRAND);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 5-minute TTL has elapsed', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);

    await fetchBrandCached(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance just past the cache window.
    vi.setSystemTime(new Date(Date.now() + BRAND_CACHE_TTL_MS + 1));

    await fetchBrandCached(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports the expected TTL constant (exactly 5 minutes)', () => {
    expect(BRAND_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('de-dupes concurrent in-flight fetches', async () => {
    let resolveBrand: (b: Brand) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Brand>((resolve) => {
          resolveBrand = resolve;
        }),
    );

    const a = fetchBrandCached(fetcher);
    const b = fetchBrandCached(fetcher);

    resolveBrand(SAMPLE_BRAND);

    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toEqual(SAMPLE_BRAND);
    expect(resB).toEqual(SAMPLE_BRAND);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refresh() bypasses the cache and re-fetches', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider fetcher={fetcher}>{children}</BrandConfigProvider>
      ),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches the resolved brand after a successful fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    await fetchBrandCached(fetcher);
    const cached = _peekBrandCache();
    expect(cached?.brand).toEqual(SAMPLE_BRAND);
    expect(cached?.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('BrandConfigProvider — fallback when API fails (Requirement 43.4)', () => {
  it('falls back to DEFAULT_BRAND when the fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider fetcher={fetcher}>{children}</BrandConfigProvider>
      ),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand).toEqual(DEFAULT_BRAND);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/network down/);
    // Even on failure the safe defaults are painted onto :root.
    expect(readTenantVar('--tenant-name')).toBe(`'${DEFAULT_BRAND.name}'`);
    expect(readTenantVar('--tenant-primary')).toBe(DEFAULT_BRAND.primary_color);
  });

  it('default fetcher returns DEFAULT_BRAND when global fetch returns non-ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream broken', { status: 503 }),
    );

    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => <BrandConfigProvider>{children}</BrandConfigProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledWith(BRAND_ENDPOINT, expect.any(Object));
    expect(result.current.brand).toEqual(DEFAULT_BRAND);
  });
});

describe('normalizeBrandResponse — accepts both canonical and backend shapes', () => {
  it('coerces the backend BrandingConfigSchema (camelCase) shape', () => {
    const backendPayload = {
      organizationName: 'EduZo Schools',
      logoUrl: 'https://cdn.example.test/eduzo/logo.svg',
      faviconUrl: 'https://cdn.example.test/eduzo/favicon.ico',
      primaryColor: '#003366',
      secondaryColor: '#FFAA00',
    };
    const brand = normalizeBrandResponse(backendPayload);
    expect(brand.name).toBe('EduZo Schools');
    expect(brand.shortName).toBe('eduzo-schools');
    expect(brand.logo.url).toBe('https://cdn.example.test/eduzo/logo.svg');
    expect(brand.favicon).toBe('https://cdn.example.test/eduzo/favicon.ico');
    expect(brand.primary_color).toBe('#003366');
    expect(brand.accent_color).toBe('#FFAA00');
  });

  it('returns DEFAULT_BRAND for non-object payloads', () => {
    expect(normalizeBrandResponse(null)).toEqual(DEFAULT_BRAND);
    expect(normalizeBrandResponse('not-json')).toEqual(DEFAULT_BRAND);
    expect(normalizeBrandResponse(42)).toEqual(DEFAULT_BRAND);
  });

  it('preserves canonical Brand payload as-is', () => {
    const brand = normalizeBrandResponse(SAMPLE_BRAND);
    expect(brand.name).toBe(SAMPLE_BRAND.name);
    expect(brand.shortName).toBe(SAMPLE_BRAND.shortName);
    expect(brand.primary_color).toBe(SAMPLE_BRAND.primary_color);
    expect(brand.document_title_template).toBe(SAMPLE_BRAND.document_title_template);
  });
});

// ─── Task 58.1 — SSR-injected tokens reconciliation ─────────────────────────

/**
 * Build the same `<style data-tenant-theme>` block that the SSR layout
 * emits via `renderTenantThemeCSS()`. Keeping the construction local to
 * the test (rather than importing the server module, which pulls in
 * `next/headers`) keeps the test environment-pure.
 */
function injectSsrThemeStyle(brand: Brand): HTMLStyleElement {
  const css =
    ':root{' +
    `--tenant-name:'${brand.name.replace(/'/g, "\\'")}';` +
    `--tenant-shortName:'${brand.shortName.replace(/'/g, "\\'")}';` +
    `--tenant-primary:${brand.primary_color};` +
    `--tenant-accent:${brand.accent_color};` +
    `--tenant-logo:url("${brand.logo.url}");` +
    `--tenant-favicon:url("${brand.favicon}");` +
    `--tenant-login-bg:${brand.login_background};` +
    '}';
  const style = document.createElement('style');
  style.setAttribute('data-tenant-theme', 'ssr');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function removeSsrThemeStyles(): void {
  document
    .querySelectorAll('style[data-tenant-theme]')
    .forEach((el) => el.remove());
}

describe('parseTenantCssTokens — SSR token parser (Task 58.1)', () => {
  it('returns each --tenant-* declaration keyed by suffix', () => {
    const css =
      ':root{--tenant-name:\'EduZo\';--tenant-primary:hsl(280,70%,45%);--tenant-login-bg:linear-gradient(135deg,hsl(280,70%,30%),hsl(280,70%,50%));}';
    const tokens = parseTenantCssTokens(css);
    expect(tokens['name']).toBe("'EduZo'");
    expect(tokens['primary']).toBe('hsl(280,70%,45%)');
    expect(tokens['login-bg']).toBe(
      'linear-gradient(135deg,hsl(280,70%,30%),hsl(280,70%,50%))',
    );
  });

  it('returns an empty object when no --tenant-* declarations exist', () => {
    expect(parseTenantCssTokens(':root{--other:foo;}')).toEqual({});
    expect(parseTenantCssTokens('')).toEqual({});
  });

  it('tolerates declarations split across multiple selectors / rules', () => {
    const css =
      ':root{--tenant-name:\'EduZo\';}html{--tenant-primary:#003366;}';
    const tokens = parseTenantCssTokens(css);
    expect(tokens['name']).toBe("'EduZo'");
    expect(tokens['primary']).toBe('#003366');
  });
});

describe('extractTenantTokensFromHead — round-trip from SSR <style> (Task 58.1)', () => {
  beforeEach(() => {
    removeSsrThemeStyles();
  });

  it('parses a sample SSR <style data-tenant-theme> block back into a Brand', () => {
    injectSsrThemeStyle(SAMPLE_BRAND);
    const brand = extractTenantTokensFromHead();
    expect(brand).not.toBeNull();
    expect(brand?.name).toBe(SAMPLE_BRAND.name);
    expect(brand?.shortName).toBe(SAMPLE_BRAND.shortName);
    expect(brand?.logo.url).toBe(SAMPLE_BRAND.logo.url);
    expect(brand?.favicon).toBe(SAMPLE_BRAND.favicon);
    expect(brand?.primary_color).toBe(SAMPLE_BRAND.primary_color);
    expect(brand?.accent_color).toBe(SAMPLE_BRAND.accent_color);
    expect(brand?.login_background).toBe(SAMPLE_BRAND.login_background);
  });

  it('returns null when no SSR theme style block is present', () => {
    expect(extractTenantTokensFromHead()).toBeNull();
  });

  it('returns null when the SSR block is missing one of the required tokens', () => {
    const style = document.createElement('style');
    style.setAttribute('data-tenant-theme', 'ssr');
    // Missing --tenant-favicon / --tenant-login-bg.
    style.textContent =
      ":root{--tenant-name:'EduZo';--tenant-shortName:'eduzo';--tenant-primary:#003366;--tenant-accent:#FFAA00;--tenant-logo:url('logo.svg');}";
    document.head.appendChild(style);
    expect(extractTenantTokensFromHead()).toBeNull();
  });

  it('un-escapes single-quotes in the brand name', () => {
    const tricky: Brand = {
      ...SAMPLE_BRAND,
      name: "Tom's School",
      shortName: "tom's",
    };
    injectSsrThemeStyle(tricky);
    const brand = extractTenantTokensFromHead();
    expect(brand?.name).toBe("Tom's School");
    expect(brand?.shortName).toBe("tom's");
  });
});

describe('BrandConfigProvider — uses SSR-injected tokens before client fetch resolves', () => {
  beforeEach(() => {
    removeSsrThemeStyles();
  });

  it('renders with SSR-injected tokens on first paint, then reconciles to fetched tokens', async () => {
    // 1. Server-rendered baseline: SAMPLE_BRAND tokens already in the head.
    injectSsrThemeStyle(SAMPLE_BRAND);

    // 2. Client fetch will eventually return a different (drifted) brand
    //    — simulating the CDN-cache-drift scenario in the task brief.
    const driftedBrand: Brand = {
      ...SAMPLE_BRAND,
      primary_color: 'hsl(120, 60%, 40%)',
      accent_color: 'hsl(20, 80%, 50%)',
    };
    let resolveFetch: (b: Brand) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Brand>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider fetcher={fetcher}>{children}</BrandConfigProvider>
      ),
    });

    // 3. Before the fetch resolves, the provider exposes the SSR brand —
    //    NOT the canonical ProctiraERP default. This is the property the
    //    task explicitly calls out: first client render matches SSR paint.
    expect(result.current.brand.name).toBe(SAMPLE_BRAND.name);
    expect(result.current.brand.primary_color).toBe(SAMPLE_BRAND.primary_color);
    expect(result.current.loading).toBe(true);

    // 4. Reconcile: the boot fetch resolves with a drifted brand and the
    //    provider switches over.
    await act(async () => {
      resolveFetch(driftedBrand);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand.primary_color).toBe(driftedBrand.primary_color);
    expect(result.current.brand.accent_color).toBe(driftedBrand.accent_color);
  });

  it('falls back to DEFAULT_BRAND when the SSR style block is absent', async () => {
    // No SSR <style> in the head (e.g. mounted outside Next.js layout).
    let resolveFetch: (b: Brand) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Brand>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider fetcher={fetcher}>{children}</BrandConfigProvider>
      ),
    });

    // Before the fetch resolves, provider falls back to DEFAULT_BRAND.
    expect(result.current.brand).toEqual(DEFAULT_BRAND);

    await act(async () => {
      resolveFetch(SAMPLE_BRAND);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand).toEqual(SAMPLE_BRAND);
  });

  it('initialBrand prop wins over the SSR-injected style block', async () => {
    injectSsrThemeStyle(SAMPLE_BRAND);
    const explicit: Brand = { ...DEFAULT_BRAND, name: 'Explicit Override' };
    const fetcher = vi.fn();
    const { result } = renderHook(() => useBrand(), {
      wrapper: ({ children }) => (
        <BrandConfigProvider initialBrand={explicit} fetcher={fetcher}>
          {children}
        </BrandConfigProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand.name).toBe('Explicit Override');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
