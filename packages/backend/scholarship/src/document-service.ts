/**
 * Upload, list, download, delete, and verify scholarship supporting documents.
 */
import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { ScholarshipActor } from './document-access.js';
import {
  assertDocumentBytes,
  sanitizeFilename,
  sha256Hex,
  signDocumentDownloadToken,
} from './document-bytes.js';
import type { ScholarshipDocumentBlobStore } from './document-blob-store.js';
import type {
  ScholarshipApplicationDocument,
  ScholarshipDocumentAudit,
  ScholarshipDocumentStore,
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

  async downloadDescriptor(tenantId: string, documentId: string, expiresInSeconds?: number) {
    const row = await this.requireRow(tenantId, documentId);
    const ttl = expiresInSeconds ?? this.deps.signedUrlTtlSeconds ?? 120;
    const signed = signDocumentDownloadToken({
      tenantId,
      documentId: row.id,
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
    const bytes = await this.deps.blobs.get(row.objectKey);
    if (!bytes) {
      throw new NotFoundError('Document file is no longer available');
    }
    return { bytes, mimeType: row.mimeType, originalFilename: row.originalFilename, row };
  }

  async remove(tenantId: string, documentId: string, actor: ScholarshipActor) {
    const row = await this.requireRow(tenantId, documentId);
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
    await this.deps.blobs.delete(row.objectKey).catch(() => undefined);
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
