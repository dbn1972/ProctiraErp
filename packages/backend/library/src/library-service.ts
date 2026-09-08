/**
 * Library service — catalog, circulation, and fines → fees ledger (G-603).
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { FeesLedgerPort } from './fees-ledger-port.js';
import type { LibraryRepository } from './library-repository.js';
import type { AssessFineInput, CheckoutInput, CreateLibraryItemInput } from './schemas.js';

const DEFAULT_FINE_CENTS_PER_DAY = 500; // ₹5.00 / day

export class LibraryService {
  constructor(
    private readonly repository: LibraryRepository,
    private readonly feesLedger?: FeesLedgerPort | null,
  ) {}

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

  /**
   * Extend due date for an open loan (default +14 days from current dueAt or now).
   */
  async renewLoan(tenantId: string, loanId: string, extendDays = 14) {
    const loan = await this.repository.findLoanById(loanId, tenantId);
    if (!loan) {
      throw new NotFoundError(`Loan with id '${loanId}' not found`);
    }
    if (loan.status === 'returned') {
      throw new BusinessRuleError('Cannot renew a returned loan');
    }

    const base = loan.dueAt.getTime() > Date.now() ? loan.dueAt : new Date();
    const dueAt = new Date(base.getTime() + extendDays * 24 * 60 * 60 * 1000);

    const updated = await this.repository.updateLoan(loanId, tenantId, {
      dueAt,
      status: 'checked_out',
    });
    return updated!;
  }

  async listOverdues(tenantId: string) {
    const now = new Date();
    const loans = await this.repository.listLoans(tenantId);
    return loans.filter(
      (loan) => loan.status !== 'returned' && loan.dueAt.getTime() < now.getTime(),
    );
  }

  /**
   * Student-transfer checklist hook: clear when no open loans remain.
   */
  async getStudentClearance(tenantId: string, studentId: string) {
    const loans = await this.repository.listLoans(tenantId);
    const openLoans = loans.filter(
      (loan) => loan.studentId === studentId && loan.status !== 'returned',
    );
    const overdueCount = openLoans.filter((loan) => loan.dueAt.getTime() < Date.now()).length;

    return {
      studentId,
      clear: openLoans.length === 0,
      openLoanCount: openLoans.length,
      overdueCount,
      openLoans,
      checkedAt: new Date(),
    };
  }

  /**
   * Assess an overdue fine and post it to the fees ledger (G-603).
   * Requires feesLedger port (wired by gateway) and a studentId on the loan.
   */
  async assessFine(tenantId: string, actorId: string, input: AssessFineInput) {
    if (!this.feesLedger) {
      throw new BusinessRuleError('Fees ledger is not configured; cannot post library fines');
    }

    const loan = await this.repository.findLoanById(input.loanId, tenantId);
    if (!loan) {
      throw new NotFoundError(`Loan with id '${input.loanId}' not found`);
    }
    if (!loan.studentId) {
      throw new BusinessRuleError('Fine requires a studentId on the loan');
    }

    const now = Date.now();
    const overdueMs = Math.max(0, now - loan.dueAt.getTime());
    const overdueDays = Math.max(1, Math.ceil(overdueMs / (24 * 60 * 60 * 1000)));
    const amountCents =
      input.amountCents ?? overdueDays * (input.centsPerDay ?? DEFAULT_FINE_CENTS_PER_DAY);

    if (amountCents <= 0) {
      throw new BusinessRuleError('Fine amountCents must be positive');
    }

    const item = await this.repository.findItemById(loan.itemId, tenantId);
    const title = input.title ?? `Library fine — ${item?.title ?? loan.itemId}`;
    const description =
      input.description ??
      `Overdue loan ${loan.id} (${overdueDays} day(s) past due ${loan.dueAt.toISOString()})`;

    const invoice = await this.feesLedger.postFineInvoice(tenantId, actorId, {
      studentId: loan.studentId,
      title,
      description,
      amountCents,
      currency: input.currency ?? 'INR',
      loanId: loan.id,
    });

    return {
      loanId: loan.id,
      studentId: loan.studentId,
      overdueDays,
      amountCents,
      invoice,
    };
  }
}
