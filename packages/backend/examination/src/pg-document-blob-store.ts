/**
 * PRC-H052 — durable, shared DocumentBlobStore backed by Postgres (bytea).
 *
 * Generated PDFs were previously held in a process-local in-memory Map, so the
 * worker (queue mode) and the API never shared them and a restart lost them.
 * This store persists the bytes in `examination_document_blobs` (db/sql/125),
 * so any API or worker process reads back the same bytes.
 *
 * The storage key is `documents/<tenantId>/<examinationId>/<...>.pdf`; the
 * tenant id (2nd path segment) is used to bind `app.tenant_id` for RLS.
 */
import { createHash } from 'node:crypto';

import { getSharedPgPool, withPgTenant, type PgPoolWithConnect } from '@proctira/database';

import type { DocumentBlobStore } from './document-generation-service.js';

/** Extract the tenant id embedded as the 2nd path segment of a storage key. */
export function tenantIdFromDocumentKey(key: string): string | null {
  const parts = key.split('/');
  // documents/<tenantId>/<examinationId>/<file>
  const candidate = parts[1];
  return candidate && candidate.length > 0 ? candidate : null;
}

export class PgDocumentBlobStore implements DocumentBlobStore {
  constructor(private readonly pool: PgPoolWithConnect) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    const tenantId = tenantIdFromDocumentKey(key);
    if (!tenantId) {
      throw new Error(`PRC-H052: cannot derive tenant from document key '${key}'`);
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await withPgTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO examination_document_blobs
           (storage_key, tenant_id, content, byte_size, checksum, created_at, updated_at)
         VALUES ($1, $2::uuid, $3, $4, $5, now(), now())
         ON CONFLICT (storage_key) DO UPDATE SET
           content = EXCLUDED.content,
           byte_size = EXCLUDED.byte_size,
           checksum = EXCLUDED.checksum,
           updated_at = now()`,
        [key, tenantId, bytes, bytes.byteLength, checksum],
      );
    });
  }

  async get(key: string): Promise<Buffer | null> {
    const tenantId = tenantIdFromDocumentKey(key);
    if (!tenantId) return null;
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT content FROM examination_document_blobs WHERE storage_key = $1`,
        [key],
      );
      const row = result.rows[0] as { content?: Buffer } | undefined;
      if (!row?.content) return null;
      return Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    });
  }
}

/**
 * Durable blob store when a Postgres pool is configured, else null. Callers
 * decide the fallback (and whether to fail closed in production).
 */
export function createDocumentBlobStore(
  pool: PgPoolWithConnect | null = getSharedPgPool(),
): DocumentBlobStore | null {
  if (!pool) return null;
  return new PgDocumentBlobStore(pool);
}
