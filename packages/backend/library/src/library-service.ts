/**
 * Library service — catalog and circulation.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { LibraryRepository } from './library-repository.js';
import type { CheckoutInput, CreateLibraryItemInput } from './schemas.js';

export class LibraryService {
  constructor(private readonly repository: LibraryRepository) {}

  async createItem(tenantId: string, input: CreateLibraryItemInput) {
    const copies = input.copies ?? 1;
    return this.repository.createItem({
      id: uuidv4(),
      tenantId,
      isbn: input.isbn ?? null,
      title: input.title,
      author: input.author ?? null,
      copies,
      available: copies,
    });
  }

  async listItems(tenantId: string) {
    return this.repository.listItems(tenantId);
  }

  async checkout(tenantId: string, input: CheckoutInput) {
    if (!input.patronUserId && !input.studentId) {
      throw new BusinessRuleError('Either patronUserId or studentId is required');
    }

    const item = await this.repository.findItemById(input.itemId, tenantId);
    if (!item) {
      throw new NotFoundError(`Library item with id '${input.itemId}' not found`);
    }
    if (item.available <= 0) {
      throw new BusinessRuleError('No copies available for checkout');
    }

    const dueAt = input.dueAt
      ? new Date(input.dueAt)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const loan = await this.repository.createLoan({
      id: uuidv4(),
      tenantId,
      itemId: item.id,
      patronUserId: input.patronUserId ?? null,
      studentId: input.studentId ?? null,
      checkoutAt: new Date(),
      dueAt,
      returnedAt: null,
      status: 'checked_out',
    });

    await this.repository.updateItem(item.id, tenantId, { available: item.available - 1 });
    return loan;
  }

  async returnLoan(tenantId: string, loanId: string) {
    const loan = await this.repository.findLoanById(loanId, tenantId);
    if (!loan) {
      throw new NotFoundError(`Loan with id '${loanId}' not found`);
    }
    if (loan.status === 'returned') {
      throw new BusinessRuleError('Loan is already returned');
    }

    const updated = await this.repository.updateLoan(loanId, tenantId, {
      returnedAt: new Date(),
      status: 'returned',
    });

    const item = await this.repository.findItemById(loan.itemId, tenantId);
    if (item) {
      await this.repository.updateItem(item.id, tenantId, {
        available: Math.min(item.copies, item.available + 1),
      });
    }

    return updated!;
  }

  async listOverdues(tenantId: string) {
    const now = new Date();
    const loans = await this.repository.listLoans(tenantId);
    return loans.filter(
      (loan) => loan.status !== 'returned' && loan.dueAt.getTime() < now.getTime(),
    );
  }
}
