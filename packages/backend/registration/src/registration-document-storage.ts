/**
 * NEW-g4_apps_auth-006 — storage port for admission documents.
 *
 * A thin, tenant-aware port over the shared `@proctira/storage` abstraction so
 * the registration service can persist the actual uploaded bytes and record the
 * object key on the application document. Keeping it a narrow interface avoids a
 * hard dependency on the full StorageAdapter in unit tests.
 */
export interface RegistrationDocumentStorage {
  /**
   * Persist document bytes and return the stored object key (storagePath).
   * Implementations MUST namespace by tenant.
   */
  putDocument(params: {
    tenantId: string;
    key: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<string>;
}

/** Minimal shape of the shared StorageAdapter used by the adapter below. */
export interface SharedStorageUploadPort {
  upload(
    key: string,
    data: Buffer,
    options: { tenantId: string; contentType?: string; lifecycle?: 'permanent' },
  ): Promise<{ key: string }>;
}

/**
 * Adapt a shared `@proctira/storage` StorageAdapter to the narrow
 * {@link RegistrationDocumentStorage} port. The adapter prefixes the tenant
 * namespace itself, so the returned key is the full namespaced storagePath.
 */
export function createRegistrationDocumentStorage(
  adapter: SharedStorageUploadPort,
): RegistrationDocumentStorage {
  return {
    async putDocument({ tenantId, key, bytes, contentType }) {
      const result = await adapter.upload(key, bytes, {
        tenantId,
        contentType,
        lifecycle: 'permanent',
      });
      return result.key;
    },
  };
}
