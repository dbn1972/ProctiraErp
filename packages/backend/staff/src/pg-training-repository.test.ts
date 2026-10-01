/**
 * PRC-L156: PG attendance insert must not upsert; unique violation -> ConflictError.
 */
import { ConflictError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./pg-hr-schema.js', async (orig) => ({
  ...(await orig<typeof import('./pg-hr-schema.js')>()),
  ensureHrSchema: vi.fn(async () => undefined),
}));

const { PgTrainingAttendanceRepository } = await import('./pg-training-repository.js');

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const row = {
  id: '880e8400-e29b-41d4-a716-446655440003',
  tenantId: TENANT,
  sessionId: '990e8400-e29b-41d4-a716-446655440004',
  staffId: '770e8400-e29b-41d4-a716-446655440002',
  status: 'PRESENT' as const,
  comment: null,
};

function fakePool(onInsert: (sql: string) => unknown) {
  const sqls: string[] = [];
  return {
    sqls,
    pool: {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        if (/INSERT INTO hr_training_attendance/.test(sql)) return onInsert(sql);
        return { rows: [] };
      }),
    },
  };
}

describe('PgTrainingAttendanceRepository.create (PRC-L156)', () => {
  it('issues a plain INSERT without ON CONFLICT DO UPDATE', async () => {
    const { pool, sqls } = fakePool(() => ({
      rows: [
        {
          id: row.id,
          tenant_id: TENANT,
          session_id: row.sessionId,
          staff_id: row.staffId,
          status: 'PRESENT',
          comment: null,
          created_at: new Date(),
        },
      ],
    }));
    const repo = new PgTrainingAttendanceRepository(pool as never);
    const created = await repo.create(row);
    expect(created.staffId).toBe(row.staffId);
    const insert = sqls.find((s) => s.includes('INSERT INTO hr_training_attendance'))!;
    expect(insert).not.toMatch(/ON CONFLICT/i);
  });

  it('maps unique violation 23505 to ConflictError', async () => {
    const { pool } = fakePool(() => {
      throw Object.assign(new Error('duplicate key value'), { code: '23505' });
    });
    const repo = new PgTrainingAttendanceRepository(pool as never);
    await expect(repo.create(row)).rejects.toBeInstanceOf(ConflictError);
  });
});
