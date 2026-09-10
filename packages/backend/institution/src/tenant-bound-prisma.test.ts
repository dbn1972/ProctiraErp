import type { PrismaClient } from '@proctira/database';
import { describe, expect, it, vi } from 'vitest';

import { createTenantBoundPrisma } from './tenant-bound-prisma.js';
import { tenantContext } from './tenant-context.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function fakePrisma() {
  const executed: string[] = [];
  const txCreate = vi.fn(async (args: unknown) => ({ id: 'p1', args }));
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executed.push(`${strings.join('?')}|${values.join(',')}`);
      return 1;
    }),
    academicPeriod: { create: txCreate },
  };
  const rootCreate = vi.fn();
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $connect: vi.fn(),
    academicPeriod: { create: rootCreate, fields: { id: 'id' } },
  };
  return { prisma: prisma as unknown as PrismaClient, tx, txCreate, rootCreate, executed };
}

describe('createTenantBoundPrisma', () => {
  it('runs model operations inside withTenantTransaction bound to the request tenant', async () => {
    const f = fakePrisma();
    const bound = createTenantBoundPrisma(f.prisma);

    const result = await tenantContext.run({ tenantId: TENANT }, () =>
      bound.academicPeriod.create({ data: { name: 'AY' } } as never),
    );

    expect(result).toMatchObject({ id: 'p1' });
    expect(f.rootCreate).not.toHaveBeenCalled();
    expect(f.txCreate).toHaveBeenCalledTimes(1);
    expect(f.executed.some((s) => s.includes('app.tenant_id') && s.includes(TENANT))).toBe(true);
    expect(f.executed.some((s) => s.includes('app.current_tenant_id') && s.includes(TENANT))).toBe(
      true,
    );
  });

  it('rejects model operations outside a tenant context', async () => {
    const f = fakePrisma();
    const bound = createTenantBoundPrisma(f.prisma);
    await expect(
      Promise.resolve().then(() => bound.academicPeriod.create({ data: {} } as never)),
    ).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('passes $-prefixed members and non-operation fields through', () => {
    const f = fakePrisma();
    const bound = createTenantBoundPrisma(f.prisma);
    expect(bound.$connect).toBe(f.prisma.$connect);
    expect((bound.academicPeriod as unknown as { fields: unknown }).fields).toEqual({ id: 'id' });
  });
});
