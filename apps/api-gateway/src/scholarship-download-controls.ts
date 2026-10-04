/**
 * PRC-L344: gateway wiring for scholarship document downloads.
 *
 * - The single-use jti guard is the shared Redis store (REDIS_URL) so a consumed link is refused
 *   on every replica; production without Redis refuses to boot.
 * - Every served download writes a durable audit_log row through the gateway AuditService; when
 *   that write fails the route answers 503 instead of serving the document unaudited.
 */
import {
  createDownloadTokenReplayGuard,
  type DownloadTokenReplayStore,
  type RedisLikeForDownloadReplay,
  type ScholarshipDocumentDownloadAuditRecorder,
} from '@proctira/backend-scholarship';

export interface DownloadAuditService {
  recordAudit(input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    userId: string;
    userName: string;
    ipAddress: string;
    beforeValues?: Record<string, unknown> | null;
    afterValues?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Audit entity type for document access rows (one row per served download). */
export const SCHOLARSHIP_DOCUMENT_DOWNLOAD_ENTITY = 'scholarship_document_download';

export function createScholarshipDownloadAuditRecorder(
  resolveAuditService: () => DownloadAuditService | undefined,
): ScholarshipDocumentDownloadAuditRecorder {
  return async (event) => {
    const auditService = resolveAuditService();
    if (!auditService) throw new Error('audit service unavailable');
    const actor = event.userId ?? event.sessionUserId ?? 'download-link';
    await auditService.recordAudit({
      tenantId: event.tenantId,
      entityType: SCHOLARSHIP_DOCUMENT_DOWNLOAD_ENTITY,
      entityId: event.documentId,
      // The audit store models writes only; a download is recorded as a new access row.
      operation: 'CREATE',
      userId: actor,
      userName: actor,
      ipAddress: event.ipAddress || '0.0.0.0',
      beforeValues: null,
      afterValues: { documentId: event.documentId, jti: event.jti },
      metadata: {
        event: 'scholarship.document.downloaded',
        jti: event.jti,
        linkUserId: event.userId,
        sessionUserId: event.sessionUserId,
        userAgent: event.userAgent,
        requestId: event.requestId,
      },
    });
  };
}

export function createScholarshipDownloadReplayGuard(env: {
  redis?: RedisLikeForDownloadReplay;
  NODE_ENV?: string;
}): DownloadTokenReplayStore {
  return createDownloadTokenReplayGuard(env);
}
