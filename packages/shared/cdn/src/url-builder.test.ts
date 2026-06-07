import { describe, it, expect } from 'vitest';
import { buildAssetUrl, normalizePath } from './url-builder.js';
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

      expect(result.url).toBe('https://cdn.proctira.org/uploads/ministry-edu/photos/student-123.jpg');
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

      expect(result.url).toBe('https://cdn.proctira.org/documents/district-1/reports/annual-2024.pdf?v=v2');
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
