/**
 * PRC-M089: staff-recorded partial cash payment with a reference; replaying
 * the same idempotency key yields one payment.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000091';

describe('staff record payment (PRC-M089)', () => {
  it('records a partial cash payment for that amount only, with its reference', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    const invoice = await service.createInvoice(TENANT, 'staff', {
      studentId: STUDENT,
      title: 'Tuition',
      amountCents: 100_000,
    } as never);
    const first = await service.recordPayment(TENANT, 'clerk', {
      invoiceId: invoice.id,
      method: 'cash',
      amountCents: 40_000,
      idempotencyKey: 'key-1',
      reference: 'RB-0042',
    });
    expect(first.payment.amountCents).toBe(40_000);
    expect(first.receipt.amountCents).toBe(40_000);
    expect(first.invoice.status).toBe('open');
    const ledger = await repository.listLedgerForInvoice(TENANT, invoice.id);
    expect(ledger.some((e) => e.memo === 'payment received · ref RB-0042')).toBe(true);

    const replay = await service.recordPayment(TENANT, 'clerk', {
      invoiceId: invoice.id,
      method: 'cash',
      amountCents: 40_000,
      idempotencyKey: 'key-1',
      reference: 'RB-0042',
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
  });
});
