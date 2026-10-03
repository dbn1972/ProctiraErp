/**
 * PRC-L344: gateway scholarship download controls — durable audit row per download and the
 * Redis-backed replay guard selection.
 */
import { RedisDownloadTokenReplayGuard } from '@proctira/backend-scholarship';
import { describe, expect, it } from 'vitest';
import {
  createScholarshipDownloadAuditRecorder,
  createScholarshipDownloadReplayGuard,
  SCHOLARSHIP_DOCUMENT_DOWNLOAD_ENTITY,
  type DownloadAuditService,
} from './scholarship-download-controls.js';

const EVENT = {
  tenantId: 'tenant-a',
  documentId: 'doc-1',
  userId: 'staff-1',
  sessionUserId: null,
  jti: 'jti-1',
  ipAddress: '10.0.0.5',
  userAgent: 'ua',
  requestId: 'req-1',
};

describe('scholarship download controls (PRC-L344)', () => {
  it('writes one audit_log row through the gateway AuditService', async () => {
    const rows: Array<Parameters<DownloadAuditService['recordAudit']>[0]> = [];
    const recorder = createScholarshipDownloadAuditRecorder(() => ({
      recordAudit: async (input) => {
        rows.push(input);
      },
    }));
    await recorder(EVENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 'tenant-a',
      entityType: SCHOLARSHIP_DOCUMENT_DOWNLOAD_ENTITY,
      entityId: 'doc-1',
      userId: 'staff-1',
      ipAddress: '10.0.0.5',
      metadata: { event: 'scholarship.document.downloaded', jti: 'jti-1', requestId: 'req-1' },
    });
  });

  it('throws (so the route refuses with 503) when no audit service or it fails', async () => {
    await expect(createScholarshipDownloadAuditRecorder(() => undefined)(EVENT)).rejects.toThrow(
      /audit service unavailable/,
    );
    const failing = createScholarshipDownloadAuditRecorder(() => ({
      recordAudit: async () => {
        throw new Error('pg down');
      },
    }));
    await expect(failing(EVENT)).rejects.toThrow(/pg down/);
  });

  it('uses Redis when injected and refuses the per-replica guard in production', () => {
    const redis = { set: async () => 'OK' as const };
    expect(createScholarshipDownloadReplayGuard({ redis, NODE_ENV: 'production' })).toBeInstanceOf(
      RedisDownloadTokenReplayGuard,
    );
    expect(() => createScholarshipDownloadReplayGuard({ NODE_ENV: 'production' })).toThrow(
      /REDIS_URL/,
    );
  });
});
