/**
 * PRC-M250: bulk invoicing is per-student atomic, set-based, and surfaces roster errors.
 */
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { PgFeesRepository, type PgPoolLike } from './pg-fees-repository.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const CLASS_ID = '00000000-0000-4000-8000-0000000000e1';
const S = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

describe('PRC-M250 bulk invoicing', () => {
  it('failure on student k rolls back that student invoice + journal; earlier students stay', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    repository.seedClassRoster(TENANT, { classId: CLASS_ID }, [S(1), S(2), S(3)]);
    const structure = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 1_000,
      classId: CLASS_ID,
    } as never);
    const realPost = repository.postLedgerEntries.bind(repository);
    let posts = 0;
    repository.postLedgerEntries = (async (...args: Parameters<typeof realPost>) => {
      posts += 1;
      if (posts === 2) throw new Error('injected journal failure');
      return realPost(...args);
    }) as typeof realPost;
    await expect(
      service.bulkInvoiceClass(TENANT, 'staff', { structureId: structure.id, classId: CLASS_ID }),
    ).rejects.toThrow('injected journal failure');
    const invoices = await repository.listInvoicesForTenant(TENANT);
    expect(invoices.map((i) => i.studentId)).toEqual([S(1)]);
    const ledger = await repository.listLedgerForInvoice(TENANT, invoices[0]!.id);
    expect(ledger.length).toBeGreaterThan(0);

    // re-run after the fault: student 1 skipped, others created (set-based existing check)
    repository.postLedgerEntries = realPost;
    const rerun = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(rerun.skipped).toEqual([S(1)]);
    expect(rerun.created).toHaveLength(2);
  });

  it('roster SQL error surfaces (no silent empty class)', async () => {
    const pool: PgPoolLike = {
      query: async (text: string) => {
        if (/FROM enrollments/i.test(text)) {
          throw Object.assign(new Error('column "grade_id" does not exist'), { code: '42703' });
        }
        return { rows: [] };
      },
      connect: async () => ({
        query: async (text: string) => {
          if (/FROM enrollments/i.test(text)) {
            throw Object.assign(new Error('column "grade_id" does not exist'), { code: '42703' });
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
    } as unknown as PgPoolLike;
    const repo = new PgFeesRepository(pool, { ensureSchema: false });
    await expect(repo.listStudentIdsForScope(TENANT, { classId: CLASS_ID })).rejects.toThrow(
      /grade_id/,
    );
  });
});
