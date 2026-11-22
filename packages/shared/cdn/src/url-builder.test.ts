import { describe, it, expect } from 'vitest';
import { NginxCdnAdapter } from './adapters/nginx.js';
import { buildAssetUrl, CdnPathError, normalizePath } from './url-builder.js';
import type { CdnConfig, AssetUrlOptions } from './types.js';

function createConfig(overrides: Partial<CdnConfig> = {}): CdnConfig {
  return {
    adapter: 'custom',
    baseUrl: 'https://cdn.proctira.org',
    tenantAware: true,
    brandingPrefix: '/branding',
    staticPrefix: '/static',
    cache: {
      defaultTtlSeconds: 86400,
      brandingTtlSeconds: 3600,
      enableVersioning: true,
    },
    ...overrides,
  };
}

describe('normalizePath', () => {
  it('should add leading slash if missing', () => {
    expect(normalizePath('assets/logo.png')).toBe('/assets/logo.png');
  });

  it('should collapse multiple slashes', () => {
    expect(normalizePath('//assets///logo.png')).toBe('/assets/logo.png');
  });

  it('should remove trailing slash', () => {
    expect(normalizePath('/assets/')).toBe('/assets');
  });

  it('should preserve root path', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should trim whitespace', () => {
    expect(normalizePath('  /assets/logo.png  ')).toBe('/assets/logo.png');
  });

  it('should handle empty string', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('is idempotent when a trailing slash hides whitespace', () => {
    expect(normalizePath('! /')).toBe('/!');
    expect(normalizePath('/a / /')).toBe('/a');
    expect(normalizePath(' / /')).toBe('/');
    for (const input of ['! /', '/a / /', ' / /']) {
      expect(normalizePath(normalizePath(input))).toBe(normalizePath(input));
    }
  });

  it('strips the trailing run in linear time on long whitespace runs', () => {
    // A long whitespace run followed by a non-matching character is the
    // worst case for a backtracking trailing-run regex (O(n^2)).
    const run = ' \t'.repeat(40_000);
    const start = performance.now();
    expect(normalizePath(`/a${run}b`)).toBe(`/a${run}b`);
    expect(normalizePath(`/a${run}b${' /'.repeat(40_000)}`)).toBe(`/a${run}b`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('buildAssetUrl', () => {
  describe('tenant-aware branding assets', () => {
    it('should generate tenant-scoped branding URL', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'logo.png',
        category: 'branding',
        tenantId: 'tenant-abc',
        version: '1.0.0',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/branding/tenant-abc/logo.png?v=1.0.0');
      expect(result.path).toBe('/branding/tenant-abc/logo.png');
      expect(result.versioned).toBe(true);
    });

    it('should generate branding URL without tenant when tenantAware is false', () => {
      const config = createConfig({ tenantAware: false });
      const options: AssetUrlOptions = {
        path: 'logo.png',
        category: 'branding',
        tenantId: 'tenant-abc',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/branding/logo.png');
      expect(result.path).toBe('/branding/logo.png');
    });
  });

  describe('static assets', () => {
    it('should generate static asset URL without tenant prefix', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'css/main.css',
        category: 'static',
        tenantId: 'tenant-abc',
        version: 'abc123',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/css/main.css?v=abc123');
      expect(result.path).toBe('/static/css/main.css');
      expect(result.versioned).toBe(true);
    });

    it('should not include tenant in static asset path even when tenantAware', () => {
      const config = createConfig({ tenantAware: true });
      const options: AssetUrlOptions = {
        path: 'js/app.js',
        category: 'static',
        tenantId: 'tenant-xyz',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/js/app.js');
      expect(result.path).toBe('/static/js/app.js');
    });
  });

  describe('upload assets', () => {
    it('should generate tenant-scoped upload URL', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'photos/student-123.jpg',
        category: 'upload',
        tenantId: 'ministry-edu',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe(
        'https://cdn.proctira.org/uploads/ministry-edu/photos/student-123.jpg',
      );
      expect(result.path).toBe('/uploads/ministry-edu/photos/student-123.jpg');
    });
  });

  describe('document assets', () => {
    it('should generate tenant-scoped document URL', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'reports/annual-2024.pdf',
        category: 'document',
        tenantId: 'district-1',
        version: 'v2',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe(
        'https://cdn.proctira.org/documents/district-1/reports/annual-2024.pdf?v=v2',
      );
      expect(result.path).toBe('/documents/district-1/reports/annual-2024.pdf');
      expect(result.versioned).toBe(true);
    });
  });

  describe('versioning', () => {
    it('should not add version param when enableVersioning is false', () => {
      const config = createConfig({
        cache: { defaultTtlSeconds: 86400, brandingTtlSeconds: 3600, enableVersioning: false },
      });
      const options: AssetUrlOptions = {
        path: 'logo.png',
        category: 'static',
        version: '1.0.0',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/logo.png');
      expect(result.versioned).toBe(false);
    });

    it('should not add version param when no version provided', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'logo.png',
        category: 'static',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/logo.png');
      expect(result.versioned).toBe(false);
    });

    it('should URL-encode version parameter', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'app.js',
        category: 'static',
        version: 'v1.0.0+build.123',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/app.js?v=v1.0.0%2Bbuild.123');
    });
  });

  describe('base URL handling', () => {
    it('should strip trailing slash from base URL', () => {
      const config = createConfig({ baseUrl: 'https://cdn.proctira.org/' });
      const options: AssetUrlOptions = {
        path: 'logo.png',
        category: 'static',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/logo.png');
    });
  });

  describe('path normalization', () => {
    it('should handle paths with leading slashes', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: '/logo.png',
        category: 'static',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/logo.png');
    });

    it('should handle nested paths', () => {
      const config = createConfig();
      const options: AssetUrlOptions = {
        path: 'images/icons/favicon.ico',
        category: 'static',
      };

      const result = buildAssetUrl(options, config);

      expect(result.url).toBe('https://cdn.proctira.org/static/images/icons/favicon.ico');
    });
  });
});
describe('path safety (PRC-L580)', () => {
  const config = createConfig();
  it.each([
    '../other/logo.png',
    'a/../../b',
    'a/%2e%2e/b',
    'a/%2E%2e/b',
    'a\\..\\b',
    'a/./b',
    'a/%zz/b',
    'a/%2f/b',
    'a/\u0000/b',
  ])('rejects unsafe asset path %j', (path) => {
    expect(() => buildAssetUrl({ path, category: 'upload', tenantId: 'tenant-1' }, config)).toThrow(
      CdnPathError,
    );
  });
  it.each(['../t2', 't/2', 't%2F2', '..', 't 2'])('rejects unsafe tenant id %j', (tenantId) => {
    expect(() => buildAssetUrl({ path: 'logo.png', category: 'upload', tenantId }, config)).toThrow(
      CdnPathError,
    );
  });
  it.each(['tenant-abc', 'ministry-edu', 'district-1', '550e8400-e29b-41d4-a716-446655440000'])(
    'accepts tenant id %j',
    (tenantId) => {
      const result = buildAssetUrl({ path: 'logo.png', category: 'branding', tenantId }, config);
      expect(result.path).toBe(`/branding/${tenantId}/logo.png`);
    },
  );
  it.each(['reports/annual-2024.pdf', '..config', 'v1.2/app.js', 'a..b/c.png'])(
    'accepts dotted but non-traversal path %j',
    (path) => {
      const result = buildAssetUrl({ path, category: 'static' }, config);
      expect(result.path).toBe(`/static/${path}`);
    },
  );
  it('fails closed with a typed error code', () => {
    try {
      buildAssetUrl({ path: '../x', category: 'static' }, config);
      expect.unreachable('expected CdnPathError');
    } catch (error) {
      expect(error).toBeInstanceOf(CdnPathError);
      expect((error as CdnPathError).code).toBe('CDN_INVALID_PATH');
    }
  });
});
describe('NginxCdnAdapter.invalidate path safety (PRC-L580)', () => {
  // PRC-L489: the adapter now sends real PURGE requests; answer them locally.
  const adapter = new NginxCdnAdapter(
    createConfig({ adapter: 'nginx', baseUrl: 'https://cdn.example.org/' }),
    { fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch },
  );
  it('rejects a traversal purge path', async () => {
    const result = await adapter.invalidate({ paths: ['/uploads/../../etc/passwd'] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('/uploads/../../etc/passwd');
  });
  it('reports failure when any path in the batch is unsafe', async () => {
    const result = await adapter.invalidate({
      paths: ['/static/css/main.css', 'branding/%2e%2e/tenant-2/*'],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('branding/%2e%2e/tenant-2/*');
  });
  it.each([['/branding/tenant-1/*'], ['static/css/main.css'], ['/uploads/*']])(
    'accepts safe purge path %j',
    async (path) => {
      const result = await adapter.invalidate({ paths: [path] });
      expect(result.success).toBe(true);
    },
  );
});
