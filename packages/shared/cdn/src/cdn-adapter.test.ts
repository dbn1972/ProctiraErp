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

/**
 * PRC-L489 — the adapters used to return success without calling the CDN, and these tests
 * asserted the stub (fabricated `CF-<id>-<ts>` ids, unconditional `healthy`). They now
 * assert the real request each adapter makes and that provider failures surface.
 */
type Call = { url: string; init: RequestInit };

function fakeFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function fakeCloudFront(responder: (command: unknown) => unknown) {
  const commands: unknown[] = [];
  return {
    commands,
    client: {
      async send(command: unknown) {
        commands.push(command);
        return responder(command);
      },
    },
  };
}

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

  it('sends CreateInvalidation and returns the id CloudFront assigned', async () => {
    const cf = fakeCloudFront(() => ({ Invalidation: { Id: 'I2J3K4L5', Status: 'InProgress' } }));
    const adapter = new CloudFrontCdnAdapter(config, { cloudFrontClient: cf.client });
    const result = await adapter.invalidate({
      paths: ['/branding/tenant-1/*'],
      tenantId: 'tenant-1',
      reason: 'Logo updated',
    });
    expect(result).toEqual({
      success: true,
      invalidationId: 'I2J3K4L5',
      estimatedCompletionSeconds: 300,
    });
    expect(cf.commands).toHaveLength(1);
    const input = (
      cf.commands[0] as {
        input: {
          DistributionId: string;
          InvalidationBatch: { CallerReference: unknown; Paths: unknown };
        };
      }
    ).input;
    expect(input.DistributionId).toBe('E1234567890');
    expect(input.InvalidationBatch.Paths).toEqual({
      Quantity: 1,
      Items: ['/branding/tenant-1/*'],
    });
    expect(typeof input.InvalidationBatch.CallerReference).toBe('string');
  });

  it('reports failure when the CloudFront API rejects the invalidation', async () => {
    const cf = fakeCloudFront(() => {
      throw new Error('AccessDenied');
    });
    const adapter = new CloudFrontCdnAdapter(config, { cloudFrontClient: cf.client });
    const result = await adapter.invalidate({ paths: ['/static/*'] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('AccessDenied');
  });

  it('is healthy only when GetDistribution says Deployed and enabled', async () => {
    const deployed = fakeCloudFront(() => ({
      Distribution: { Status: 'Deployed', DistributionConfig: { Enabled: true } },
    }));
    const health = await new CloudFrontCdnAdapter(config, {
      cloudFrontClient: deployed.client,
    }).healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('cloudfront');
    expect(health.baseUrl).toBe('https://cdn.proctira.org');
    expect(health.details).toMatchObject({ distributionId: 'E1234567890', region: 'us-east-1' });
    expect((deployed.commands[0] as { input: { Id: string } }).input.Id).toBe('E1234567890');

    const disabled = fakeCloudFront(() => ({
      Distribution: { Status: 'Deployed', DistributionConfig: { Enabled: false } },
    }));
    expect(
      (await new CloudFrontCdnAdapter(config, { cloudFrontClient: disabled.client }).healthCheck())
        .status,
    ).toBe('unhealthy');

    const failing = fakeCloudFront(() => {
      throw new Error('NoSuchDistribution');
    });
    const down = await new CloudFrontCdnAdapter(config, {
      cloudFrontClient: failing.client,
    }).healthCheck();
    expect(down.status).toBe('unhealthy');
    expect(down.details?.error).toBe('NoSuchDistribution');
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

  it('sends a PURGE request per path', async () => {
    const http = fakeFetch(() => new Response(null, { status: 200 }));
    const adapter = new NginxCdnAdapter(config, { fetchImpl: http.fetchImpl });
    const result = await adapter.invalidate({
      paths: ['/static/css/main.css', 'branding/tenant-1/logo.png'],
    });
    expect(result.success).toBe(true);
    expect(result.invalidationId).toContain('nginx-');
    expect(http.calls.map((c) => [c.init.method, c.url])).toEqual([
      ['PURGE', 'https://cdn.proctira.org/static/css/main.css'],
      ['PURGE', 'https://cdn.proctira.org/branding/tenant-1/logo.png'],
    ]);
  });

  it('treats 404 (not cached) as purged but surfaces other HTTP errors', async () => {
    const http = fakeFetch((call) =>
      call.url.endsWith('a.css')
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 500 }),
    );
    const adapter = new NginxCdnAdapter(config, { fetchImpl: http.fetchImpl });
    expect((await adapter.invalidate({ paths: ['/static/a.css'] })).success).toBe(true);
    const failed = await adapter.invalidate({ paths: ['/static/b.css'] });
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('HTTP 500');
  });

  it('health probes the base URL', async () => {
    const ok = fakeFetch(() => new Response(null, { status: 200 }));
    const health = await new NginxCdnAdapter(config, { fetchImpl: ok.fetchImpl }).healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('nginx');
    expect(ok.calls[0]).toMatchObject({
      url: 'https://cdn.proctira.org',
      init: { method: 'HEAD' },
    });

    const down = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const unhealthy = await new NginxCdnAdapter(config, {
      fetchImpl: down.fetchImpl,
    }).healthCheck();
    expect(unhealthy.status).toBe('unhealthy');
    expect(unhealthy.details?.error).toBe('ECONNREFUSED');
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

  it('reports failure (not a no-op success) when no endpoint is configured', async () => {
    const adapter = new CustomCdnAdapter(createBaseConfig('custom'));
    const result = await adapter.invalidate({ paths: ['/uploads/*'] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('no invalidation endpoint configured');
  });

  it('POSTs the paths to the configured endpoint with the configured headers', async () => {
    const config: CdnConfig = {
      ...createBaseConfig('custom'),
      custom: {
        invalidationEndpoint: 'https://purge.example.com/api/invalidate',
        headers: { 'X-API-Key': 'secret' },
      },
    };
    const http = fakeFetch(() => Response.json({ id: 'purge-77' }, { status: 202 }));
    const adapter = new CustomCdnAdapter(config, { fetchImpl: http.fetchImpl });
    const result = await adapter.invalidate({
      paths: ['/uploads/tenant-1/*'],
      tenantId: 'tenant-1',
      reason: 'File updated',
    });
    expect(result).toEqual({
      success: true,
      invalidationId: 'purge-77',
      estimatedCompletionSeconds: 60,
    });
    expect(http.calls).toHaveLength(1);
    const [call] = http.calls;
    expect(call!.url).toBe('https://purge.example.com/api/invalidate');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.headers).toMatchObject({ 'X-API-Key': 'secret' });
    expect(JSON.parse(String(call!.init.body))).toEqual({
      paths: ['/uploads/tenant-1/*'],
      tenantId: 'tenant-1',
      reason: 'File updated',
    });
  });

  it('surfaces a non-2xx endpoint response as failure', async () => {
    const config: CdnConfig = {
      ...createBaseConfig('custom'),
      custom: { invalidationEndpoint: 'https://purge.example.com/api/invalidate' },
    };
    const http = fakeFetch(() => new Response('nope', { status: 403 }));
    const result = await new CustomCdnAdapter(config, { fetchImpl: http.fetchImpl }).invalidate({
      paths: ['/uploads/*'],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 403');
  });

  it('health is degraded without an invalidation endpoint and reports reachability', async () => {
    const ok = fakeFetch(() => new Response(null, { status: 200 }));
    const withEndpoint: CdnConfig = {
      ...createBaseConfig('custom'),
      custom: { invalidationEndpoint: 'https://purge.example.com/api/invalidate' },
    };
    const health = await new CustomCdnAdapter(withEndpoint, {
      fetchImpl: ok.fetchImpl,
    }).healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.adapter).toBe('custom');
    expect(health.details?.hasInvalidationEndpoint).toBe(true);

    const noEndpoint = await new CustomCdnAdapter(createBaseConfig('custom'), {
      fetchImpl: ok.fetchImpl,
    }).healthCheck();
    expect(noEndpoint.status).toBe('degraded');
  });
});
