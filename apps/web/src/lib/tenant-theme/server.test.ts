/**
 * Server-side tenant-theme tests — Task 58.1 / Requirement 28.1, 28.10
 *
 * Verifies the SSR helpers that `app/layout.tsx` uses to emit the
 * `<style data-tenant-theme>` block on first paint:
 *
 *   • `brandToTenantTokens()`   — round-trips a `Brand` into the seven
 *     `--tenant-*` token strings without losing precision.
 *   • `renderTenantThemeCSS()`  — produces a single-line `:root { ... }`
 *     CSS block that ParserHTMLs to valid CSS.
 *   • `getPublishedTenantTheme()` — caches the resolved tokens with the
 *     5-minute (`SSR_THEME_CACHE_TTL_MS`) TTL and falls back to the
 *     ProctiraERP defaults on fetcher failure.
 *   • `resolveRequestTenantSlug()` — picks the tenant slug from the
 *     middleware-set `X-Tenant-Slug` header first, then `X-Tenant-ID`,
 *     then `'default'`.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';

import {
  brandToTenantTokens,
  clearSSRThemeCache,
  getPublishedTenantTheme,
  PUBLISHED_THEME_PATH,
  renderTenantThemeCSS,
  resolveRequestTenantSlug,
  SSR_THEME_CACHE_TTL_MS,
  TENANT_CSS_VARIABLE_NAMES,
} from './server';
import { DEFAULT_BRAND, type Brand } from '@/providers/BrandConfigProvider';

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

beforeEach(() => {
  clearSSRThemeCache();
  vi.restoreAllMocks();
});

describe('brandToTenantTokens — Brand → --tenant-* token strings', () => {
  it('produces single-quoted CSS strings for name/shortName', () => {
    const tokens = brandToTenantTokens(SAMPLE_BRAND);
    expect(tokens.name).toBe(`'${SAMPLE_BRAND.name}'`);
    expect(tokens.shortName).toBe(`'${SAMPLE_BRAND.shortName}'`);
  });

  it('wraps logo and favicon in url("...")', () => {
    const tokens = brandToTenantTokens(SAMPLE_BRAND);
    expect(tokens.logo).toBe(`url("${SAMPLE_BRAND.logo.url}")`);
    expect(tokens.favicon).toBe(`url("${SAMPLE_BRAND.favicon}")`);
  });

  it('passes through colors and login background verbatim', () => {
    const tokens = brandToTenantTokens(SAMPLE_BRAND);
    expect(tokens.primary).toBe(SAMPLE_BRAND.primary_color);
    expect(tokens.accent).toBe(SAMPLE_BRAND.accent_color);
    expect(tokens.loginBackground).toBe(SAMPLE_BRAND.login_background);
  });

  it('escapes single quotes in tenant names', () => {
    const tricky: Brand = { ...SAMPLE_BRAND, name: "Tom's School", shortName: "tom's" };
    const tokens = brandToTenantTokens(tricky);
    expect(tokens.name).toBe("'Tom\\'s School'");
    expect(tokens.shortName).toBe("'tom\\'s'");
  });
});

describe('renderTenantThemeCSS — :root { --tenant-* } block', () => {
  it('emits all seven custom properties on :root', () => {
    const css = renderTenantThemeCSS(brandToTenantTokens(SAMPLE_BRAND));
    expect(css.startsWith(':root{')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    for (const name of TENANT_CSS_VARIABLE_NAMES) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('keeps the output on a single compact line for HTML payload size', () => {
    const css = renderTenantThemeCSS(brandToTenantTokens(SAMPLE_BRAND));
    expect(css).not.toContain('\n');
  });

  it('exposes exactly the seven --tenant-* names that the client provider writes', () => {
    expect(TENANT_CSS_VARIABLE_NAMES).toEqual([
      '--tenant-name',
      '--tenant-shortName',
      '--tenant-primary',
      '--tenant-accent',
      '--tenant-logo',
      '--tenant-favicon',
      '--tenant-login-bg',
    ]);
  });
});

describe('getPublishedTenantTheme — server-side cache + fallback', () => {
  it('calls the fetcher on cache miss and caches the result', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    const a = await getPublishedTenantTheme('eduzo', fetcher);
    const b = await getPublishedTenantTheme('eduzo', fetcher);

    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(b.tokens.primary).toBe(SAMPLE_BRAND.primary_color);
  });

  it('lowercases the tenant slug before keying the cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    await getPublishedTenantTheme('EduZo', fetcher);
    const second = await getPublishedTenantTheme('eduzo', fetcher);
    expect(second.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to DEFAULT_BRAND tokens when the fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('upstream offline'));
    const result = await getPublishedTenantTheme('eduzo', fetcher);
    expect(result.brand).toEqual(DEFAULT_BRAND);
    expect(result.tokens.primary).toBe(DEFAULT_BRAND.primary_color);
  });

  it('refetches once the cache TTL has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);

      await getPublishedTenantTheme('eduzo', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(Date.now() + SSR_THEME_CACHE_TTL_MS + 1));
      await getPublishedTenantTheme('eduzo', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the slug to "default" when called with an empty string', async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE_BRAND);
    const result = await getPublishedTenantTheme('', fetcher);
    expect(result.tenantSlug).toBe('default');
  });
});

describe('resolveRequestTenantSlug — header-based tenant resolution', () => {
  it('prefers x-tenant-slug over x-tenant-id', async () => {
    const headers = new Map<string, string>([
      ['x-tenant-slug', 'eduzo'],
      ['x-tenant-id', 'ministry-edu'],
    ]);
    const slug = await resolveRequestTenantSlug({
      get: (name: string) => headers.get(name) ?? null,
    });
    expect(slug).toBe('eduzo');
  });

  it('falls back to x-tenant-id when x-tenant-slug is absent', async () => {
    const headers = new Map<string, string>([['x-tenant-id', 'ministry-edu']]);
    const slug = await resolveRequestTenantSlug({
      get: (name: string) => headers.get(name) ?? null,
    });
    expect(slug).toBe('ministry-edu');
  });

  it('returns "default" when no tenant headers are present', async () => {
    const slug = await resolveRequestTenantSlug({ get: () => null });
    expect(slug).toBe('default');
  });

  it('lowercases the resolved slug', async () => {
    const slug = await resolveRequestTenantSlug({ get: () => 'MINISTRY-EDU' });
    expect(slug).toBe('ministry-edu');
  });
});

describe('PUBLISHED_THEME_PATH — endpoint contract', () => {
  it('matches the `/api/v1/tenant/theme/published` path described in the task brief', () => {
    expect(PUBLISHED_THEME_PATH).toBe('/api/v1/tenant/theme/published');
  });
});
