/**
 * PRC-M354: document audit rows go through the hash-chained append on the same
 * transaction (chain_seq / prev_hash / entry_hash populated).
 */
import { currentAuditChainKey } from '@proctira/backend-audit';
import { describe, expect, it, vi } from 'vitest';
import { PgScholarshipDocumentStore } from '../pg-document-store.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';

describe('PgScholarshipDocumentStore audit chain (PRC-M354)', () => {
  it('appends a chained audit entry inside the document transaction', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    let head: { head_seq: number; head_hash: string | null } = {
      head_seq: 4,
      head_hash: 'a'.repeat(64),
    };
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // PRC-M200: the head is locked and advanced only through the SECURITY DEFINER
        // functions (migrations 292/294); the runtime role has no DML on audit_chain_heads.
        if (/\b(INSERT INTO|UPDATE|DELETE FROM)\s+audit_chain_heads\b/.test(sql))
          throw new Error('permission denied for table audit_chain_heads');
        if (sql.includes('FROM audit_chain_lock_head(')) return { rows: [head] };
        if (sql.includes('FROM audit_chain_append(')) {
          // (tenant, id, …, metadata, entry_hash, key_id): row lands at head_seq+1.
          const appended = { chain_seq: head.head_seq + 1, prev_hash: head.head_hash };
          head = { head_seq: appended.chain_seq, head_hash: String(params[12]) };
          return { rows: [appended] };
        }
        if (sql.includes('INSERT INTO scholarship_application_documents'))
          return {
            rows: [
              {
                id: params[0],
                tenant_id: params[1],
                application_id: params[2],
                document_type: params[3],
                object_key: params[4],
                original_filename: params[5],
                mime_type: params[6],
                size_bytes: params[7],
                sha256: params[8],
                uploaded_by: params[9],
                uploaded_at: new Date(),
                verification_status: 'PENDING',
              },
            ],
          };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const store = new PgScholarshipDocumentStore({ connect: async () => client } as never);
    vi.spyOn(store as unknown as { ready: () => Promise<void> }, 'ready').mockResolvedValue();
    await store.insert(
      {
        id: '00000000-0000-4000-8000-0000000000f1',
        tenantId: TENANT,
        applicationId: '00000000-0000-4000-8000-0000000000f2',
        documentType: 'income_certificate',
        objectKey: 'k',
        originalFilename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        sha256: 'b'.repeat(64),
        uploadedBy: 'staff-1',
      },
      {
        tenantId: TENANT,
        entityId: '00000000-0000-4000-8000-0000000000f1',
        operation: 'CREATE',
        userId: 'staff-1',
        userName: 'Staff',
        ipAddress: '127.0.0.1',
        metadata: { action: 'upload' },
      },
    );
    const sqls = calls.map((c) => c.sql);
    const commit = sqls.indexOf('COMMIT');
    const lockHead = calls.findIndex((c) => c.sql.includes('FROM audit_chain_lock_head('));
    const auditInsert = calls.findIndex((c) => c.sql.includes('FROM audit_chain_append('));
    expect(lockHead).toBeGreaterThan(-1);
    expect(auditInsert).toBeGreaterThan(lockHead);
    expect(auditInsert).toBeLessThan(commit);
    expect(calls[lockHead]!.params[0]).toBe(TENANT);
    const params = calls[auditInsert]!.params;
    expect(params[0]).toBe(TENANT);
    expect(params[2]).toBe('scholarship_application_document');
    expect(params[3]).toBe('00000000-0000-4000-8000-0000000000f1');
    expect(String(params[12])).toMatch(/^[0-9a-f]{64}$/); // entry_hash (HMAC)
    expect(params[13]).toBe(currentAuditChainKey().keyId); // key_id
    expect(head).toEqual({ head_seq: 5, head_hash: params[12] });
  });
});
