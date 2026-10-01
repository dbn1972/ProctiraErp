/**
 * PRC-L491: batch inserts are atomic (one transaction), bind the tenant GUC when
 * asked, and build raw SQL with bound parameters instead of patching Prisma.Sql.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { batchInsert, batchInsertRaw } from './batch-insert.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Fake client with transactional semantics: writes made through `tx` are staged
 * and only committed when the transaction callback resolves.
 */
function createFakePrisma(failOnCall?: number) {
  const committed: unknown[] = [];
  const executeRawUnsafe = vi.fn().mockResolvedValue(1);
  const sqlCalls: Prisma.Sql[] = [];
  const outsideCreateMany = vi.fn();
  let call = 0;

  const prisma = {
    student: { createMany: outsideCreateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged: unknown[] = [];
      const step = (rows: unknown[]) => {
        call += 1;
        if (call === failOnCall) throw new Error(`batch ${call} failed`);
        staged.push(...rows);
        return rows.length;
      };
      const tx = {
        $executeRawUnsafe: executeRawUnsafe,
        student: {
          createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: step(data) })),
        },
        $executeRaw: vi.fn(async (sql: Prisma.Sql) => {
          sqlCalls.push(sql);
          return step(sql.values);
        }),
      };
      const result = await fn(tx);
      committed.push(...staged);
      return result;
    }),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    raw: prisma,
    committed,
    executeRawUnsafe,
    sqlCalls,
    outsideCreateMany,
  };
}

describe('batchInsert (PRC-L491)', () => {
  it('runs every batch in one transaction and commits all rows', async () => {
    const f = createFakePrisma();
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    await expect(batchInsert(f.prisma, 'student', rows, 2)).resolves.toBe(3);
    expect(f.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(f.outsideCreateMany).not.toHaveBeenCalled();
    expect(f.committed).toHaveLength(3);
  });

  it('failure in batch 2 rolls back batch 1', async () => {
    const f = createFakePrisma(2);
    await expect(
      batchInsert(f.prisma, 'student', [{ a: 1 }, { a: 2 }, { a: 3 }], { batchSize: 2 }),
    ).rejects.toThrow('batch 2 failed');
    expect(f.committed).toHaveLength(0);
  });

  it('binds the tenant GUC when tenantId is provided', async () => {
    const f = createFakePrisma();
    await batchInsert(f.prisma, 'student', [{ a: 1 }], { tenantId: TENANT });
    expect(f.executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), TENANT);
  });

  it('rejects an invalid tenantId before writing', async () => {
    const f = createFakePrisma();
    await expect(
      batchInsert(f.prisma, 'student', [{ a: 1 }], { tenantId: 'nope' }),
    ).rejects.toThrow(/invalid tenantId/);
    expect(f.committed).toHaveLength(0);
  });

  it('rejects an unknown model', async () => {
    const f = createFakePrisma();
    await expect(batchInsert(f.prisma, 'nope', [{ a: 1 }])).rejects.toThrow(/unknown Prisma model/);
  });
});

describe('batchInsertRaw (PRC-L491)', () => {
  it('builds parameterised SQL and keeps values bound', async () => {
    const f = createFakePrisma();
    const n = await batchInsertRaw(
      f.prisma,
      'students',
      ['id', 'name'],
      [
        [1, "x'); DROP TABLE students; --"],
        [2, 'b'],
      ],
    );
    expect(n).toBe(4);
    const sql = f.sqlCalls[0]!;
    expect(sql.sql).toBe('INSERT INTO "students" (id, name) VALUES (?,?),(?,?)');
    expect(sql.values).toEqual([1, "x'); DROP TABLE students; --", 2, 'b']);
  });

  it('failure in batch 2 rolls back batch 1', async () => {
    const f = createFakePrisma(2);
    await expect(
      batchInsertRaw(f.prisma, 't', ['a'], [[1], [2], [3]], 2, { tenantId: TENANT }),
    ).rejects.toThrow('batch 2 failed');
    expect(f.committed).toHaveLength(0);
    expect(f.executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), TENANT);
  });

  it('rejects rows whose width does not match the column list', async () => {
    const f = createFakePrisma();
    await expect(batchInsertRaw(f.prisma, 't', ['a', 'b'], [[1]])).rejects.toThrow(/expected 2/);
  });

  it('rejects unsafe identifiers', async () => {
    const f = createFakePrisma();
    await expect(batchInsertRaw(f.prisma, 't; drop', ['a'], [[1]])).rejects.toThrow(
      /Invalid SQL identifier/,
    );
  });
});
