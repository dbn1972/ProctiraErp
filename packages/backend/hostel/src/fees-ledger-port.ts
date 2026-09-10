/**
 * Optional fees ledger for hostel allocation invoices (G-921 / G-903).
 *
 * Implemented by api-gateway via `@proctira/backend-fees` so hostel unit tests
 * stay free of a hard fees package dependency.
 */

export interface HostelAllocationInvoiceInput {
  studentId: string;
  title: string;
  description?: string;
  amountCents: number;
  currency?: string;
  structureId?: string;
}

export interface HostelAllocationInvoiceResult {
  id: string;
  studentId: string;
  title: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface HostelFeesPort {
  postAllocationInvoice(
    tenantId: string,
    actorId: string,
    input: HostelAllocationInvoiceInput,
  ): Promise<HostelAllocationInvoiceResult>;
}

export class InMemoryHostelFeesPort implements HostelFeesPort {
  readonly invoices: HostelAllocationInvoiceResult[] = [];

  async postAllocationInvoice(
    _tenantId: string,
    _actorId: string,
    input: HostelAllocationInvoiceInput,
  ): Promise<HostelAllocationInvoiceResult> {
    const invoice: HostelAllocationInvoiceResult = {
      id: `hostel-inv-${this.invoices.length + 1}`,
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
