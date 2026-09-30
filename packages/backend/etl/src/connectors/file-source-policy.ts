/**
 * File-source policy for tenant-controlled ETL connectors (PRC-C003).
 *
 * CSV/Excel connectors previously read an arbitrary `filePath` from the host filesystem
 * (local file inclusion — e.g. `/etc/passwd`, `.env`, other tenants' spooled files) because
 * the path came straight from tenant-authored pipeline config. Tenant pipelines must never
 * name a host path. Data may only arrive as inline content (size-capped) or, in future,
 * a tenant-scoped object-storage key resolved by the storage service — never a raw path.
 *
 * This helper fails closed: any `filePath` is rejected.
 */
export class FileSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSourceError';
  }
}

/** Max inline content size (~10 MiB of UTF-8 / base64 text) to bound memory. */
export const MAX_INLINE_CONTENT_BYTES = 10 * 1024 * 1024;

/**
 * Reject tenant-supplied host file paths. Callers must supply inline content instead.
 */
export function assertNoHostFilePath(filePath: string | undefined): void {
  if (filePath !== undefined && filePath !== null && String(filePath).trim() !== '') {
    throw new FileSourceError(
      'Reading files by host path is not allowed for tenant pipelines: provide inline ' +
        'fileContent (or a tenant-scoped storage key) instead of filePath',
    );
  }
}

/**
 * Bound inline content size to avoid unbounded memory use from a single pipeline.
 */
export function assertInlineContentWithinCap(byteLength: number): void {
  if (byteLength > MAX_INLINE_CONTENT_BYTES) {
    throw new FileSourceError(
      `Inline file content exceeds the ${MAX_INLINE_CONTENT_BYTES}-byte limit`,
    );
  }
}
