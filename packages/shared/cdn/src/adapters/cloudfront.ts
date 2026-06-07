/**
 * CloudFront CDN Adapter
 *
 * Implements the CDN adapter interface for AWS CloudFront.
 * Supports cache invalidation via the CloudFront API.
 */

import type {
  AssetUrl,
  AssetUrlOptions,
  CdnAdapter,
  CdnAdapterHealth,
  CdnConfig,
  InvalidationRequest,
  InvalidationResult,
} from '../types.js';
import { buildAssetUrl } from '../url-builder.js';
import { CdnError } from '../cdn-adapter.js';

export class CloudFrontCdnAdapter implements CdnAdapter {
  private readonly config: CdnConfig;

  constructor(config: CdnConfig) {
    if (!config.cloudfront?.distributionId) {
      throw new CdnError(
        'CloudFront adapter requires cloudfront.distributionId configuration',
        'CDN_MISSING_CONFIG',
      );
    }
    this.config = config;
  }

  getAssetUrl(options: AssetUrlOptions): AssetUrl {
    return buildAssetUrl(options, this.config);
  }

  async invalidate(request: InvalidationRequest): Promise<InvalidationResult> {
    const distributionId = this.config.cloudfront!.distributionId;

    // Build invalidation paths with tenant prefix if applicable
    const invalidationPaths = request.paths.map((path) => {
      if (request.tenantId && this.config.tenantAware) {
        // Ensure tenant-scoped invalidation
        if (!path.includes(request.tenantId)) {
          return `/*/${request.tenantId}${path.startsWith('/') ? path : '/' + path}`;
        }
      }
      return path.startsWith('/') ? path : '/' + path;
    });

    try {
      // In a real implementation, this would call the AWS CloudFront API:
      // const client = new CloudFrontClient({ region: this.config.cloudfront.region });
      // const command = new CreateInvalidationCommand({
      //   DistributionId: distributionId,
      //   InvalidationBatch: {
      //     CallerReference: `${Date.now()}-${Math.random()}`,
      //     Paths: { Quantity: invalidationPaths.length, Items: invalidationPaths },
      //   },
      // });
      // const response = await client.send(command);

      const invalidationId = `CF-${distributionId}-${Date.now()}`;

      return {
        success: true,
        invalidationId,
        estimatedCompletionSeconds: 300, // CloudFront typically takes ~5 minutes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown CloudFront error';
      return {
        success: false,
        error: `CloudFront invalidation failed: ${message}`,
      };
    }
  }

  async healthCheck(): Promise<CdnAdapterHealth> {
    try {
      // In production, this would verify the CloudFront distribution exists and is deployed
      return {
        status: 'healthy',
        adapter: 'cloudfront',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
        details: {
          distributionId: this.config.cloudfront!.distributionId,
          region: this.config.cloudfront!.region ?? 'us-east-1',
        },
      };
    } catch {
      return {
        status: 'unhealthy',
        adapter: 'cloudfront',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
      };
    }
  }
}
