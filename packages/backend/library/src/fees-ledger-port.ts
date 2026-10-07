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

/** Result of settling (paying) a previously-posted fine invoice. */
export interface LibraryFineSettlementResult {
  invoiceId: string;
  status: string;
  /** True when the invoice was already settled (idempotent replay). */
  alreadySettled: boolean;
}

export interface FeesLedgerPort {
  postFineInvoice(
    tenantId: string,
    actorId: string,
    input: LibraryFineInvoiceInput,
  ): Promise<LibraryFineInvoiceResult>;

  /**
   * PRC-H025 — settle the fee-ledger invoice raised for a library fine when the
   * fine is marked paid, so the student's fee ledger no longer shows the dues.
   * Optional so unit tests / legacy wirings that only post invoices still work;
   * when absent, markFinePaid can only flip the local library fine.
   */
  settleFineInvoice?(
    tenantId: string,
    actorId: string,
    input: { invoiceId: string; amountCents: number; reference?: string },
  ): Promise<LibraryFineSettlementResult>;
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

  async settleFineInvoice(
    _tenantId: string,
    _actorId: string,
    input: { invoiceId: string; amountCents: number; reference?: string },
  ): Promise<LibraryFineSettlementResult> {
    const invoice = this.invoices.find((inv) => inv.id === input.invoiceId);
    if (!invoice) {
      throw new Error(`Fine invoice '${input.invoiceId}' not found`);
    }
    const alreadySettled = invoice.status === 'paid';
    invoice.status = 'paid';
    return { invoiceId: invoice.id, status: invoice.status, alreadySettled };
  }
}
