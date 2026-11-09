/**
 * CloudFront CDN Adapter
 *
 * Implements the CDN adapter interface for AWS CloudFront.
 *
 * PRC-L489: invalidate() and healthCheck() call the CloudFront API
 * (CreateInvalidation / GetDistribution) instead of returning a fabricated success.
 * Credentials come from the default AWS provider chain (IRSA / instance role); none are
 * read from CdnConfig.
 */
import { randomUUID } from 'node:crypto';

import {
  CloudFrontClient,
  CreateInvalidationCommand,
  GetDistributionCommand,
  type CreateInvalidationCommandOutput,
  type GetDistributionCommandOutput,
} from '@aws-sdk/client-cloudfront';

import type {
  AssetUrl,
  AssetUrlOptions,
  CdnAdapter,
  CdnAdapterDeps,
  CdnAdapterHealth,
  CdnConfig,
  InvalidationRequest,
  InvalidationResult,
} from '../types.js';
import { buildAssetUrl } from '../url-builder.js';
import { CdnError } from '../cdn-adapter.js';

type CloudFrontLike = NonNullable<CdnAdapterDeps['cloudFrontClient']>;

export class CloudFrontCdnAdapter implements CdnAdapter {
  private readonly config: CdnConfig;
  private client: CloudFrontLike | null;

  constructor(config: CdnConfig, deps: CdnAdapterDeps = {}) {
    if (!config.cloudfront?.distributionId) {
      throw new CdnError(
        'CloudFront adapter requires cloudfront.distributionId configuration',
        'CDN_MISSING_CONFIG',
      );
    }
    this.config = config;
    this.client = deps.cloudFrontClient ?? null;
  }

  private getClient(): CloudFrontLike {
    if (!this.client) {
      this.client = new CloudFrontClient({
        region: this.config.cloudfront?.region ?? 'us-east-1',
      }) as unknown as CloudFrontLike;
    }
    return this.client;
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

    if (invalidationPaths.length === 0) {
      return { success: false, error: 'CloudFront invalidation failed: no paths given' };
    }

    try {
      const response = (await this.getClient().send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: randomUUID(),
            Paths: { Quantity: invalidationPaths.length, Items: invalidationPaths },
          },
        }),
      )) as CreateInvalidationCommandOutput;
      const invalidationId = response.Invalidation?.Id;
      if (!invalidationId) {
        return {
          success: false,
          error: 'CloudFront invalidation failed: response carried no invalidation id',
        };
      }
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
    const distributionId = this.config.cloudfront!.distributionId;
    const region = this.config.cloudfront!.region ?? 'us-east-1';
    try {
      const response = (await this.getClient().send(
        new GetDistributionCommand({ Id: distributionId }),
      )) as GetDistributionCommandOutput;
      const status = response.Distribution?.Status;
      const enabled = response.Distribution?.DistributionConfig?.Enabled;
      return {
        status:
          status === 'Deployed' && enabled === true
            ? 'healthy'
            : status === 'InProgress' && enabled === true
              ? 'degraded'
              : 'unhealthy',
        adapter: 'cloudfront',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
        details: { distributionId, region, distributionStatus: status ?? null, enabled },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        adapter: 'cloudfront',
        baseUrl: this.config.baseUrl,
        lastCheck: new Date(),
        details: {
          distributionId,
          region,
          error: error instanceof Error ? error.message : 'Unknown CloudFront error',
        },
      };
    }
  }
}
