/**
 * Storage adapter factory.
 * Creates the appropriate adapter implementation based on configuration.
 */

import type { StorageAdapter, StorageAdapterConfig } from './types.js';
import { S3Adapter } from './adapters/s3-adapter.js';
import { MinIOAdapter } from './adapters/minio-adapter.js';

/**
 * Create a StorageAdapter instance based on the provided configuration.
 * This factory is used at install/bootstrap time to select the storage backend.
 *
 * @param config - The adapter configuration specifying which backend to use
 * @returns A configured StorageAdapter instance
 * @throws Error if the adapter type is not supported
 */
export function createStorageAdapter(config: StorageAdapterConfig): StorageAdapter {
  switch (config.adapter) {
    case 's3':
      return new S3Adapter(config.config);
    case 'minio':
      return new MinIOAdapter(config.config);
    default: {
      const exhaustiveCheck: never = config;
      throw new Error(`Unsupported storage adapter: ${(exhaustiveCheck as { adapter: string }).adapter}`);
    }
  }
}
