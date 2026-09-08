/**
 * G-603 — Port for posting library fines onto the fees ledger.
 *
 * Implemented by api-gateway via `@proctira/backend-fees` FeesService.createInvoice
 * so library stays free of a hard fees package dependency in unit tests.
 */

export interface LibraryFineInvoiceInput {
  studentId: string;
  title: string;
  description?: string;
  amountCents: number;
  currency?: string;
  dueAt?: string;
  /** Loan id that triggered the fine (audit metadata). */
  loanId?: string;
}

export interface LibraryFineInvoiceResult {
  id: string;
  studentId: string;
  title: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface FeesLedgerPort {
  postFineInvoice(
    tenantId: string,
    actorId: string,
    input: LibraryFineInvoiceInput,
  ): Promise<LibraryFineInvoiceResult>;
}

/** In-memory ledger for unit tests when fees plugin is not wired. */
export class InMemoryFeesLedgerPort implements FeesLedgerPort {
  readonly invoices: LibraryFineInvoiceResult[] = [];

  async postFineInvoice(
    _tenantId: string,
    _actorId: string,
    input: LibraryFineInvoiceInput,
  ): Promise<LibraryFineInvoiceResult> {
    const invoice: LibraryFineInvoiceResult = {
      id: `fine-inv-${this.invoices.length + 1}`,
      studentId: input.studentId,
      title: input.title,
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      status: 'open',
    };
    this.invoices.push(invoice);
    return invoice;
  }
}
