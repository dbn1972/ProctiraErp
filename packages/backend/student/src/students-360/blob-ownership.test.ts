/**
 * PRC-M634 — raw-key storage ownership is enforced on the real caller path.
 *
 * The adapter already rejects a cross-tenant key *when a callerTenantId is
 * supplied* (storage-security.test.ts). The live gap this test guards is the
 * caller layer: before the fix the blob-store wrappers called
 * `adapter.download(key)` / `adapter.delete(key)` / `adapter.getSignedUrl(key)`
 * with NO caller tenant, so the ownership assertion was skipped and one tenant
 * could read/delete/sign another tenant's well-formed object key.
 *
 * The fake adapter below reproduces the real adapter contract: it asserts
 * tenant ownership using the SAME helper the S3/MinIO adapters use. If the
 * store omits the owning tenant (base behaviour), `callerTenantId` is
 * `undefined`, the ownership guard fails closed, and these expectations fail.
 */
import { Readable } from 'node:stream';

import type { ListOptions, ListResult, StorageAdapter, UploadOptions } from '@proctira/storage';
import { assertTenantOwnedObjectKey } from '@proctira/storage';
import { describe, it, expect } from 'vitest';

import { StorageAdapterStudentBlobStore } from './blob-store.js';

const OWNER = 'tenant-a';
const OTHER = 'tenant-b';

/** A fake that mirrors the real adapter's PRC-M634 ownership enforcement. */
function ownershipEnforcingAdapter(): StorageAdapter {
  return {
    async upload(key: string, _data, options: UploadOptions) {
      return { key, bucket: 'b', encryption: undefined, lifecycle: options.lifecycle };
    },
    async download(key: string, callerTenantId: string) {
      assertTenantOwnedObjectKey(key, callerTenantId, 'storage.download');
      return Readable.from([Buffer.from('%PDF-1.4 x')]);
    },
    async delete(key: string, callerTenantId: string) {
      assertTenantOwnedObjectKey(key, callerTenantId, 'storage.delete');
    },
    async getSignedUrl(key: string, _expiresIn: number, callerTenantId: string) {
      assertTenantOwnedObjectKey(key, callerTenantId, 'storage.getSignedUrl');
      return 'https://signed.example/obj';
    },
    async listObjects(_prefix: string, _options: ListOptions | undefined, callerTenantId: string) {
      assertTenantOwnedObjectKey(_prefix, callerTenantId, 'storage.listObjects');
      return { objects: [], isTruncated: false } as ListResult;
    },
    async healthCheck() {
      return { healthy: true, message: 'ok', latencyMs: 0, adapter: 'fake', checkedAt: new Date() };
    },
  } as unknown as StorageAdapter;
}

describe('StudentBlobStore raw-key ownership on the caller path (PRC-M634)', () => {
  const ownKey = `tenants/${OWNER}/students/s1/doc.pdf`;
  const foreignKey = `tenants/${OTHER}/students/s9/doc.pdf`;

  it('get() passes the owning tenant so the caller may read its own object', async () => {
    const store = new StorageAdapterStudentBlobStore(ownershipEnforcingAdapter());
    await expect(store.get(ownKey, OWNER)).resolves.toBeInstanceOf(Buffer);
  });

  it('get() of a cross-tenant key is rejected (StudentBlobStorageError, not a silent read)', async () => {
    const store = new StorageAdapterStudentBlobStore(ownershipEnforcingAdapter());
    // Caller is OWNER but the key belongs to OTHER -> ownership guard must fire.
    await expect(store.get(foreignKey, OWNER)).rejects.toThrow();
  });

  it('delete() of a cross-tenant key is rejected', async () => {
    const store = new StorageAdapterStudentBlobStore(ownershipEnforcingAdapter());
    await expect(store.delete(foreignKey, OWNER)).rejects.toThrow();
  });

  it('getSignedUrl() of a cross-tenant key returns null (guard throws, wrapper swallows)', async () => {
    const store = new StorageAdapterStudentBlobStore(ownershipEnforcingAdapter());
    await expect(store.getSignedUrl(foreignKey, OWNER)).resolves.toBeNull();
    await expect(store.getSignedUrl(ownKey, OWNER)).resolves.toBe('https://signed.example/obj');
  });
});
