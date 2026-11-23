/**
 * NEW-g4_apps_auth-006 — storage port for admission documents.
 *
 * A thin, tenant-aware port over the shared `@proctira/storage` abstraction so
 * the registration service can persist the actual uploaded bytes and record the
 * object key on the application document. Keeping it a narrow interface avoids a
 * hard dependency on the full StorageAdapter in unit tests.
 *
 * PRC-M330 / topic 18: bytes are malware-scanned before they are stored. Only a
 * `clean` verdict is written; an infected upload is refused (422) and a scanner
 * failure or a production deployment without `CLAMAV_HOST` refuses the upload
 * (503), so no unscanned document becomes usable.
 */
import { AppError } from '@proctira/common';
import { createMalwareScannerFromEnv, type MalwareScanner } from '@proctira/storage';

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
 * The scanner defaults to {@link createMalwareScannerFromEnv}.
 */
export function createRegistrationDocumentStorage(
  adapter: SharedStorageUploadPort,
  scanner: MalwareScanner = createMalwareScannerFromEnv(),
): RegistrationDocumentStorage {
  return {
    async putDocument({ tenantId, key, bytes, contentType }) {
      const verdict = await scanner.scan(bytes);
      if (verdict.status === 'infected') {
        throw new AppError(
          'The uploaded document failed the malware scan and was not stored.',
          'DOCUMENT_INFECTED',
          422,
        );
      }
      if (verdict.status !== 'clean') {
        throw new AppError(
          'Document scanning is temporarily unavailable; please try again shortly.',
          'DOCUMENT_SCAN_UNAVAILABLE',
          503,
        );
      }
      const result = await adapter.upload(key, bytes, {
        tenantId,
        contentType,
        lifecycle: 'permanent',
      });
      return result.key;
    },
  };
}
