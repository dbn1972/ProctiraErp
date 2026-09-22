/**
 * Published tenant tokens → brand fields, and the two bugs that mapping fixes.
 *
 * Both normalizers (`BrandConfigProvider.normalizeBrandResponse` and the server-side
 * copy in `lib/tenant-theme/server.ts`) are asserted here against the payload the
 * gateway really sends, because the gap between "the request succeeded" and "the brand
 * changed" is exactly where this defect lived.
 *
 * Runs in the project default jsdom environment rather than node: `defaultBrandFetcher`
 * short-circuits to DEFAULT_BRAND unless `window` and `document` exist, so a node
 * environment would make its cases pass without reaching the fetch at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BRAND,
  defaultBrandFetcher,
  normalizeBrandResponse,
} from '@/providers/BrandConfigProvider';

import { extractPublishedTokens, tenantTokensToBrandFields } from './tenant-token-fields';

/** What `GET /tenant/branding` returns: `getActiveBranding`'s result, verbatim. */
const GATEWAY_PAYLOAD = {
  tokens: {
    '--tenant-name': "'EduZo Public School'",
    '--tenant-shortName': "'eduzo'",
    '--tenant-primary': 'hsl(12, 76%, 41%)',
    '--tenant-accent': 'hsl(190, 80%, 35%)',
    '--tenant-logo': 'url("/cdn/eduzo/logo.svg")',
    '--tenant-favicon': 'url("/cdn/eduzo/favicon.ico")',
    '--tenant-login-bg': 'linear-gradient(135deg, hsl(12, 76%, 22%), hsl(12, 76%, 45%))',
  },
  revision: 7,
};

describe('extractPublishedTokens', () => {
  it('recognises a published-theme payload', () => {
    expect(extractPublishedTokens(GATEWAY_PAYLOAD)).toEqual(GATEWAY_PAYLOAD.tokens);
  });

  it('ignores anything that is not a token record', () => {
    // A flat brand payload must keep taking the original code path.
    expect(extractPublishedTokens({ name: 'EduZo' })).toBeUndefined();
    expect(extractPublishedTokens({ tokens: null })).toBeUndefined();
    expect(extractPublishedTokens({ tokens: [] })).toBeUndefined();
    expect(extractPublishedTokens(null)).toBeUndefined();
    expect(extractPublishedTokens('tokens')).toBeUndefined();
  });
});

describe('tenantTokensToBrandFields', () => {
  it('maps the canonical --tenant-* tokens onto brand field names', () => {
    expect(tenantTokensToBrandFields(GATEWAY_PAYLOAD.tokens)).toEqual({
      name: 'EduZo Public School',
      shortName: 'eduzo',
      primaryColor: 'hsl(12, 76%, 41%)',
      accentColor: 'hsl(190, 80%, 35%)',
      logoUrl: '/cdn/eduzo/logo.svg',
      favicon: '/cdn/eduzo/favicon.ico',
      loginBackground: 'linear-gradient(135deg, hsl(12, 76%, 22%), hsl(12, 76%, 45%))',
    });
  });

  it('undoes the CSS quoting the SSR writer adds', () => {
    // renderTenantThemeCSS emits --tenant-name as a single-quoted CSS string with
    // backslashes and quotes escaped, because it is read via content: var(...).
    expect(tenantTokensToBrandFields({ '--tenant-name': "'D\\'Souza \\\\ Academy'" }).name).toBe(
      "D'Souza \\ Academy",
    );
  });

  it('accepts a bare url as well as url(...)', () => {
    expect(tenantTokensToBrandFields({ '--tenant-logo': '/logo.png' }).logoUrl).toBe('/logo.png');
    expect(tenantTokensToBrandFields({ '--tenant-logo': "url('/a.svg')" }).logoUrl).toBe('/a.svg');
  });

  it('omits absent, blank and non-string slots instead of inventing values', () => {
    // validateBrandingTokens explicitly allows a tenant to publish one slot and
    // inherit the platform default for the rest.
    expect(
      tenantTokensToBrandFields({
        '--tenant-primary': 'red',
        '--tenant-accent': '   ',
        '--tenant-logo': 'url()',
        '--tenant-favicon': 42,
      }),
    ).toEqual({ primaryColor: 'red' });
  });
});

describe('normalizeBrandResponse with a published-theme payload', () => {
  it('applies the published colours and logo instead of the platform default', () => {
    // This is the headline defect: before the mapping, every visual field here came
    // back as DEFAULT_BRAND, so a tenant could publish a theme, get a 200, and see
    // no change at all.
    const brand = normalizeBrandResponse(GATEWAY_PAYLOAD);
    expect(brand.name).toBe('EduZo Public School');
    expect(brand.primary_color).toBe('hsl(12, 76%, 41%)');
    expect(brand.accent_color).toBe('hsl(190, 80%, 35%)');
    expect(brand.logo.url).toBe('/cdn/eduzo/logo.svg');
    expect(brand.favicon).toBe('/cdn/eduzo/favicon.ico');
    expect(brand.login_background).toContain('hsl(12, 76%, 22%)');
    expect(brand.shortName).toBe('eduzo');
  });

  it('keeps the default storage key when the payload carries no name', () => {
    // shortName keys localStorage via `${shortName}-theme` and `${shortName}-language`
    // (ThemeProvider.useResolvedStorageKey, LanguageProvider). Deriving it from the
    // *defaulted* name produced 'proctiraerp' where the default is 'proctira', so a
    // nameless payload silently moved every user's saved theme and locale to a key
    // that had never been written — losing dark mode and the chosen language.
    const brand = normalizeBrandResponse({ tokens: { '--tenant-primary': '#123456' } });
    expect(brand.shortName).toBe(DEFAULT_BRAND.shortName);
    expect(brand.slug).toBe(DEFAULT_BRAND.slug);
    expect(brand.name).toBe(DEFAULT_BRAND.name);
    // The one thing the tenant did publish still applies.
    expect(brand.primary_color).toBe('#123456');
  });

  it('still derives a shortName from a name the payload actually supplied', () => {
    expect(normalizeBrandResponse({ name: 'EduZo Public School' }).shortName).toBe(
      'eduzo-public-school',
    );
  });

  it('lets an explicit top-level field win over a token', () => {
    const brand = normalizeBrandResponse({
      ...GATEWAY_PAYLOAD,
      primaryColor: '#000000',
    });
    expect(brand.primary_color).toBe('#000000');
  });

  it('returns the default brand for an empty payload', () => {
    expect(normalizeBrandResponse({})).toEqual(DEFAULT_BRAND);
    expect(normalizeBrandResponse(null)).toEqual(DEFAULT_BRAND);
  });
});

describe('defaultBrandFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats the route’s 204 for an anonymous visitor as the default brand', async () => {
    // 204 satisfies `response.ok`, so it is not covered by the non-ok fallback. Without
    // an explicit branch the empty body reaches `response.json()` and throws into the
    // catch-all — the right answer by accident, and the one path with no test.
    const response = new Response(null, { status: 204 });
    const jsonSpy = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(defaultBrandFetcher()).resolves.toEqual(DEFAULT_BRAND);
    // Asserting the brand alone would pass either way, since a thrown parse error also
    // lands on DEFAULT_BRAND. What distinguishes the explicit branch from the accident
    // is that the empty body is never parsed at all.
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('applies published tokens from a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(GATEWAY_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const brand = await defaultBrandFetcher();
    expect(brand.primary_color).toBe('hsl(12, 76%, 41%)');
    expect(brand.shortName).toBe('eduzo');
  });
});
