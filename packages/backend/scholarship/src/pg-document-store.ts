/**
 * Postgres metadata for scholarship application documents (db/sql/104).
 * Audit rows commit in the same transaction as the document mutation.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import {
  InMemoryScholarshipDocumentStore,
  type InsertScholarshipDocument,
  type ScholarshipApplicationDocument,
  type ScholarshipDocumentAudit,
  type ScholarshipDocumentStore,
} from './document-store.js';
import {
  ensureScholarshipSchema,
  getSharedScholarshipPool,
  type PgPoolLike,
} from './pg-scholarship-repository.js';

function mapRow(row: Record<string, unknown>): ScholarshipApplicationDocument {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    documentType: String(row.document_type),
    objectKey: String(row.object_key),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    uploadedBy: String(row.uploaded_by),
    uploadedAt:
      row.uploaded_at instanceof Date ? row.uploaded_at : new Date(String(row.uploaded_at)),
    verificationStatus: String(
      row.verification_status,
    ) as ScholarshipApplicationDocument['verificationStatus'],
    reviewerId: row.reviewer_id == null ? null : String(row.reviewer_id),
    rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
    reviewedAt:
      row.reviewed_at == null
        ? null
        : row.reviewed_at instanceof Date
          ? row.reviewed_at
          : new Date(String(row.reviewed_at)),
    deletedAt:
      row.deleted_at == null
        ? null
        : row.deleted_at instanceof Date
          ? row.deleted_at
          : new Date(String(row.deleted_at)),
  };
}

async function insertAudit(client: PgQueryable, audit: ScholarshipDocumentAudit): Promise<void> {
  await client.query(
    `INSERT INTO audit_log_entries (
       id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
       ip_address, occurred_at, metadata
     ) VALUES ($1,$2,$9,$3,$4,$5,$6,$7,now(),$8::jsonb)`,
    [
      randomUUID(),
      audit.tenantId,
      audit.entityId,
      audit.operation,
      audit.userId,
      audit.userName,
      audit.ipAddress,
      JSON.stringify(audit.metadata),
      audit.entityType ?? 'scholarship_application_document',
    ],
  );
}

export class PgScholarshipDocumentStore implements ScholarshipDocumentStore {
  constructor(private readonly pool: PgPoolLike) {}

  private async ready(): Promise<void> {
    await ensureScholarshipSchema(this.pool);
  }

  async insert(
    row: InsertScholarshipDocument,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument> {
    await this.ready();
    return withPgTenant(this.pool, row.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO scholarship_application_documents (
           id, tenant_id, application_id, document_type, object_key, original_filename,
           mime_type, size_bytes, sha256, uploaded_by, verification_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.applicationId,
          row.documentType,
          row.objectKey,
          row.originalFilename,
          row.mimeType,
          row.sizeBytes,
          row.sha256,
          row.uploadedBy,
        ],
      );
      await insertAudit(client, audit);
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async listActive(
    tenantId: string,
    applicationId: string,
  ): Promise<ScholarshipApplicationDocument[]> {
    await this.ready();
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_application_documents
          WHERE application_id = $1 AND deleted_at IS NULL
          ORDER BY uploaded_at ASC`,
        [applicationId],
      );
      return result.rows.map((row) => mapRow(row as Record<string, unknown>));
    });
  }

  async findById(tenantId: string, id: string): Promise<ScholarshipApplicationDocument | null> {
    await this.ready();
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM scholarship_application_documents
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRow(row) : null;
    });
  }

  async softDelete(
    tenantId: string,
    id: string,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument | null> {
    await this.ready();
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE scholarship_application_documents
            SET deleted_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      await insertAudit(client, audit);
      return mapRow(row);
    });
  }

  async setVerification(
    tenantId: string,
    id: string,
    patch: {
      verificationStatus: 'VERIFIED' | 'REJECTED';
      reviewerId: string;
      rejectionReason: string | null;
    },
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument | null> {
    await this.ready();
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE scholarship_application_documents
            SET verification_status = $2,
                reviewer_id = $3,
                rejection_reason = $4,
                reviewed_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id, patch.verificationStatus, patch.reviewerId, patch.rejectionReason],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      await insertAudit(client, audit);
      return mapRow(row);
    });
  }
  async recordAccess(audit: ScholarshipDocumentAudit): Promise<void> {
    await this.ready();
    await withPgTenant(this.pool, audit.tenantId, async (client) => {
      await insertAudit(client, audit);
    });
  }
}

export function createScholarshipDocumentStore(
  pool: PgPoolLike | null = getSharedScholarshipPool(),
): ScholarshipDocumentStore {
  if (pool && process.env['DATABASE_URL']?.trim()) {
    return new PgScholarshipDocumentStore(pool);
  }
  return new InMemoryScholarshipDocumentStore();
}
