/**
 * Unit smoke for Pg library repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isPgLibraryEnabled } from './create-library-repository.js';
import { getSharedLibraryPool, PgLibraryRepository } from './pg-library-repository.js';

describe('PgLibraryRepository', () => {
  it.skipIf(!isPgLibraryEnabled())('creates item, checks out, and returns', async () => {
    const pool = getSharedLibraryPool();
    expect(pool).not.toBeNull();
    const repo = new PgLibraryRepository(pool!);
    const tenantId = randomUUID();
    const itemId = randomUUID();
    const loanId = randomUUID();

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
      studentId: randomUUID(),
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
});
