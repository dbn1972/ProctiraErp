/**
 * PRC-M527: the gateway domain audit sink writes one hash-chained audit_log_entries row per
 * entry under withPgTenant, and is null without a shared pool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

const recorded: RecordedQuery[] = [];
let poolAvailable = true;

function fakeClient() {
  return {
    query: async (sql: string, values: unknown[] = []) => {
      recorded.push({ sql, values });
      // PRC-M200: the row is appended through the SECURITY DEFINER keyed-chain functions.
      if (sql.includes('FROM audit_chain_lock_head(')) {
        return { rows: [{ head_seq: 0, head_hash: null }] };
      }
      if (sql.includes('FROM audit_chain_append(')) {
        return { rows: [{ chain_seq: 1, prev_hash: null }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
}

const fakePool = { connect: async () => fakeClient(), query: fakeClient().query };

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return { ...actual, getSharedPgPool: () => (poolAvailable ? fakePool : null) };
});

const { domainAuditSink } = await import('./domain-audit-sink.js');

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

afterEach(() => {
  recorded.length = 0;
  poolAvailable = true;
});

describe('domainAuditSink', () => {
  it('is null without a shared pool', () => {
    poolAvailable = false;
    expect(domainAuditSink('lms')).toBeNull();
  });

  it('appends one audit_log_entries row with actor, entity, operation and regulated tag', async () => {
    const sink = domainAuditSink('lms')!;
    await sink({
      tenantId: TENANT,
      action: 'submission.grade',
      entityType: 'lms_submission',
      entityId: 'sub-1',
      actorId: 'teacher-1',
      operation: 'UPDATE',
      before: { score: null },
      after: { score: 8 },
      metadata: { assignmentId: 'a-1' },
    });
    // audit_chain_append(tenant, id, entity_type, entity_id, operation, user_id, user_name, …).
    const inserts = recorded.filter((q) => q.sql.includes('FROM audit_chain_append('));
    expect(inserts).toHaveLength(1);
    const values = inserts[0]!.values;
    expect([values[0], ...values.slice(2, 7)]).toEqual([
      TENANT,
      'lms_submission',
      'sub-1',
      'UPDATE',
      'teacher-1',
      'teacher-1',
    ]);
    expect(JSON.parse(String(values[9]))).toEqual({ score: null });
    expect(JSON.parse(String(values[10]))).toEqual({ score: 8 });
    expect(JSON.parse(String(values[11]))).toEqual({
      assignmentId: 'a-1',
      regulated: 'lms.submission.grade',
      action: 'submission.grade',
    });
    expect(recorded[0]!.sql).toBe('BEGIN');
    expect(recorded.at(-1)!.sql).toBe('COMMIT');
  });
});
