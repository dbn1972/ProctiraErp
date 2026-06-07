import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildAssetUrl, normalizePath } from './url-builder.js';
import { createCdnAdapter } from './cdn-adapter.js';
import type { AssetCategory, AssetUrlOptions, CdnConfig } from './types.js';

/**
 * Property-based tests for CDN URL generation.
 *
 * **Validates: Requirements 1.1, 1.2** (shared libraries, module boundaries)
 */

// ─── Generators ──────────────────────────────────────────────────────────────

const assetCategoryArb: fc.Arbitrary<AssetCategory> = fc.constantFrom(
  'branding',
  'static',
  'upload',
  'document',
);

const safePathSegmentArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split(''),
  ),
  { minLength: 1, maxLength: 20 },
);

const assetPathArb = fc
  .array(safePathSegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('/'));

const tenantIdArb = fc
  .stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 3, maxLength: 30 },
  )
  .filter((s) => /^[a-z]/.test(s));

const versionArb = fc.oneof(
  fc.constant(undefined),
  fc.stringOf(fc.constantFrom(...'abcdef0123456789.'.split('')), { minLength: 1, maxLength: 10 }),
);

const baseUrlArb = fc.constantFrom(
  'https://cdn.proctira.org',
  'https://assets.example.com',
  'https://cdn.ministry.gov',
  'http://localhost:8080',
);

const cdnConfigArb: fc.Arbitrary<CdnConfig> = fc.record({
  adapter: fc.constantFrom('cloudfront' as const, 'nginx' as const, 'custom' as const),
  baseUrl: baseUrlArb,
  tenantAware: fc.boolean(),
  brandingPrefix: fc.constant('/branding'),
  staticPrefix: fc.constant('/static'),
  cache: fc.option(
    fc.record({
      defaultTtlSeconds: fc.nat({ max: 604800 }),
      brandingTtlSeconds: fc.nat({ max: 86400 }),
      enableVersioning: fc.boolean(),
    }),
    { nil: undefined },
  ),
});

const assetUrlOptionsArb: fc.Arbitrary<AssetUrlOptions> = fc.record({
  path: assetPathArb,
  category: assetCategoryArb,
  tenantId: fc.option(tenantIdArb, { nil: undefined }),
  version: versionArb,
});

// ─── Properties ──────────────────────────────────────────────────────────────

describe('CDN URL Builder Properties', () => {
  it('generated URLs always start with the configured base URL', () => {
    fc.assert(
      fc.property(assetUrlOptionsArb, cdnConfigArb, (options, config) => {
        const result = buildAssetUrl(options, config);
        const expectedBase = config.baseUrl.endsWith('/')
          ? config.baseUrl.slice(0, -1)
          : config.baseUrl;
        expect(result.url).toMatch(new RegExp(`^${expectedBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      }),
      { numRuns: 200 },
    );
  });

  it('generated paths always start with a forward slash', () => {
    fc.assert(
      fc.property(assetUrlOptionsArb, cdnConfigArb, (options, config) => {
        const result = buildAssetUrl(options, config);
        expect(result.path.startsWith('/')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('generated paths never contain double slashes', () => {
    fc.assert(
      fc.property(assetUrlOptionsArb, cdnConfigArb, (options, config) => {
        const result = buildAssetUrl(options, config);
        expect(result.path).not.toContain('//');
      }),
      { numRuns: 200 },
    );
  });

  it('static assets never include tenant ID in path', () => {
    fc.assert(
      fc.property(tenantIdArb, assetPathArb, cdnConfigArb, (tenantId, path, config) => {
        const options: AssetUrlOptions = {
          path,
          category: 'static',
          tenantId,
        };
        const result = buildAssetUrl(options, { ...config, tenantAware: true });
        // The path should not contain the tenant ID for static assets
        expect(result.path).not.toContain(`/${tenantId}/`);
      }),
      { numRuns: 200 },
    );
  });

  it('branding assets include tenant ID when tenantAware is true and tenantId provided', () => {
    fc.assert(
      fc.property(tenantIdArb, assetPathArb, baseUrlArb, (tenantId, path, baseUrl) => {
        const config: CdnConfig = {
          adapter: 'custom',
          baseUrl,
          tenantAware: true,
          brandingPrefix: '/branding',
          staticPrefix: '/static',
        };
        const options: AssetUrlOptions = {
          path,
          category: 'branding',
          tenantId,
        };
        const result = buildAssetUrl(options, config);
        expect(result.path).toContain(tenantId);
      }),
      { numRuns: 200 },
    );
  });

  it('versioned flag is true only when both enableVersioning and version are set', () => {
    fc.assert(
      fc.property(assetUrlOptionsArb, cdnConfigArb, (options, config) => {
        const result = buildAssetUrl(options, config);
        const shouldBeVersioned =
          config.cache?.enableVersioning !== false && !!options.version;
        expect(result.versioned).toBe(shouldBeVersioned);
      }),
      { numRuns: 200 },
    );
  });

  it('URL contains version query param if and only if versioned is true', () => {
    fc.assert(
      fc.property(assetUrlOptionsArb, cdnConfigArb, (options, config) => {
        const result = buildAssetUrl(options, config);
        const hasVersionParam = result.url.includes('?v=');
        expect(hasVersionParam).toBe(result.versioned);
      }),
      { numRuns: 200 },
    );
  });
});

describe('normalizePath Properties', () => {
  it('always returns a string starting with /', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizePath(input);
        expect(result.startsWith('/')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('never contains consecutive slashes', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizePath(input);
        expect(result).not.toContain('//');
      }),
      { numRuns: 200 },
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const once = normalizePath(input);
        const twice = normalizePath(once);
        expect(once).toBe(twice);
      }),
      { numRuns: 200 },
    );
  });
});

describe('CDN Adapter Factory Properties', () => {
  it('creates valid adapters for all supported types', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('nginx' as const, 'custom' as const),
        baseUrlArb,
        (adapter, baseUrl) => {
          const config: CdnConfig = {
            adapter,
            baseUrl,
            tenantAware: true,
            brandingPrefix: '/branding',
            staticPrefix: '/static',
          };
          const cdnAdapter = createCdnAdapter(config);
          expect(cdnAdapter).toBeDefined();
          expect(typeof cdnAdapter.getAssetUrl).toBe('function');
          expect(typeof cdnAdapter.invalidate).toBe('function');
          expect(typeof cdnAdapter.healthCheck).toBe('function');
        },
      ),
      { numRuns: 50 },
    );
  });
});
