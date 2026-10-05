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
}

export class InMemoryScholarshipDocumentStore implements ScholarshipDocumentStore {
  readonly rows = new Map<string, ScholarshipApplicationDocument>();
  readonly audits: ScholarshipDocumentAudit[] = [];

  async insert(
    row: InsertScholarshipDocument,
    audit: ScholarshipDocumentAudit,
  ): Promise<ScholarshipApplicationDocument> {
    const entity: ScholarshipApplicationDocument = {
      ...row,
      uploadedAt: new Date(),
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
}
