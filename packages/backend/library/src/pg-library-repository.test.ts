/**
 * Unit smoke for Pg library repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { isPgLibraryEnabled } from './create-library-repository.js';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import type { LibraryRepository } from './library-repository.js';
import { getSharedLibraryPool, PgLibraryRepository } from './pg-library-repository.js';

describe('PgLibraryRepository', () => {
  it.skipIf(!isPgLibraryEnabled())('creates item, checks out, and returns', async () => {
    const pool = getSharedLibraryPool();
    expect(pool).not.toBeNull();
    const repo = new PgLibraryRepository(pool!);
    const tenantId = randomUUID();
    const itemId = randomUUID();
    const loanId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, studentId);

    await repo.createItem({
      id: itemId,
      tenantId,
      isbn: '978-0-00-000000-0',
      title: 'Pg Unit Book',
      author: 'Tester',
      copies: 2,
      available: 2,
      barcode: null,
      accessionNo: null,
      publisher: null,
      publishedYear: null,
    });

    await repo.updateItem(itemId, tenantId, { available: 1 });
    await repo.createLoan({
      id: loanId,
      tenantId,
      itemId,
      copyId: null,
      barcode: null,
      patronUserId: null,
      studentId,
      checkoutAt: new Date(),
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      returnedAt: null,
      status: 'checked_out',
    });

    const returned = await repo.updateLoan(loanId, tenantId, {
      returnedAt: new Date(),
      status: 'returned',
    });
    expect(returned?.status).toBe('returned');

    const items = await repo.listItems(tenantId);
    expect(items.some((i) => i.id === itemId && i.available === 1)).toBe(true);
  });

  // PRC-M294: paged lists filter in SQL and match the in-memory repository.
  it.skipIf(!isPgLibraryEnabled())(
    'pages items/loans/holds/fines in SQL, matching the in-memory repository',
    async () => {
      const pool = getSharedLibraryPool();
      expect(pool).not.toBeNull();
      const pgRepo = new PgLibraryRepository(pool!);
      const memRepo = new InMemoryLibraryRepository();
      const tenantId = randomUUID();
      const otherTenant = randomUUID();
      const studentA = randomUUID();
      const studentB = randomUUID();
      const patron = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentA);
      await ensurePgTestStudent(pool!, tenantId, studentB);

      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const itemIds = [randomUUID(), randomUUID(), randomUUID()];
      const loanIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const fineId = randomUUID();
      const holdId = randomUUID();
      for (const repo of [pgRepo, memRepo] as LibraryRepository[]) {
        for (const [i, title] of ['Gamma', 'Alpha', 'Beta'].entries()) {
          await repo.createItem({
            id: itemIds[i]!,
            tenantId,
            isbn: null,
            title,
            author: null,
            copies: 1,
            available: 0,
            barcode: null,
            accessionNo: null,
            publisher: null,
            publishedYear: null,
          });
        }
        const specs = [
          { student: studentA, due: now - 3 * day, returned: false },
          { student: studentA, due: now - 2 * day, returned: true },
          { student: studentB, due: now - 1 * day, returned: false },
          { student: studentB, due: now + 5 * day, returned: false },
        ];
        for (const [i, spec] of specs.entries()) {
          await repo.createLoan({
            id: loanIds[i]!,
            tenantId,
            itemId: itemIds[i % 3]!,
            copyId: null,
            barcode: null,
            patronUserId: i === 0 ? patron : null,
            studentId: spec.student,
            checkoutAt: new Date(now - (10 - i) * day),
            dueAt: new Date(spec.due),
            returnedAt: spec.returned ? new Date(now) : null,
            status: spec.returned ? 'returned' : 'checked_out',
          });
        }
        await repo.createFine({
          id: fineId,
          tenantId,
          loanId: loanIds[0]!,
          studentId: studentA,
          amountCents: 100,
          currency: 'INR',
          overdueDays: 3,
          status: 'open',
          invoiceId: null,
          paidAt: null,
        });
        await repo.createHold({
          id: holdId,
          tenantId,
          itemId: itemIds[0]!,
          copyId: null,
          patronUserId: null,
          studentId: studentB,
          position: 1,
          status: 'queued',
          expiresAt: null,
        });
      }

      const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
      const page = { page: 1, pageSize: 2 };
      const overdueAt = new Date(now);
      for (const repo of [pgRepo, memRepo] as LibraryRepository[]) {
        const items = await repo.listItemsPage(tenantId, page);
        expect(items.data.map((i) => i.title)).toEqual(['Alpha', 'Beta']);
        expect(items.meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
      }
      const pgOverdue = await pgRepo.listLoansPage(
        tenantId,
        { overdueAt },
        { page: 1, pageSize: 10 },
      );
      const memOverdue = await memRepo.listLoansPage(
        tenantId,
        { overdueAt },
        { page: 1, pageSize: 10 },
      );
      expect(ids(pgOverdue.data)).toEqual(ids(memOverdue.data));
      expect(ids(pgOverdue.data).sort()).toEqual([loanIds[0]!, loanIds[2]!].sort());

      const pgLoans = await pgRepo.listLoansPage(tenantId, {}, page);
      const memLoans = await memRepo.listLoansPage(tenantId, {}, page);
      expect(ids(pgLoans.data)).toEqual(ids(memLoans.data));
      expect(pgLoans.meta).toEqual({ page: 1, pageSize: 2, totalItems: 4, totalPages: 2 });
      expect(
        ids((await pgRepo.listLoansPage(tenantId, { patronUserId: patron }, page)).data),
      ).toEqual([loanIds[0]!]);
      expect(ids(await pgRepo.listLoans(tenantId, { studentId: studentB })).sort()).toEqual(
        [loanIds[2]!, loanIds[3]!].sort(),
      );
      expect(await pgRepo.findOpenLoanByCopyId(tenantId, randomUUID())).toBeNull();

      expect(
        ids((await pgRepo.listFinesPage(tenantId, { studentId: studentA }, page)).data),
      ).toEqual([fineId]);
      expect(
        (await pgRepo.listFinesPage(tenantId, { studentId: studentB }, page)).meta.totalItems,
      ).toBe(0);
      expect(
        ids(
          (await pgRepo.listHoldsPage(tenantId, { itemId: itemIds[0]!, studentId: studentB }, page))
            .data,
        ),
      ).toEqual([holdId]);
      expect(
        (await pgRepo.listHoldsPage(tenantId, { studentId: studentA }, page)).meta.totalItems,
      ).toBe(0);

      // Tenant isolation (RLS + tenant_id predicate).
      expect((await pgRepo.listItemsPage(otherTenant, page)).meta.totalItems).toBe(0);
      expect((await pgRepo.listLoansPage(otherTenant, {}, page)).meta.totalItems).toBe(0);
    },
  );
});
