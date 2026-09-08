/**
 * Contract tests for StorageAdapter implementations.
 * These tests verify that all adapter implementations satisfy the same behavioral contract.
 * They use mocked S3 clients to test the adapter logic without requiring real infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { StorageAdapter, UploadOptions } from '../types.js';

// Create a shared mock send function
const mockSend = vi.fn();

// Mock the AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  DeleteObjectCommand: vi
    .fn()
    .mockImplementation((params) => ({ ...params, _type: 'DeleteObject' })),
  ListObjectsV2Command: vi
    .fn()
    .mockImplementation((params) => ({ ...params, _type: 'ListObjectsV2' })),
  HeadBucketCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'HeadBucket' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/signed-url?token=abc'),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(() => ({
    done: vi.fn().mockResolvedValue({ ETag: '"stream-etag"', VersionId: 'v2' }),
  })),
}));

/**
 * Contract test suite that runs against any StorageAdapter implementation.
 */
function runContractTests(adapterName: string, createAdapter: () => StorageAdapter) {
  describe(`StorageAdapter contract: ${adapterName}`, () => {
    let adapter: StorageAdapter;

    beforeEach(() => {
      mockSend.mockReset();
      adapter = createAdapter();
    });

    describe('upload', () => {
      it('should namespace the key with tenant prefix', async () => {
        mockSend.mockResolvedValueOnce({ ETag: '"abc123"', VersionId: 'v1' });

        const options: UploadOptions = {
          tenantId: 'tenant-001',
          contentType: 'application/pdf',
        };

        const result = await adapter.upload('documents/report.pdf', Buffer.from('data'), options);

        expect(result.key).toBe('tenants/tenant-001/documents/report.pdf');
        expect(result.bucket).toBeDefined();
      });

      it('should return storage result with etag', async () => {
        mockSend.mockResolvedValueOnce({ ETag: '"etag-value"', VersionId: 'v1' });

        const options: UploadOptions = { tenantId: 'tenant-001' };
        const result = await adapter.upload('file.txt', Buffer.from('hello'), options);

        expect(result.etag).toBe('etag-value');
      });

      it('should apply encryption when specified', async () => {
        mockSend.mockResolvedValueOnce({ ETag: '"enc-etag"' });

        const options: UploadOptions = {
          tenantId: 'tenant-001',
          encryption: 'AES256',
        };

        const result = await adapter.upload('secret.dat', Buffer.from('secret'), options);
        expect(result.encryption).toBe('AES256');
      });

      it('should apply KMS encryption when specified', async () => {
        mockSend.mockResolvedValueOnce({ ETag: '"kms-etag"' });

        const options: UploadOptions = {
          tenantId: 'tenant-001',
          encryption: 'aws:kms',
          kmsKeyId: 'arn:aws:kms:us-east-1:123456:key/abc',
        };

        const result = await adapter.upload('secret.dat', Buffer.from('secret'), options);
        expect(result.encryption).toBe('aws:kms');
      });

      it('should store lifecycle metadata', async () => {
        mockSend.mockResolvedValueOnce({ ETag: '"lc-etag"' });

        const options: UploadOptions = {
          tenantId: 'tenant-001',
          lifecycle: 'temporary',
        };

        const result = await adapter.upload('temp.dat', Buffer.from('temp'), options);
        expect(result.lifecycle).toBe('temporary');
      });

      it('should handle stream uploads', async () => {
        const stream = Readable.from(['stream', ' ', 'data']);
        const options: UploadOptions = { tenantId: 'tenant-001' };

        const result = await adapter.upload('stream-file.txt', stream, options);
        expect(result.key).toBe('tenants/tenant-001/stream-file.txt');
      });
    });

    describe('download', () => {
      it('should return a readable stream', async () => {
        const mockStream = Readable.from(['file content']);
        mockSend.mockResolvedValueOnce({ Body: mockStream });

        const result = await adapter.download('tenants/tenant-001/file.txt');
        expect(result).toBeInstanceOf(Readable);
      });

      it('should throw when object not found', async () => {
        mockSend.mockResolvedValueOnce({ Body: null });

        await expect(adapter.download('tenants/tenant-001/missing.txt')).rejects.toThrow(
          'Object not found',
        );
      });
    });

    describe('delete', () => {
      it('should delete without throwing', async () => {
        mockSend.mockResolvedValueOnce({});

        await expect(adapter.delete('tenants/tenant-001/file.txt')).resolves.toBeUndefined();
      });
    });

    describe('getSignedUrl', () => {
      it('should return a signed URL string', async () => {
        const url = await adapter.getSignedUrl('tenants/tenant-001/file.txt', 3600);
        expect(url).toContain('https://');
      });
    });

    describe('listObjects', () => {
      it('should return objects matching prefix', async () => {
        mockSend.mockResolvedValueOnce({
          Contents: [
            {
              Key: 'tenants/tenant-001/file1.txt',
              Size: 100,
              LastModified: new Date('2024-01-01'),
              ETag: '"e1"',
            },
            {
              Key: 'tenants/tenant-001/file2.txt',
              Size: 200,
              LastModified: new Date('2024-01-02'),
              ETag: '"e2"',
            },
          ],
          IsTruncated: false,
        });

        const result = await adapter.listObjects('tenants/tenant-001/');

        expect(result.objects).toHaveLength(2);
        expect(result.objects[0]!.key).toBe('tenants/tenant-001/file1.txt');
        expect(result.objects[0]!.size).toBe(100);
        expect(result.isTruncated).toBe(false);
      });

      it('should handle pagination', async () => {
        mockSend.mockResolvedValueOnce({
          Contents: [{ Key: 'tenants/tenant-001/file1.txt', Size: 100, LastModified: new Date() }],
          IsTruncated: true,
          NextContinuationToken: 'next-token',
        });

        const result = await adapter.listObjects('tenants/tenant-001/', { maxKeys: 1 });

        expect(result.isTruncated).toBe(true);
        expect(result.nextContinuationToken).toBe('next-token');
      });

      it('should handle empty results', async () => {
        mockSend.mockResolvedValueOnce({
          Contents: [],
          IsTruncated: false,
        });

        const result = await adapter.listObjects('tenants/tenant-001/empty/');
        expect(result.objects).toHaveLength(0);
      });

      it('should handle common prefixes with delimiter', async () => {
        mockSend.mockResolvedValueOnce({
          Contents: [],
          IsTruncated: false,
          CommonPrefixes: [
            { Prefix: 'tenants/tenant-001/documents/' },
            { Prefix: 'tenants/tenant-001/images/' },
          ],
        });

        const result = await adapter.listObjects('tenants/tenant-001/', { delimiter: '/' });
        expect(result.commonPrefixes).toEqual([
          'tenants/tenant-001/documents/',
          'tenants/tenant-001/images/',
        ]);
      });
    });

    describe('healthCheck', () => {
      it('should return healthy status when bucket is accessible', async () => {
        mockSend.mockResolvedValueOnce({});

        const health = await adapter.healthCheck();

        expect(health.healthy).toBe(true);
        expect(health.adapter).toBe(adapterName);
        expect(health.latencyMs).toBeGreaterThanOrEqual(0);
        expect(health.checkedAt).toBeInstanceOf(Date);
      });

      it('should return unhealthy status when bucket is not accessible', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        const health = await adapter.healthCheck();

        expect(health.healthy).toBe(false);
        expect(health.message).toContain('Access Denied');
        expect(health.adapter).toBe(adapterName);
      });
    });
  });
}

// Import adapters after mocks are set up
const { S3Adapter } = await import('../adapters/s3-adapter.js');
const { MinIOAdapter } = await import('../adapters/minio-adapter.js');

// Run contract tests for S3 adapter
runContractTests(
  's3',
  () =>
    new S3Adapter({
      bucket: 'test-bucket',
      region: 'us-east-1',
    }),
);

// Run contract tests for MinIO adapter
runContractTests(
  'minio',
  () =>
    new MinIOAdapter({
      endpoint: 'http://localhost:9000',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'test-bucket',
    }),
);
