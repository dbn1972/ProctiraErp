/**
 * PRC-M354: document audit rows go through the hash-chained append on the same
 * transaction (chain_seq / prev_hash / entry_hash populated).
 */
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
        if (sql.includes('FROM audit_chain_heads')) return { rows: [head] };
        if (sql.startsWith('UPDATE audit_chain_heads'))
          head = { head_seq: Number(params[1]), head_hash: String(params[2]) };
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
        if (sql.includes('INSERT INTO audit_log_entries'))
          return {
            rows: [
              {
                id: params[0],
                tenant_id: params[1],
                occurred_at: new Date(),
                chain_seq: params[12],
                prev_hash: params[13],
                entry_hash: params[14],
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
    const auditInsert = calls.findIndex((c) => c.sql.includes('INSERT INTO audit_log_entries'));
    expect(auditInsert).toBeGreaterThan(-1);
    expect(auditInsert).toBeLessThan(commit);
    expect(sqls.some((s) => /FROM audit_chain_heads .*FOR UPDATE/.test(s))).toBe(true);
    const params = calls[auditInsert]!.params;
    expect(params[12]).toBe(5); // chain_seq
    expect(params[13]).toBe('a'.repeat(64)); // prev_hash
    expect(String(params[14])).toMatch(/^[0-9a-f]{64}$/); // entry_hash
    expect(head).toEqual({ head_seq: 5, head_hash: params[14] });
  });
});
