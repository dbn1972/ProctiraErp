/**
 * Upload, list, download, delete, and verify scholarship supporting documents.
 */
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { ScholarshipActor } from './document-access.js';
import type { ScholarshipDocumentBlobStore } from './document-blob-store.js';
import {
  assertDocumentBytes,
  sanitizeFilename,
  sha256Hex,
  signDocumentDownloadToken,
} from './document-bytes.js';
import {
  SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY,
  type ScholarshipApplicationDocument,
  type ScholarshipDocumentAudit,
  type ScholarshipDocumentStore,
} from './document-store.js';
import type { ScholarshipApplicationEntity } from './scholarship-repository.js';
import type { ScholarshipService } from './scholarship-service.js';

export const DOCUMENT_TYPES = [
  'income_certificate',
  'marksheet',
  'caste_certificate',
  'category_certificate',
  'id_proof',
  'transcript',
  'national_id',
  'recommendation_letter',
  'other',
] as const;

/** Application statuses after which supporting documents may not be removed. */
export const DOCUMENT_LOCKED_STATUSES: readonly ScholarshipApplicationEntity['status'][] = [
  'submitted',
  'under_review',
  'approved',
];
const DOCUMENT_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export type VirusScanHook = (input: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}) => Promise<void>;

export interface ScholarshipDocumentServiceDeps {
  documents: ScholarshipDocumentStore;
  blobs: ScholarshipDocumentBlobStore;
  scholarshipService: ScholarshipService;
  /** Optional scanner. The repo has no ClamAV client; leave unset for a no-op. */
  virusScan?: VirusScanHook;
  signedUrlTtlSeconds?: number;
}

function publicDocument(row: ScholarshipApplicationDocument) {
  return {
    id: row.id,
    applicationId: row.applicationId,
    documentType: row.documentType,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    verificationStatus: row.verificationStatus,
    reviewerId: row.reviewerId,
    rejectionReason: row.rejectionReason,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

export class ScholarshipDocumentService {
  constructor(private readonly deps: ScholarshipDocumentServiceDeps) {}

  async upload(input: {
    tenantId: string;
    application: ScholarshipApplicationEntity;
    actor: ScholarshipActor;
    documentType: string;
    filename: string;
    declaredMime: string | undefined;
    bytes: Buffer;
  }) {
    const documentType = input.documentType.trim().toLowerCase();
    if (!DOCUMENT_TYPE_PATTERN.test(documentType)) {
      throw new ValidationError('Document type is invalid', [
        {
          field: 'documentType',
          rule: 'pattern',
          message: 'Use a short lowercase type such as income_certificate',
        },
      ]);
    }
    const mimeType = assertDocumentBytes(input.bytes, input.declaredMime);
    const originalFilename = sanitizeFilename(input.filename);
    if (this.deps.virusScan) {
      await this.deps.virusScan({
        bytes: input.bytes,
        mimeType,
        fileName: originalFilename,
      });
    }
    const id = uuidv4();
    const objectKey = `scholarships/${input.application.id}/documents/${id}`;
    const storedKey = await this.deps.blobs.put(objectKey, input.bytes, mimeType, input.tenantId);
    const sha256 = sha256Hex(input.bytes);
    try {
      const row = await this.deps.documents.insert(
        {
          id,
          tenantId: input.tenantId,
          applicationId: input.application.id,
          documentType,
          objectKey: storedKey,
          originalFilename,
          mimeType,
          sizeBytes: input.bytes.length,
          sha256,
          uploadedBy: input.actor.userId || 'unknown',
        },
        this.audit(input.actor, input.tenantId, id, 'CREATE', {
          action: 'upload',
          applicationId: input.application.id,
          documentType,
          mimeType,
          sizeBytes: input.bytes.length,
          sha256,
        }),
      );
      return publicDocument(row);
    } catch (error) {
      await this.deps.blobs.delete(storedKey).catch(() => undefined);
      throw error;
    }
  }

  async list(tenantId: string, applicationId: string) {
    const rows = await this.deps.documents.listActive(tenantId, applicationId);
    return rows.map(publicDocument);
  }

  activeTypes(tenantId: string, applicationId: string): Promise<string[]> {
    return this.deps.documents
      .listActive(tenantId, applicationId)
      .then((rows) =>
        rows.filter((row) => row.verificationStatus !== 'REJECTED').map((row) => row.documentType),
      );
  }

  async downloadDescriptor(
    tenantId: string,
    documentId: string,
    options: { expiresInSeconds?: number; userId?: string } = {},
  ) {
    const row = await this.requireRow(tenantId, documentId);
    const ttl = options.expiresInSeconds ?? this.deps.signedUrlTtlSeconds ?? 120;
    const signed = signDocumentDownloadToken({
      tenantId,
      documentId: row.id,
      sub: options.userId ?? '',
      expiresInSeconds: ttl,
    });
    let url = `/api/v1/scholarships/document-downloads?token=${encodeURIComponent(signed.token)}`;
    if (this.deps.blobs.getSignedUrl) {
      const providerUrl = await this.deps.blobs.getSignedUrl(row.objectKey, ttl);
      if (providerUrl) url = providerUrl;
    }
    return {
      url,
      expiresAt: signed.expiresAt,
      mimeType: row.mimeType,
      originalFilename: row.originalFilename,
      token: signed.token,
    };
  }

  async readBytes(tenantId: string, documentId: string) {
    const row = await this.requireRow(tenantId, documentId);
    let bytes: Buffer | null;
    try {
      bytes = await this.deps.blobs.get(row.objectKey);
    } catch (cause) {
      // PRC-M356: storage outage is a 503, not "file no longer available".
      const error = new AppError(
        'Document storage is temporarily unavailable. Try again shortly.',
        'SERVICE_UNAVAILABLE',
        503,
      );
      (error as AppError & { cause?: unknown }).cause = cause;
      throw error;
    }
    if (!bytes) {
      throw new NotFoundError('Document file is no longer available');
    }
    return { bytes, mimeType: row.mimeType, originalFilename: row.originalFilename, row };
  }

  async remove(
    tenantId: string,
    documentId: string,
    actor: ScholarshipActor,
    application: Pick<ScholarshipApplicationEntity, 'id' | 'status'>,
  ) {
    const row = await this.requireRow(tenantId, documentId);
    if (row.applicationId !== application.id) throw new NotFoundError('Document not found');
    // PRC-M356: evidence on a submitted/decided application is retained.
    if (DOCUMENT_LOCKED_STATUSES.includes(application.status)) {
      throw new ConflictError(
        `Documents cannot be removed once the application is ${application.status.replace('_', ' ')}`,
      );
    }
    const deleted = await this.deps.documents.softDelete(
      tenantId,
      documentId,
      this.audit(actor, tenantId, documentId, 'DELETE', {
        action: 'delete',
        applicationId: row.applicationId,
        documentType: row.documentType,
      }),
    );
    if (!deleted) throw new NotFoundError('Document not found');
    // PRC-M356: the blob is retained; the soft-deleted row keeps object_key so a
    // retention job can purge it after the retention window.
    return publicDocument(deleted);
  }

  async verify(tenantId: string, documentId: string, actor: ScholarshipActor) {
    return this.decide(tenantId, documentId, actor, 'VERIFIED', null);
  }

  async reject(tenantId: string, documentId: string, actor: ScholarshipActor, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new ValidationError('A rejection reason is required', [
        { field: 'reason', rule: 'required', message: 'Say why this document is rejected' },
      ]);
    }
    return this.decide(tenantId, documentId, actor, 'REJECTED', trimmed);
  }

  private async decide(
    tenantId: string,
    documentId: string,
    actor: ScholarshipActor,
    status: 'VERIFIED' | 'REJECTED',
    reason: string | null,
  ) {
    const row = await this.requireRow(tenantId, documentId);
    if (row.verificationStatus !== 'PENDING') {
      throw new BusinessRuleError(
        `Document is already ${row.verificationStatus}. Only pending documents can be reviewed.`,
      );
    }
    const updated = await this.deps.documents.setVerification(
      tenantId,
      documentId,
      {
        verificationStatus: status,
        reviewerId: actor.userId || 'unknown',
        rejectionReason: reason,
      },
      this.audit(actor, tenantId, documentId, 'UPDATE', {
        action: status === 'VERIFIED' ? 'verify' : 'reject',
        applicationId: row.applicationId,
        documentType: row.documentType,
        verificationStatus: status,
        rejectionReason: reason,
      }),
    );
    if (!updated) throw new NotFoundError('Document not found');
    return publicDocument(updated);
  }

  /**
   * PRC-M353: record who viewed/downloaded applicant documents (minors'
   * financial/identity data). Fails closed: if the access log cannot be
   * written the caller must not serve the data.
   */
  async recordAccess(input: {
    tenantId: string;
    actor: Pick<ScholarshipActor, 'userId' | 'userName' | 'ipAddress'>;
    action: 'list' | 'download_link' | 'content' | 'token_download';
    applicationId: string | null;
    documentId: string | null;
    purpose?: string;
  }): Promise<void> {
    await this.deps.documents.recordAccess({
      tenantId: input.tenantId,
      entityId: input.documentId ?? input.applicationId ?? 'unknown',
      entityType: SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY,
      operation: 'CREATE',
      userId: input.actor.userId || 'unknown',
      userName: input.actor.userName,
      ipAddress: input.actor.ipAddress,
      metadata: {
        action: input.action,
        applicationId: input.applicationId,
        documentId: input.documentId,
        purpose: input.purpose ?? 'scholarship_review',
      },
    });
  }

  private async requireRow(tenantId: string, documentId: string) {
    const row = await this.deps.documents.findById(tenantId, documentId);
    if (!row) throw new NotFoundError('Document not found');
    return row;
  }

  private audit(
    actor: ScholarshipActor,
    tenantId: string,
    entityId: string,
    operation: ScholarshipDocumentAudit['operation'],
    metadata: Record<string, unknown>,
  ): ScholarshipDocumentAudit {
    return {
      tenantId,
      entityId,
      operation,
      userId: actor.userId || 'unknown',
      userName: actor.userName,
      ipAddress: actor.ipAddress,
      metadata,
    };
  }
}
