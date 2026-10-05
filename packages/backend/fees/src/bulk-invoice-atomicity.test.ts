/**
 * PRC-M250: bulk invoicing is set-based and surfaces roster errors. Atomicity is
 * whole-batch (PRC-M086): a failure part-way persists nothing.
 */
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { PgFeesRepository, type PgPoolLike } from './pg-fees-repository.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const CLASS_ID = '00000000-0000-4000-8000-0000000000e1';
const S = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

describe('PRC-M250 bulk invoicing', () => {
  it('failure on student k rolls back the whole batch; a re-run is not blocked and then skips', async () => {
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
    // PRC-M086: whole-batch transaction — nothing (invoice or journal) persists.
    expect(await repository.listInvoicesForTenant(TENANT)).toHaveLength(0);
    // re-run after the fault creates everyone; a further run skips them all
    // (set-based existing-invoice check).
    repository.postLedgerEntries = realPost;
    const rerun = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(rerun.skipped).toEqual([]);
    expect(rerun.created).toHaveLength(3);
    const third = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(third.created).toHaveLength(0);
    expect([...third.skipped].sort()).toEqual([S(1), S(2), S(3)]);
    for (const inv of await repository.listInvoicesForTenant(TENANT)) {
      expect((await repository.listLedgerForInvoice(TENANT, inv.id)).length).toBeGreaterThan(0);
    }
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
