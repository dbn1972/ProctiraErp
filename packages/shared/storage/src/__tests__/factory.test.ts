import { describe, it, expect, vi } from 'vitest';
import { createStorageAdapter } from '../factory.js';
import { S3Adapter } from '../adapters/s3-adapter.js';
import { MinIOAdapter } from '../adapters/minio-adapter.js';

// Mock the AWS SDK to prevent actual connections
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  HeadBucketCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(),
}));

describe('createStorageAdapter', () => {
  it('should create an S3Adapter for s3 config', () => {
    const adapter = createStorageAdapter({
      adapter: 's3',
      config: {
        bucket: 'my-bucket',
        region: 'us-east-1',
      },
    });

    expect(adapter).toBeInstanceOf(S3Adapter);
  });

  it('should create a MinIOAdapter for minio config', () => {
    const adapter = createStorageAdapter({
      adapter: 'minio',
      config: {
        endpoint: 'http://localhost:9000',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'my-bucket',
      },
    });

    expect(adapter).toBeInstanceOf(MinIOAdapter);
  });

  it('should throw for unsupported adapter type', () => {
    expect(() =>
      createStorageAdapter({
        adapter: 'unsupported' as never,
        config: {} as never,
      }),
    ).toThrow('Unsupported storage adapter');
  });
});
