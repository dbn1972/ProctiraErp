/**
 * Fees service — plans, invoices, sandbox payments, receipts.
 * recordPayment enforces receipt.amountCents === payment.amountCents === invoice.amountCents.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  FeeInvoiceEntity,
  FeeLedgerEntryEntity,
  FeePaymentEntity,
  FeePlanEntity,
  FeeReceiptEntity,
  FeesRepository,
  LedgerAccount,
  PaymentMethod,
} from './fees-repository.js';
import { SandboxPaymentAdapter, type PaymentAdapter } from './payment-adapter.js';

export interface CreateFeePlanInput {
  code?: string;
  name: string;
  description?: string;
  amountCents: number;
  currency?: string;
  frequency?: FeePlanEntity['frequency'];
}

export interface CreateInvoiceInput {
  studentId: string;
  planId?: string;
  title?: string;
  description?: string;
  amountCents?: number;
  currency?: string;
  dueAt?: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  payerUserId?: string;
  method?: PaymentMethod;
  amountCents?: number;
}

function receiptNumberFor(paymentId: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCP-${stamp}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export class FeesService {
  private readonly paymentAdapter: PaymentAdapter;

  constructor(
    private readonly repository: FeesRepository,
    paymentAdapter?: PaymentAdapter,
  ) {
    this.paymentAdapter = paymentAdapter ?? new SandboxPaymentAdapter();
  }

  async createFeePlan(tenantId: string, actorId: string, input: CreateFeePlanInput) {
    const code =
      input.code?.trim() ||
      input.name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32) ||
      'PLAN';

    return this.repository.createFeePlan({
      id: uuidv4(),
      tenantId,
      code,
      name: input.name,
      description: input.description ?? '',
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
      frequency: input.frequency ?? 'term',
      status: 'active',
      createdBy: actorId,
    });
  }

  async listFeePlans(tenantId: string) {
    return this.repository.listFeePlans(tenantId);
  }

  async getFeePlan(tenantId: string, planId: string) {
    const plan = await this.repository.findFeePlanById(planId, tenantId);
    if (!plan) {
      throw new NotFoundError(`Fee plan with id '${planId}' not found`);
    }
    return plan;
  }

  async createInvoice(tenantId: string, actorId: string, input: CreateInvoiceInput) {
    let title = input.title;
    let description = input.description ?? '';
    let amountCents = input.amountCents;
    let currency = input.currency ?? 'INR';
    let planId: string | null = input.planId ?? null;

    if (input.planId) {
      const plan = await this.repository.findFeePlanById(input.planId, tenantId);
      if (!plan || plan.status !== 'active') {
        throw new NotFoundError(`Fee plan with id '${input.planId}' not found`);
      }
      planId = plan.id;
      title = input.title ?? plan.name;
      description = input.description ?? plan.description;
      amountCents = input.amountCents ?? plan.amountCents;
      currency = input.currency ?? plan.currency;
    }

    if (title == null || title.trim() === '') {
      throw new BusinessRuleError('Invoice title is required');
    }
    if (amountCents == null || amountCents < 0) {
      throw new BusinessRuleError('Invoice amountCents is required');
    }

    const invoice = await this.repository.createInvoice({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      planId,
      title,
      description,
      amountCents,
      currency,
      status: 'open',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdBy: actorId,
    });

    // G-718: DR accounts_receivable / CR fee_revenue
    if (amountCents > 0) {
      await this.postJournal(invoice, actorId, 'invoice issued', [
        ['accounts_receivable', 'debit'],
        ['fee_revenue', 'credit'],
      ]);
    }
    return invoice;
  }

  /**
   * Post one balanced journal for an invoice-scoped financial event (G-718).
   * Both legs carry the same amount so the journal is balanced by construction;
   * the repository still rejects unbalanced journals defensively.
   */
  private async postJournal(
    invoice: FeeInvoiceEntity,
    actorId: string | null,
    memo: string,
    legs: ReadonlyArray<readonly [LedgerAccount, 'debit' | 'credit']>,
    refs: { paymentId?: string; receiptId?: string } = {},
  ): Promise<FeeLedgerEntryEntity[]> {
    const journalId = uuidv4();
    const postedAt = new Date();
    return this.repository.postLedgerEntries(
      legs.map(([account, side]) => ({
        id: uuidv4(),
        tenantId: invoice.tenantId,
        journalId,
        invoiceId: invoice.id,
        paymentId: refs.paymentId ?? null,
        receiptId: refs.receiptId ?? null,
        account,
        side,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        memo,
        postedBy: actorId,
        postedAt,
      })),
    );
  }

  /** Ledger legs posted for an invoice, oldest first (G-718). */
  async getInvoiceLedger(tenantId: string, invoiceId: string) {
    await this.getInvoice(tenantId, invoiceId);
    return this.repository.listLedgerForInvoice(tenantId, invoiceId);
  }

  /** Tenant trial balance — debits must equal credits (G-718). */
  async getTrialBalance(tenantId: string) {
    return this.repository.trialBalance(tenantId);
  }

  async listInvoices(tenantId: string) {
    return this.repository.listInvoicesForTenant(tenantId);
  }

  async getInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.repository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError(`Invoice with id '${invoiceId}' not found`);
    }
    return invoice;
  }

  async voidInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.getInvoice(tenantId, invoiceId);
    if (invoice.status === 'paid') {
      throw new BusinessRuleError('Cannot void a paid invoice');
    }
    if (invoice.status === 'void') {
      return invoice;
    }
    const updated = await this.repository.updateInvoice(invoiceId, tenantId, { status: 'void' });
    // G-718: reverse the issuance — DR fee_revenue / CR accounts_receivable
    if (invoice.amountCents > 0) {
      await this.postJournal(invoice, null, 'invoice voided', [
        ['fee_revenue', 'debit'],
        ['accounts_receivable', 'credit'],
      ]);
    }
    return updated!;
  }

  async listPayments(tenantId: string) {
    return this.repository.listPaymentsForTenant(tenantId);
  }

  async listReceipts(tenantId: string) {
    return this.repository.listReceiptsForTenant(tenantId);
  }

  async getReceipt(tenantId: string, receiptId: string) {
    const receipt = await this.repository.findReceiptById(receiptId, tenantId);
    if (!receipt) {
      throw new NotFoundError(`Receipt with id '${receiptId}' not found`);
    }
    return receipt;
  }

  /**
   * Charge via payment adapter, persist payment + receipt, mark invoice paid.
   * Enforces: receipt.amountCents === payment.amountCents === invoice.amountCents.
   */
  async recordPayment(
    tenantId: string,
    actorId: string,
    input: RecordPaymentInput,
  ): Promise<{
    invoice: FeeInvoiceEntity;
    payment: FeePaymentEntity;
    receipt: FeeReceiptEntity;
  }> {
    const invoice = await this.getInvoice(tenantId, input.invoiceId);

    if (invoice.status !== 'open') {
      throw new BusinessRuleError('Invoice is not open for payment');
    }

    if (input.amountCents != null && input.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('Payment amountCents must equal invoice.amountCents');
    }

    const charge = await this.paymentAdapter.charge({
      tenantId,
      invoiceId: invoice.id,
      payerUserId: input.payerUserId ?? actorId,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      method: input.method ?? 'sandbox',
    });

    if (charge.status !== 'succeeded') {
      throw new BusinessRuleError(`Payment charge failed with status '${charge.status}'`);
    }

    if (charge.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('Charge amountCents must equal invoice.amountCents');
    }

    const paidAt = new Date();
    const payment = await this.repository.createPayment({
      id: uuidv4(),
      invoiceId: invoice.id,
      tenantId,
      payerUserId: input.payerUserId ?? actorId,
      amountCents: invoice.amountCents,
      method: charge.method,
      status: 'succeeded',
      paidAt,
    });

    if (payment.amountCents !== invoice.amountCents) {
      throw new BusinessRuleError('payment.amountCents must equal invoice.amountCents');
    }

    const receipt = await this.repository.createReceipt({
      id: uuidv4(),
      tenantId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      receiptNumber: receiptNumberFor(payment.id),
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      issuedAt: paidAt,
    });

    if (
      receipt.amountCents !== payment.amountCents ||
      payment.amountCents !== invoice.amountCents ||
      receipt.amountCents !== invoice.amountCents
    ) {
      throw new BusinessRuleError(
        'receipt.amountCents === payment.amountCents === invoice.amountCents invariant violated',
      );
    }

    // G-718: DR cash / CR accounts_receivable — the receivable opened at
    // issuance is cleared by exactly the invoice amount.
    await this.postJournal(
      invoice,
      actorId,
      'payment received',
      [
        ['cash', 'debit'],
        ['accounts_receivable', 'credit'],
      ],
      { paymentId: payment.id, receiptId: receipt.id },
    );

    const updatedInvoice = await this.repository.updateInvoice(invoice.id, tenantId, {
      status: 'paid',
    });

    return { invoice: updatedInvoice!, payment, receipt };
  }
}
