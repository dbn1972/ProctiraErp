/**
 * PRC-L125 — list sorting is pushed to SQL (orderBy/skip/take) and honours sortBy/sortOrder.
 */
import { randomUUID } from 'node:crypto';

import { ValidationError } from '@proctira/common';
import type { PrismaClient } from '@proctira/database';
import { describe, expect, it, vi } from 'vitest';

import { PrismaInstitutionRepository } from './prisma-institution-repository.js';

const TENANT = randomUUID();

interface Row {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  areaId: string;
  type: string;
  sector: string;
  ownership: string;
  status: string;
  customData: null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: null;
}

function row(code: string, status = 'active'): Row {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    name: `School ${code}`,
    code,
    areaId: randomUUID(),
    type: 't',
    sector: 's',
    ownership: 'o',
    status,
    customData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

type Args = {
  where: Record<string, unknown>;
  orderBy?: Array<Record<string, 'asc' | 'desc'>>;
  skip?: number;
  take?: number;
};

/** Minimal fake that honours the where shapes the repository emits. */
function fakePrisma(rows: Row[]) {
  const isInactiveOnly = (where: Record<string, unknown>) => {
    const and = where['AND'] as Array<Record<string, unknown>> | undefined;
    if (!and) return undefined;
    return and[1] && !('NOT' in and[1]);
  };
  const select = (where: Record<string, unknown>) => {
    const mode = isInactiveOnly(where);
    if (mode === undefined) return rows;
    return rows.filter((r) => (r.status.toLowerCase() === 'inactive') === mode);
  };
  const findMany = vi.fn(async (args: Args) => {
    let out = [...select(args.where)];
    const [primary] = args.orderBy ?? [];
    if (primary) {
      const [[field, dir]] = Object.entries(primary) as [[keyof Row, 'asc' | 'desc']];
      out.sort((a, b) => String(a[field]).localeCompare(String(b[field])));
      if (dir === 'desc') out.reverse();
    }
    out = out.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? out.length));
    return out;
  });
  const count = vi.fn(
    async (args: { where: Record<string, unknown> }) => select(args.where).length,
  );
  const tx = { $executeRawUnsafe: vi.fn(), institution: { findMany, count } };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe('PRC-L125 PrismaInstitutionRepository.list sorting', () => {
  it('sortBy=code&sortOrder=desc returns descending codes via SQL orderBy', async () => {
    const { prisma, findMany } = fakePrisma([row('B'), row('C'), row('A')]);
    const repo = new PrismaInstitutionRepository(prisma);
    const res = await repo.list(
      TENANT,
      {},
      { page: 1, pageSize: 20, sortBy: 'code', sortOrder: 'desc' },
    );
    expect(res.data.map((i) => i.code)).toEqual(['C', 'B', 'A']);
    expect(findMany.mock.calls[0]?.[0].orderBy?.[0]).toEqual({ code: 'desc' });
  });

  it('rejects unsupported sort values', async () => {
    const { prisma } = fakePrisma([]);
    const repo = new PrismaInstitutionRepository(prisma);
    await expect(repo.list(TENANT, {}, { sortBy: 'password' })).rejects.toThrow(ValidationError);
    await expect(
      repo.list(TENANT, {}, { sortBy: 'name', sortOrder: 'sideways' as 'asc' }),
    ).rejects.toThrow(ValidationError);
  });

  it('directory order pages active-then-inactive with bounded queries over 5k rows', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 5000; i += 1) {
      rows.push(row(`C${String(i).padStart(5, '0')}`, i % 10 === 0 ? 'INACTIVE' : 'active'));
    }
    const { prisma, findMany } = fakePrisma(rows);
    const repo = new PrismaInstitutionRepository(prisma);

    const first = await repo.list(TENANT, {}, { page: 1, pageSize: 20, sortBy: 'directory' });
    expect(first.meta.totalItems).toBe(5000);
    expect(first.data).toHaveLength(20);
    expect(first.data.every((i) => i.status === 'ACTIVE')).toBe(true);
    expect(first.data[0]?.code).toBe('C00001');

    // Page straddling the active/inactive boundary (4500 active rows): skip 4494.
    const boundary = await repo.list(TENANT, {}, { page: 643, pageSize: 7, sortBy: 'directory' });
    expect(boundary.data.map((i) => i.status)).toEqual([...Array(6).fill('ACTIVE'), 'INACTIVE']);
    expect(boundary.data[6]?.code).toBe('C00000');

    for (const [args] of findMany.mock.calls) {
      expect(args.take).toBeLessThanOrEqual(21);
    }
  });
});
