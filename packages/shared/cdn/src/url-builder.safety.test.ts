/**
 * PRC-L580: CDN URL builder rejects traversal/unsafe input and fails closed
 * when a tenant-aware asset has no tenant id.
 */
import { describe, expect, it } from 'vitest';

import type { AssetUrlOptions, CdnConfig } from './types.js';
import { buildAssetUrl, CdnPathError } from './url-builder.js';

const config: CdnConfig = {
  adapter: 'custom',
  baseUrl: 'https://cdn.proctira.org',
  tenantAware: true,
  brandingPrefix: '/branding',
  staticPrefix: '/static',
};

function build(options: Partial<AssetUrlOptions>, cfg: CdnConfig = config) {
  return buildAssetUrl({ path: 'logo.png', category: 'branding', ...options }, cfg);
}

describe('buildAssetUrl input safety (PRC-L580)', () => {
  it.each(['../x', 'a/../../x', './x', 'a/..', '..'])('rejects traversal path %j', (path) => {
    expect(() => build({ path, tenantId: 'tenant-a' })).toThrow(CdnPathError);
    expect(() => build({ path, category: 'static' })).toThrow(CdnPathError);
  });

  it.each(['a\\b.png', 'a\u0000b', 'line\nbreak', 'tab\there'])(
    'rejects backslash/control characters in %j',
    (path) => {
      expect(() => build({ path, tenantId: 'tenant-a' })).toThrow(CdnPathError);
    },
  );

  it.each(['branding', 'upload', 'document'] as const)(
    'throws when tenantAware and tenantId is missing for %s',
    (category) => {
      expect(() => build({ category })).toThrow(/tenantId is required/);
      expect(() => build({ category, tenantId: '  ' })).toThrow(/tenantId is required/);
    },
  );

  it('static assets do not need a tenant id', () => {
    expect(build({ category: 'static' }).path).toBe('/static/logo.png');
  });

  it('tenantAware=false does not need a tenant id', () => {
    expect(build({}, { ...config, tenantAware: false }).path).toBe('/branding/logo.png');
  });

  it.each(['a/b', 'a.b', '..', 'a b', 'a\\b', ''])('rejects unsafe tenantId %j', (tenantId) => {
    expect(() => build({ tenantId })).toThrow(CdnPathError);
  });

  it('percent-encodes path segments', () => {
    expect(build({ path: 'my logo#1?.png', tenantId: 'tenant-a' }).path).toBe(
      '/branding/tenant-a/my%20logo%231%3F.png',
    );
  });

  it('keeps ordinary dotted file names', () => {
    expect(build({ path: 'v1.2/app.min.js', category: 'static' }).path).toBe(
      '/static/v1.2/app.min.js',
    );
  });
});
