/**
 * Library service — catalog, circulation, holds, OPAC, and fines (G-916).
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { FeesLedgerPort } from './fees-ledger-port.js';
import { createIsbnLookup, type IsbnLookup } from './isbn-lookup.js';
import {
  computeFineCents,
  DEFAULT_CAP_CENTS,
  DEFAULT_CENTS_PER_DAY,
  holdReadyExpiresAt,
  overdueDaysSince,
} from './library-ops.js';
import type {
  LibraryCopyEntity,
  LibraryHoldEntity,
  LibraryItemEntity,
  LibraryRepository,
} from './library-repository.js';
import type { AssessFineInput, CheckoutInput, CreateLibraryItemInput } from './schemas.js';

export interface PlaceHoldInput {
  itemId: string;
  patronUserId?: string;
  studentId?: string;
}

export interface LibraryFinesSummary {
  studentId: string;
  openAmountCents: number;
  paidAmountCents: number;
  openCount: number;
  currency: string;
}

export interface LibraryFinesPort {
  summarizeForStudent(tenantId: string, studentId: string): Promise<LibraryFinesSummary>;
}

function copyBarcode(itemId: string, index: number): string {
  return `LIB-${itemId.replace(/-/g, '').slice(0, 8).toUpperCase()}-${String(index).padStart(3, '0')}`;
}

export class LibraryService implements LibraryFinesPort {
  constructor(
    private readonly repository: LibraryRepository,
    private readonly feesLedger?: FeesLedgerPort | null,
    private readonly isbnLookup: IsbnLookup = createIsbnLookup(),
  ) {}

  async lookupIsbn(isbn: string) {
    const result = await this.isbnLookup.lookup(isbn);
    if (!result) {
      throw new NotFoundError(`No catalog metadata for ISBN '${isbn}'`);
    }
    return result;
  }

  async createItem(tenantId: string, input: CreateLibraryItemInput) {
    const copies = input.copies ?? 1;
    const item = await this.repository.createItem({
      id: uuidv4(),
      tenantId,
      isbn: input.isbn ?? null,
      title: input.title,
      author: input.author ?? null,
      copies,
      available: copies,
      barcode: input.barcode ?? null,
      accessionNo: input.accessionNo ?? null,
      publisher: input.publisher ?? null,
      publishedYear: input.publishedYear ?? null,
    });
    await this.ensureCopies(item, copies);
    return item;
  }

  async importFromIsbn(tenantId: string, isbn: string, copies = 1) {
    const meta = await this.lookupIsbn(isbn);
    return this.createItem(tenantId, {
      isbn: meta.isbn,
      title: meta.title,
      author: meta.author ?? undefined,
      copies,
      publisher: meta.publisher ?? undefined,
      publishedYear: meta.publishedYear ?? undefined,
    });
  }

  async listItems(tenantId: string) {
    return this.repository.listItems(tenantId);
  }

  async getItem(tenantId: string, id: string) {
    const item = await this.repository.findItemById(id, tenantId);
    if (!item) {
      throw new NotFoundError(`Library item with id '${id}' not found`);
    }
    return item;
  }

  async searchOpac(tenantId: string, query: string) {
    return this.repository.searchItems(tenantId, query);
  }

  async listCopies(tenantId: string, itemId?: string) {
    return this.repository.listCopies(tenantId, itemId);
  }

  async lookupBarcode(tenantId: string, barcode: string) {
    const copy = await this.repository.findCopyByBarcode(tenantId, barcode);
    if (!copy) {
      throw new NotFoundError(`Copy with barcode '${barcode}' not found`);
    }
    const item = await this.repository.findItemById(copy.itemId, tenantId);
    return { copy, item };
  }

  async checkout(tenantId: string, input: CheckoutInput) {
    if (!input.patronUserId && !input.studentId) {
      throw new BusinessRuleError('Either patronUserId or studentId is required');
    }

    let copy: LibraryCopyEntity | null = null;
    let item: LibraryItemEntity | null = null;

    if (input.barcode) {
      const found = await this.lookupBarcode(tenantId, input.barcode);
      copy = found.copy;
      item = found.item;
    } else if (input.itemId) {
      item = await this.repository.findItemById(input.itemId, tenantId);
      if (!item) {
        throw new NotFoundError(`Library item with id '${input.itemId}' not found`);
      }
      await this.ensureCopies(item, item.copies);
      const copies = await this.repository.listCopies(tenantId, item.id);
      copy = copies.find((c) => c.status === 'available') ?? null;
    } else {
      throw new BusinessRuleError('Either itemId or barcode is required');
    }

    if (!item) {
      throw new NotFoundError('Library item not found');
    }

    if (copy) {
      await this.expireReadyHolds(tenantId, item.id);
      if (copy.status === 'on_loan') {
        throw new BusinessRuleError('Copy is already on loan');
      }
      if (copy.status === 'reserved') {
        const holds = await this.repository.listHolds(tenantId, item.id);
        const ready = holds.find((h) => h.status === 'ready' && h.copyId === copy.id);
        if (ready && !this.holdMatchesPatron(ready, input)) {
          throw new BusinessRuleError('Copy is reserved for another patron');
        }
        if (ready) {
          await this.repository.updateHold(ready.id, tenantId, { status: 'fulfilled' });
        }
      } else if (item.available <= 0) {
        throw new BusinessRuleError('No copies available for checkout');
      }
    } else if (item.available <= 0) {
      throw new BusinessRuleError('No copies available for checkout');
    }

    const dueAt = input.dueAt
      ? new Date(input.dueAt)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const loan = await this.repository.createLoan({
      id: uuidv4(),
      tenantId,
      itemId: item.id,
      copyId: copy?.id ?? null,
      barcode: copy?.barcode ?? input.barcode ?? null,
      patronUserId: input.patronUserId ?? null,
      studentId: input.studentId ?? null,
      checkoutAt: new Date(),
      dueAt,
      returnedAt: null,
      status: 'checked_out',
    });

    if (copy) {
      await this.repository.updateCopy(copy.id, tenantId, { status: 'on_loan' });
    }
    await this.repository.updateItem(item.id, tenantId, {
      available: Math.max(0, item.available - 1),
    });
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
      await this.expireReadyHolds(tenantId, item.id);
      const copyId =
        loan.copyId ??
        (await this.repository.listCopies(tenantId, item.id)).find((c) => c.status === 'on_loan')
          ?.id;
      const held = copyId
        ? await this.promoteHoldOrReleaseCopy(tenantId, item.id, copyId)
        : false;
      if (!held) {
        await this.repository.updateItem(item.id, tenantId, {
          available: Math.min(item.copies, item.available + 1),
        });
      }
    }

    return updated!;
  }

  async returnByBarcode(tenantId: string, barcode: string) {
    const copy = await this.repository.findCopyByBarcode(tenantId, barcode);
    if (!copy) {
      throw new NotFoundError(`Copy with barcode '${barcode}' not found`);
    }
    const loans = await this.repository.listLoans(tenantId);
    const open = loans.find((l) => l.copyId === copy.id && l.status !== 'returned');
    if (!open) {
      throw new NotFoundError(`No open loan for barcode '${barcode}'`);
    }
    return this.returnLoan(tenantId, open.id);
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

  async listLoans(tenantId: string, studentId?: string) {
    const loans = await this.repository.listLoans(tenantId);
    if (!studentId) return loans;
    return loans.filter((loan) => loan.studentId === studentId);
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

  async placeHold(tenantId: string, input: PlaceHoldInput) {
    if (!input.patronUserId && !input.studentId) {
      throw new BusinessRuleError('Either patronUserId or studentId is required');
    }
    const item = await this.repository.findItemById(input.itemId, tenantId);
    if (!item) {
      throw new NotFoundError(`Library item with id '${input.itemId}' not found`);
    }
    await this.expireReadyHolds(tenantId, item.id);
    const fresh = (await this.repository.findItemById(item.id, tenantId)) ?? item;
    if (fresh.available > 0) {
      throw new BusinessRuleError('Copies are available — checkout instead of placing a hold');
    }

    const holds = await this.repository.listHolds(tenantId, item.id);
    const active = holds.filter((h) => h.status === 'queued' || h.status === 'ready');
    const duplicate = active.find((h) => this.holdMatchesPatron(h, input));
    if (duplicate) {
      throw new ConflictError('Patron already has an active hold on this title');
    }
    const queued = active.filter((h) => h.status === 'queued');
    const position = queued.length + 1;

    return this.repository.createHold({
      id: uuidv4(),
      tenantId,
      itemId: item.id,
      copyId: null,
      patronUserId: input.patronUserId ?? null,
      studentId: input.studentId ?? null,
      position,
      status: 'queued',
      expiresAt: null,
    });
  }

  async listHolds(tenantId: string, itemId?: string) {
    if (itemId) {
      await this.expireReadyHolds(tenantId, itemId);
    }
    return this.repository.listHolds(tenantId, itemId);
  }

  async cancelHold(tenantId: string, holdId: string) {
    const hold = await this.repository.findHoldById(holdId, tenantId);
    if (!hold) {
      throw new NotFoundError(`Hold with id '${holdId}' not found`);
    }
    if (hold.status === 'fulfilled' || hold.status === 'cancelled') {
      throw new BusinessRuleError(`Hold is already ${hold.status}`);
    }
    const updated = await this.repository.updateHold(holdId, tenantId, {
      status: 'cancelled',
    });
    if (hold.copyId && hold.status === 'ready') {
      const held = await this.promoteHoldOrReleaseCopy(tenantId, hold.itemId, hold.copyId);
      if (!held) {
        const item = await this.repository.findItemById(hold.itemId, tenantId);
        if (item) {
          await this.repository.updateItem(item.id, tenantId, {
            available: Math.min(item.copies, item.available + 1),
          });
        }
      }
    }
    await this.reindexQueued(tenantId, hold.itemId);
    return updated!;
  }

  async getFinePolicy(tenantId: string) {
    const existing = await this.repository.getFinePolicy(tenantId);
    if (existing) return existing;
    return this.repository.upsertFinePolicy({
      id: uuidv4(),
      tenantId,
      centsPerDay: DEFAULT_CENTS_PER_DAY,
      capCents: DEFAULT_CAP_CENTS,
      currency: 'INR',
    });
  }

  async upsertFinePolicy(
    tenantId: string,
    input: { centsPerDay: number; capCents: number; currency?: string },
  ) {
    const existing = await this.repository.getFinePolicy(tenantId);
    return this.repository.upsertFinePolicy({
      id: existing?.id ?? uuidv4(),
      tenantId,
      centsPerDay: input.centsPerDay,
      capCents: input.capCents,
      currency: input.currency ?? existing?.currency ?? 'INR',
    });
  }

  /**
   * Assess an overdue fine from the tenant policy (per-day rate + cap).
   * Optionally posts to the fees ledger when the G-603 port is wired.
   */
  async assessFine(tenantId: string, actorId: string, input: AssessFineInput) {
    const loan = await this.repository.findLoanById(input.loanId, tenantId);
    if (!loan) {
      throw new NotFoundError(`Loan with id '${input.loanId}' not found`);
    }
    if (!loan.studentId) {
      throw new BusinessRuleError('Fine requires a studentId on the loan');
    }
    const days = overdueDaysSince(loan.dueAt);
    if (days <= 0) {
      throw new BusinessRuleError('Loan is not overdue');
    }

    const existing = await this.repository.findOpenFineForLoan(tenantId, loan.id);
    if (existing) {
      throw new ConflictError('An open fine already exists for this loan');
    }

    const policy = await this.getFinePolicy(tenantId);
    const centsPerDay = input.centsPerDay ?? policy.centsPerDay;
    const capCents = input.capCents ?? policy.capCents;
    const amountCents = input.amountCents ?? computeFineCents(days, centsPerDay, capCents);

    if (amountCents <= 0) {
      throw new BusinessRuleError('Fine amountCents must be positive');
    }

    const item = await this.repository.findItemById(loan.itemId, tenantId);
    const title = input.title ?? `Library fine — ${item?.title ?? loan.itemId}`;
    const description =
      input.description ??
      `Overdue loan ${loan.id} (${days} day(s) past due ${loan.dueAt.toISOString()})`;

    let invoiceId: string | null = null;
    let invoice: Awaited<ReturnType<FeesLedgerPort['postFineInvoice']>> | null = null;
    if (this.feesLedger) {
      invoice = await this.feesLedger.postFineInvoice(tenantId, actorId, {
        studentId: loan.studentId,
        title,
        description,
        amountCents,
        currency: input.currency ?? policy.currency,
        loanId: loan.id,
      });
      invoiceId = invoice.id;
    }

    const fine = await this.repository.createFine({
      id: uuidv4(),
      tenantId,
      loanId: loan.id,
      studentId: loan.studentId,
      amountCents,
      currency: input.currency ?? policy.currency,
      overdueDays: days,
      status: 'open',
      invoiceId,
      paidAt: null,
    });

    return {
      loanId: loan.id,
      studentId: loan.studentId,
      overdueDays: days,
      amountCents,
      invoice,
      fine,
    };
  }

  async listFines(tenantId: string, studentId?: string) {
    return this.repository.listFines(tenantId, studentId);
  }

  async markFinePaid(tenantId: string, fineId: string) {
    const fine = await this.repository.findFineById(fineId, tenantId);
    if (!fine) {
      throw new NotFoundError(`Fine with id '${fineId}' not found`);
    }
    if (fine.status === 'paid') {
      throw new BusinessRuleError('Fine is already paid');
    }
    const updated = await this.repository.updateFine(fineId, tenantId, {
      status: 'paid',
      paidAt: new Date(),
    });
    return updated!;
  }

  async summarizeForStudent(tenantId: string, studentId: string): Promise<LibraryFinesSummary> {
    const fines = await this.repository.listFines(tenantId, studentId);
    const open = fines.filter((f) => f.status === 'open');
    const paid = fines.filter((f) => f.status === 'paid');
    return {
      studentId,
      openAmountCents: open.reduce((sum, f) => sum + f.amountCents, 0),
      paidAmountCents: paid.reduce((sum, f) => sum + f.amountCents, 0),
      openCount: open.length,
      currency: fines[0]?.currency ?? 'INR',
    };
  }

  private holdMatchesPatron(
    hold: LibraryHoldEntity,
    input: { patronUserId?: string; studentId?: string },
  ): boolean {
    if (input.studentId && hold.studentId === input.studentId) return true;
    if (input.patronUserId && hold.patronUserId === input.patronUserId) return true;
    return false;
  }

  private async ensureCopies(item: LibraryItemEntity, count: number): Promise<void> {
    const existing = await this.repository.listCopies(item.tenantId, item.id);
    if (existing.length >= count) return;
    for (let i = existing.length + 1; i <= count; i += 1) {
      const barcode = copyBarcode(item.id, i);
      await this.repository.createCopy({
        id: uuidv4(),
        tenantId: item.tenantId,
        itemId: item.id,
        barcode,
        accessionNo: barcode,
        status: 'available',
      });
    }
  }

  private async expireReadyHolds(tenantId: string, itemId: string): Promise<void> {
    const now = Date.now();
    const holds = await this.repository.listHolds(tenantId, itemId);
    for (const hold of holds) {
      if (
        hold.status === 'ready' &&
        hold.expiresAt &&
        hold.expiresAt.getTime() < now
      ) {
        await this.repository.updateHold(hold.id, tenantId, { status: 'expired' });
        if (hold.copyId) {
          const held = await this.promoteHoldOrReleaseCopy(tenantId, itemId, hold.copyId);
          if (!held) {
            const item = await this.repository.findItemById(itemId, tenantId);
            if (item) {
              await this.repository.updateItem(item.id, tenantId, {
                available: Math.min(item.copies, item.available + 1),
              });
            }
          }
        }
      }
    }
    await this.reindexQueued(tenantId, itemId);
  }

  private async promoteHoldOrReleaseCopy(
    tenantId: string,
    itemId: string,
    copyId: string,
  ): Promise<boolean> {
    const holds = await this.repository.listHolds(tenantId, itemId);
    const next = holds
      .filter((h) => h.status === 'queued')
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) {
      await this.repository.updateCopy(copyId, tenantId, { status: 'available' });
      return false;
    }
    await this.repository.updateHold(next.id, tenantId, {
      status: 'ready',
      copyId,
      expiresAt: holdReadyExpiresAt(),
    });
    await this.repository.updateCopy(copyId, tenantId, { status: 'reserved' });
    await this.reindexQueued(tenantId, itemId);
    return true;
  }

  private async reindexQueued(tenantId: string, itemId: string): Promise<void> {
    const holds = await this.repository.listHolds(tenantId, itemId);
    const queued = holds
      .filter((h) => h.status === 'queued')
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
    let position = 1;
    for (const hold of queued) {
      if (hold.position !== position) {
        await this.repository.updateHold(hold.id, tenantId, { position });
      }
      position += 1;
    }
  }
}
