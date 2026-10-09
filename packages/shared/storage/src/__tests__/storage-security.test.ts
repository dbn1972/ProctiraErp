/**
 * PRC-M542 — MinIO KMS key forwarding, production TLS guard, signed-URL clamp.
 * PRC-M366 — lifecycle class written as an object TAG (not just metadata) so
 * bucket lifecycle/ILM rules can target it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { UploadOptions } from '../types.js';
import { MAX_SIGNED_URL_EXPIRY_SECONDS, clampSignedUrlExpiry } from '../tenant-namespace.js';

const mockSend = vi.fn();
const putParams: Array<Record<string, unknown>> = [];
const signOptions: Array<{ expiresIn?: number }> = [];

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((params) => {
    putParams.push(params);
    return { ...params, _type: 'PutObject' };
  }),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  DeleteObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Delete' })),
  ListObjectsV2Command: vi.fn().mockImplementation((params) => ({ ...params, _type: 'List' })),
  HeadBucketCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Head' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockImplementation((_c: unknown, _cmd: unknown, opts: { expiresIn?: number }) => {
      signOptions.push(opts);
      return Promise.resolve('https://example/signed');
    }),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(() => ({
    done: vi.fn().mockResolvedValue({ ETag: '"e"', VersionId: 'v' }),
  })),
}));

const { MinIOAdapter } = await import('../adapters/minio-adapter.js');
const { S3Adapter } = await import('../adapters/s3-adapter.js');

function minio(overrides = {}) {
  return new MinIOAdapter({
    endpoint: 'http://localhost:9000',
    accessKey: 'a',
    secretKey: 'b',
    bucket: 'bkt',
    ...overrides,
  });
}

describe('clampSignedUrlExpiry (PRC-M542)', () => {
  it('caps at the S3 SigV4 maximum of 7 days', () => {
    expect(clampSignedUrlExpiry(999_999_999, 3600)).toBe(MAX_SIGNED_URL_EXPIRY_SECONDS);
  });
  it('rejects zero / negative / non-finite by falling back then clamping', () => {
    expect(clampSignedUrlExpiry(0, 3600)).toBe(3600);
    expect(clampSignedUrlExpiry(-5, 3600)).toBe(3600);
    expect(clampSignedUrlExpiry(undefined, 3600)).toBe(3600);
    expect(clampSignedUrlExpiry(Number.NaN, 3600)).toBe(3600);
  });
  it('passes a sane value through', () => {
    expect(clampSignedUrlExpiry(120, 3600)).toBe(120);
  });
});

describe('MinIOAdapter security (PRC-M542)', () => {
  const prevEnv = process.env.NODE_ENV;
  beforeEach(() => {
    mockSend.mockReset();
    putParams.length = 0;
    signOptions.length = 0;
  });
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
  });

  it('forwards SSEKMSKeyId for aws:kms uploads', async () => {
    const adapter = minio({ defaultEncryption: 'aws:kms', defaultKmsKeyId: 'arn:kms:key/1' });
    mockSend.mockResolvedValueOnce({ ETag: '"e"' });
    await adapter.upload('f.pdf', Buffer.from('x'), { tenantId: 't1' } as UploadOptions);
    expect(putParams[0]!.ServerSideEncryption).toBe('aws:kms');
    expect(putParams[0]!.SSEKMSKeyId).toBe('arn:kms:key/1');
  });

  it('refuses plaintext HTTP in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => minio({ useSSL: false })).toThrow(/TLS is required|PRC-M542/);
  });

  it('allows https endpoint in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => minio({ endpoint: 'https://minio.internal:9000', useSSL: true })).not.toThrow();
  });

  it('clamps an over-long signed URL lifetime', async () => {
    const adapter = minio();
    await adapter.getSignedUrl('tenants/t1/f.pdf', 999_999_999);
    expect(signOptions[0]!.expiresIn).toBe(MAX_SIGNED_URL_EXPIRY_SECONDS);
  });
});

describe('lifecycle tagging (PRC-M366)', () => {
  beforeEach(() => {
    mockSend.mockReset();
    putParams.length = 0;
  });

  it('S3 upload sets the lifecycle class as an object Tag', async () => {
    const adapter = new S3Adapter({ bucket: 'b', region: 'ap-south-1' });
    mockSend.mockResolvedValueOnce({ ETag: '"e"' });
    await adapter.upload('f.pdf', Buffer.from('x'), {
      tenantId: 't1',
      lifecycle: 'temporary',
    } as UploadOptions);
    expect(putParams[0]!.Tagging).toBe('x-proctira-lifecycle=temporary');
  });

  it('MinIO upload sets the lifecycle class as an object Tag', async () => {
    const adapter = minio();
    mockSend.mockResolvedValueOnce({ ETag: '"e"' });
    await adapter.upload('f.pdf', Buffer.from('x'), {
      tenantId: 't1',
      lifecycle: 'archive',
    } as UploadOptions);
    expect(putParams[0]!.Tagging).toBe('x-proctira-lifecycle=archive');
  });

  it('no Tagging param when no lifecycle class is set', async () => {
    const adapter = minio();
    mockSend.mockResolvedValueOnce({ ETag: '"e"' });
    await adapter.upload('f.pdf', Buffer.from('x'), { tenantId: 't1' } as UploadOptions);
    expect(putParams[0]!.Tagging).toBeUndefined();
  });
});

describe('raw-key tenant ownership (PRC-M634)', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('download rejects a key owned by another tenant when callerTenantId is given', async () => {
    const adapter = minio();
    await expect(adapter.download('tenants/other/f.pdf', 'me')).rejects.toThrow(
      /not owned by tenant|PRC-M634/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('delete rejects a cross-tenant key before issuing the SDK call', async () => {
    const adapter = minio();
    await expect(adapter.delete('tenants/other/f.pdf', 'me')).rejects.toThrow(/PRC-M634|not owned/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('getSignedUrl allows a key the caller owns', async () => {
    const adapter = minio();
    await expect(adapter.getSignedUrl('tenants/me/f.pdf', 60, 'me')).resolves.toBeDefined();
  });

  it('listObjects rejects a prefix owned by another tenant', async () => {
    const adapter = minio();
    await expect(adapter.listObjects('tenants/other/', undefined, 'me')).rejects.toThrow(
      /PRC-M634|not owned/,
    );
  });
});
