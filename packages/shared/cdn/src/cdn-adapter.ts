/**
 * CDN Adapter Factory
 *
 * Creates CDN adapter instances based on configuration.
 * Supports CloudFront, Nginx, and custom CDN providers.
 */

import type { CdnAdapter, CdnConfig } from './types.js';
import { CloudFrontCdnAdapter } from './adapters/cloudfront.js';
import { NginxCdnAdapter } from './adapters/nginx.js';
import { CustomCdnAdapter } from './adapters/custom.js';

/**
 * Error thrown when CDN adapter creation or operation fails.
 */
export class CdnError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'CDN_ERROR') {
    super(message);
    this.name = 'CdnError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Creates a CDN adapter instance based on the provided configuration.
 *
 * @param config - CDN configuration specifying the adapter type and settings
 * @returns A configured CDN adapter instance
 * @throws CdnError if the adapter type is unsupported
 */
export function createCdnAdapter(config: CdnConfig): CdnAdapter {
  switch (config.adapter) {
    case 'cloudfront':
      return new CloudFrontCdnAdapter(config);
    case 'nginx':
      return new NginxCdnAdapter(config);
    case 'custom':
      return new CustomCdnAdapter(config);
    default:
      throw new CdnError(
        `Unsupported CDN adapter: ${String((config as { adapter: string }).adapter)}`,
        'CDN_UNSUPPORTED_ADAPTER',
      );
  }
}
