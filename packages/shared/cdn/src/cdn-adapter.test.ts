import { describe, it, expect } from 'vitest';
import { createCdnAdapter, CdnError } from './cdn-adapter.js';
import { CloudFrontCdnAdapter } from './adapters/cloudfront.js';
import { NginxCdnAdapter } from './adapters/nginx.js';
import { CustomCdnAdapter } from './adapters/custom.js';
import type { CdnConfig } from './types.js';

function createBaseConfig(adapter: CdnConfig['adapter']): CdnConfig {
  return {
    adapter,
    baseUrl: 'https://cdn.proctira.org',
    tenantAware: true,
    brandingPrefix: '/branding',
    staticPrefix: '/static',
  };
}

describe('createCdnAdapter', () => {
  it('should create a CloudFront adapter', () => {
    const config: CdnConfig = {
      ...createBaseConfig('cloudfront'),
      cloudfront: { distributionId: 'E1234567890', region: 'us-east-1' },
    };

    const adapter = createCdnAdapter(config);
    expect(adapter).toBeInstanceOf(CloudFrontCdnAdapter);
  });

  it('should create an Nginx adapter', () => {
    const config = createBaseConfig('nginx');

    const adapter = createCdnAdapter(config);
    expect(adapter).toBeInstanceOf(NginxCdnAdapter);
  });

  it('should create a Custom adapter', () => {
    const config = createBaseConfig('custom');

    const adapter = createCdnAdapter(config);
    expect(adapter).toBeInstanceOf(CustomCdnAdapter);
  });

  it('should throw CdnError for unsupported adapter', () => {
    const config = { ...createBaseConfig('custom'), adapter: 'unknown' as CdnConfig['adapter'] };

    expect(() => createCdnAdapter(config)).toThrow(CdnError);
    expect(() => createCdnAdapter(config)).toThrow('Unsupported CDN adapter');
  });

  it('should throw CdnError for CloudFront without distributionId', () => {
    const config = createBaseConfig('cloudfront');

    expect(() => createCdnAdapter(config)).toThrow(CdnError);
    expect(() => createCdnAdapter(config)).toThrow('distributionId');
  });
});

describe('CdnError', () => {
  it('should have correct name and code', () => {
    const error = new CdnError('test error', 'TEST_CODE');

    expect(error.name).toBe('CdnError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('should use default code when not provided', () => {
    const error = new CdnError('test error');

    expect(error.code).toBe('CDN_ERROR');
  });
});

describe('CloudFrontCdnAdapter', () => {
  const config: CdnConfig = {
    ...createBaseConfig('cloudfront'),
    cloudfront: { distributionId: 'E1234567890', region: 'us-east-1' },
  };

  it('should generate asset URLs', () => {
    const adapter = new CloudFrontCdnAdapter(config);
    const result = adapter.getAssetUrl({
      path: 'logo.png',
      category: 'branding',
      tenantId: 'tenant-1',
      version: 'v1',
    });

    expect(result.url).toBe('https://cdn.proctira.org/branding/tenant-1/logo.png?v=v1');
  });

  it('should return successful invalidation result', async () => {
    const adapter = new CloudFrontCdnAdapter(config);
    const result = await adapter.invalidate({
      paths: ['/branding/tenant-1/*'],
      tenantId: 'tenant-1',
      reason: 'Logo updated',
    });

    expect(result.success).toBe(true);
    expect(result.invalidationId).toContain('CF-E1234567890');
    expect(result.estimatedCompletionSeconds).toBe(300);
  });

  it('should return healthy status', async () => {
    const adapter = new CloudFrontCdnAdapter(config);
    const health = await adapter.healthCheck();

    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('cloudfront');
    expect(health.baseUrl).toBe('https://cdn.proctira.org');
    expect(health.details).toEqual({
      distributionId: 'E1234567890',
      region: 'us-east-1',
    });
  });
});

describe('NginxCdnAdapter', () => {
  const config = createBaseConfig('nginx');

  it('should generate asset URLs', () => {
    const adapter = new NginxCdnAdapter(config);
    const result = adapter.getAssetUrl({
      path: 'css/main.css',
      category: 'static',
    });

    expect(result.url).toBe('https://cdn.proctira.org/static/css/main.css');
  });

  it('should return successful invalidation result', async () => {
    const adapter = new NginxCdnAdapter(config);
    const result = await adapter.invalidate({
      paths: ['/static/css/main.css'],
    });

    expect(result.success).toBe(true);
    expect(result.invalidationId).toContain('nginx-');
    expect(result.estimatedCompletionSeconds).toBe(1);
  });

  it('should return healthy status', async () => {
    const adapter = new NginxCdnAdapter(config);
    const health = await adapter.healthCheck();

    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('nginx');
  });
});

describe('CustomCdnAdapter', () => {
  it('should generate asset URLs', () => {
    const config = createBaseConfig('custom');
    const adapter = new CustomCdnAdapter(config);
    const result = adapter.getAssetUrl({
      path: 'images/banner.jpg',
      category: 'upload',
      tenantId: 'tenant-2',
    });

    expect(result.url).toBe('https://cdn.proctira.org/uploads/tenant-2/images/banner.jpg');
  });

  it('should return no-op invalidation when no endpoint configured', async () => {
    const config = createBaseConfig('custom');
    const adapter = new CustomCdnAdapter(config);
    const result = await adapter.invalidate({
      paths: ['/uploads/*'],
    });

    expect(result.success).toBe(true);
    expect(result.invalidationId).toContain('custom-noop');
    expect(result.estimatedCompletionSeconds).toBe(0);
  });

  it('should attempt invalidation when endpoint is configured', async () => {
    const config: CdnConfig = {
      ...createBaseConfig('custom'),
      custom: {
        invalidationEndpoint: 'https://purge.example.com/api/invalidate',
        headers: { 'X-API-Key': 'secret' },
      },
    };
    const adapter = new CustomCdnAdapter(config);
    const result = await adapter.invalidate({
      paths: ['/uploads/tenant-1/*'],
      tenantId: 'tenant-1',
      reason: 'File updated',
    });

    expect(result.success).toBe(true);
    expect(result.invalidationId).toContain('custom-');
    expect(result.estimatedCompletionSeconds).toBe(60);
  });

  it('should report health with invalidation endpoint info', async () => {
    const config: CdnConfig = {
      ...createBaseConfig('custom'),
      custom: { invalidationEndpoint: 'https://purge.example.com/api/invalidate' },
    };
    const adapter = new CustomCdnAdapter(config);
    const health = await adapter.healthCheck();

    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('custom');
    expect(health.details?.hasInvalidationEndpoint).toBe(true);
  });
});
