import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ReportBlobReadError,
  createS3ReportBlobStore,
  type S3BlobStoreAdapter,
} from './blob-store.js';

/**
 * PRC-L342: report artifact blobs must be stored with server-side encryption
 * and their real content-type, and object reads must fail closed — a storage
 * fault (decrypt/permission/network) must surface as an error, never be
 * masked as "not found" (which would turn a 500 into a misleading 404).
 */

interface UploadCall {
  key: string;
  options: {
    tenantId?: string;
    contentType?: string;
    encryption?: string;
    kmsKeyId?: string;
    lifecycle?: string;
  };
}

function fakeAdapter(
  overrides: Partial<S3BlobStoreAdapter> & { uploads: UploadCall[] },
): S3BlobStoreAdapter {
  return {
    async upload(key, _data, options) {
      overrides.uploads.push({ key, options });
      return { key } as never;
    },
    async download() {
      throw new Error('not stubbed');
    },
    ...overrides,
  } as S3BlobStoreAdapter;
}

const TENANT = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('S3 report blob store — PRC-L342', () => {
  it('stores the real content-type and AES256 server-side encryption by default', async () => {
    const uploads: UploadCall[] = [];
    const store = createS3ReportBlobStore(fakeAdapter({ uploads }));

    await store.put(
      `${TENANT}/reports/a.csv`,
      Buffer.from('a,b\n1,2\n'),
      'text/csv; charset=utf-8',
    );

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.options.contentType).toBe('text/csv; charset=utf-8');
    expect(uploads[0]!.options.encryption).toBe('AES256');
    expect(uploads[0]!.options.tenantId).toBe(TENANT);
  });

  it('uses aws:kms with the configured key id when S3_SSE_KMS_KEY_ID is set', async () => {
    vi.stubEnv('S3_SSE_KMS_KEY_ID', 'arn:aws:kms:ap-south-1:1:key/abc');
    const uploads: UploadCall[] = [];
    const store = createS3ReportBlobStore(fakeAdapter({ uploads }));

    await store.put(`${TENANT}/reports/a.pdf`, Buffer.from('%PDF'), 'application/pdf');

    expect(uploads[0]!.options.encryption).toBe('aws:kms');
    expect(uploads[0]!.options.kmsKeyId).toBe('arn:aws:kms:ap-south-1:1:key/abc');
  });

  it('returns null only for a genuine not-found object', async () => {
    const uploads: UploadCall[] = [];
    const notFound = Object.assign(new Error('NoSuchKey'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    const store = createS3ReportBlobStore(
      fakeAdapter({
        uploads,
        async download() {
          throw notFound;
        },
      }),
    );

    await expect(store.get(`${TENANT}/reports/missing.csv`)).resolves.toBeNull();
  });

  it('fails closed: a decrypt/permission/network fault throws, never returns null', async () => {
    const uploads: UploadCall[] = [];
    const accessDenied = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const store = createS3ReportBlobStore(
      fakeAdapter({
        uploads,
        async download() {
          throw accessDenied;
        },
      }),
    );

    await expect(store.get(`${TENANT}/reports/a.csv`)).rejects.toBeInstanceOf(ReportBlobReadError);
  });

  it('returns the object bytes on a successful download', async () => {
    const uploads: UploadCall[] = [];
    const store = createS3ReportBlobStore(
      fakeAdapter({
        uploads,
        async download() {
          return Readable.from([Buffer.from('hello')]);
        },
      }),
    );

    const bytes = await store.get(`${TENANT}/reports/a.csv`);
    expect(bytes?.toString()).toBe('hello');
  });
});
