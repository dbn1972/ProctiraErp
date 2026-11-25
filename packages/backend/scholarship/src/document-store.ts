/**
 * Metadata for scholarship application files. Bytes live in the blob store.
 */
export type DocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface ScholarshipApplicationDocument {
  id: string;
  tenantId: string;
  applicationId: string;
  documentType: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: Date;
  verificationStatus: DocumentVerificationStatus;
  reviewerId: string | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  deletedAt: Date | null;
  /** PRC-M215 (DR35, db/sql/249 + 313): erase object and row after this date. */
  retentionUntil?: Date | null;
}

/** PRC-M215 (DR35): scholarship supporting documents are kept 8 years, then erased. */
export const SCHOLARSHIP_DOCUMENT_RETENTION_YEARS = 8;

/** Mirrors the db/sql/313 insert default: uploaded date + 8 years (UTC date). */
export function defaultDocumentRetentionUntil(uploadedAt: Date): Date {
  const until = new Date(
    Date.UTC(uploadedAt.getUTCFullYear(), uploadedAt.getUTCMonth(), uploadedAt.getUTCDate()),
  );
  until.setUTCFullYear(until.getUTCFullYear() + SCHOLARSHIP_DOCUMENT_RETENTION_YEARS);
  return until;
}

export interface InsertScholarshipDocument {
  id: string;
  tenantId: string;
  applicationId: string;
  documentType: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
}

export interface ScholarshipDocumentAudit {
  tenantId: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  userId: string;
  userName: string;
  ipAddress: string;
  metadata: Record<string, unknown>;
  /** Defaults to 'scholarship_application_document'. */
  entityType?: string;
}

/** PRC-M353: entity type for read/download access-log rows (one CREATE per access). */
export const SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY = 'scholarship_application_document_access';

export interface ScholarshipDocumentStore {
  insert(
    row: InsertScholarshipDocument,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument>;
  listActive(tenantId: string, applicationId: string): Promise<ScholarshipApplicationDocument[]>;
  findById(tenantId: string, id: string): Promise<ScholarshipApplicationDocument | null>;
  softDelete(
    tenantId: string,
    id: string,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument | null>;
  setVerification(
    tenantId: string,
    id: string,
    patch: {
      verificationStatus: 'VERIFIED' | 'REJECTED';
      reviewerId: string;
      rejectionReason: string | null;
    },
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument | null>;
  /** PRC-M353: durable access-log row for list/download/content/token redemption. */
  recordAccess(audit: ScholarshipDocumentAudit): Promise<void>;
  /**
   * PRC-M215: rows (soft-deleted included) whose retention_until is before
   * `today`, oldest first, at most `limit`.
   */
  listPastRetention(
    tenantId: string,
    today: Date,
    limit: number,
  ): Promise<ScholarshipApplicationDocument[]>;
  /** PRC-M215: hard-delete one row with its audit entry; false when already gone. */
  purge(tenantId: string, id: string, audit: ScholarshipDocumentAudit): Promise<boolean>;
  /** PRC-M215: tenants the document retention sweep visits. */
  listTenantIdsForRetention(): Promise<string[]>;
}

export class InMemoryScholarshipDocumentStore implements ScholarshipDocumentStore {
  readonly rows = new Map<string, ScholarshipApplicationDocument>();
  readonly audits: ScholarshipDocumentAudit[] = [];

  async insert(
    row: InsertScholarshipDocument,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument> {
    const uploadedAt = new Date();
    const entity: ScholarshipApplicationDocument = {
      ...row,
      uploadedAt,
      retentionUntil: defaultDocumentRetentionUntil(uploadedAt),
      verificationStatus: 'PENDING',
      reviewerId: null,
      rejectionReason: null,
      reviewedAt: null,
      deletedAt: null,
    };
    this.rows.set(entity.id, entity);
    this.audits.push(audit);
    return entity;
  }

  async listActive(
    tenantId: string,
    applicationId: string,
  ): Promise<ScholarshipApplicationDocument[]> {
    return [...this.rows.values()].filter(
      (row) =>
        row.tenantId === tenantId && row.applicationId === applicationId && row.deletedAt == null,
    );
  }

  async findById(tenantId: string, id: string): Promise<ScholarshipApplicationDocument | null> {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId || row.deletedAt) return null;
    return row;
  }

  async softDelete(
    tenantId: string,
    id: string,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument | null> {
    const row = await this.findById(tenantId, id);
    if (!row) return null;
    row.deletedAt = new Date();
    this.audits.push(audit);
    return row;
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
    const row = await this.findById(tenantId, id);
    if (!row) return null;
    row.verificationStatus = patch.verificationStatus;
    row.reviewerId = patch.reviewerId;
    row.rejectionReason = patch.rejectionReason;
    row.reviewedAt = new Date();
    this.audits.push(audit);
    return row;
  }
  async recordAccess(audit: ScholarshipDocumentAudit): Promise<void> {
    this.audits.push(audit);
  }

  async listPastRetention(
    tenantId: string,
    today: Date,
    limit: number,
  ): Promise<ScholarshipApplicationDocument[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.retentionUntil != null &&
          row.retentionUntil.getTime() < today.getTime(),
      )
      .sort((a, b) => (a.retentionUntil?.getTime() ?? 0) - (b.retentionUntil?.getTime() ?? 0))
      .slice(0, limit);
  }

  async purge(tenantId: string, id: string, audit: ScholarshipDocumentAudit): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId) return false;
    this.rows.delete(id);
    this.audits.push(audit);
    return true;
  }

  async listTenantIdsForRetention(): Promise<string[]> {
    return [...new Set([...this.rows.values()].map((row) => row.tenantId))].sort();
  }
}
