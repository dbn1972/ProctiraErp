/**
 * PRC-L373 — gateway wiring: the shared TimetableService must receive the shared Postgres pool
 * as `auditPool`, so timetable mutations persist a durable, hash-chained `audit_log_entries`
 * row (not only the per-process in-memory array). Without a pool (no DATABASE_URL) the
 * in-memory-only behaviour is unchanged.
 *
 * DATABASE_URL stays unset so the timetable repository/ops store are in-memory; only
 * `getSharedPgPool` is replaced with a recording fake pool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

delete process.env['DATABASE_URL'];

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
  return {
    ...actual,
    getSharedPgPool: () => (poolAvailable ? fakePool : null),
  };
});

const { sharedTimetableService } = await import('./domain-plugins.js');

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

afterEach(() => {
  recorded.length = 0;
  poolAvailable = true;
});

describe('PRC-L373 timetable durable audit (gateway wiring)', () => {
  it('persists an audit_log_entries row for a timetable mutation when a shared pool exists', async () => {
    const { service } = sharedTimetableService({} as never);
    const row = await service.createBellSchedule(
      TENANT,
      { name: 'Main bell', institutionId: null } as never,
      'admin-user',
    );
    // audit_chain_append(tenant, id, entity_type, entity_id, operation, user_id, …).
    const inserts = recorded.filter((q) => q.sql.includes('FROM audit_chain_append('));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values[0]).toBe(TENANT);
    expect(inserts[0]!.values[2]).toBe('bell_schedule');
    expect(inserts[0]!.values[3]).toBe(row.id);
    expect(inserts[0]!.values[5]).toBe('admin-user');
  });

  it('keeps the in-memory-only behaviour when no shared pool exists', async () => {
    poolAvailable = false;
    const { service } = sharedTimetableService({} as never);
    await service.createBellSchedule(
      TENANT,
      { name: 'Second bell', institutionId: null } as never,
      'admin-user',
    );
    expect(recorded.filter((q) => /audit_log_entries|audit_chain_/.test(q.sql))).toHaveLength(0);
    expect(service.listAudits(TENANT).length).toBeGreaterThan(0);
  });
});
