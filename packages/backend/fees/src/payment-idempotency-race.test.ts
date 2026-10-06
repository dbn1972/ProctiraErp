/**
 * PRC-M247: concurrent same-key payments replay one settlement; key is bound to the payer.
 */
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const STUDENT = '00000000-0000-4000-8000-0000000000d1';

async function setup() {
  const repository = new InMemoryFeesRepository();
  const service = new FeesService(repository, new SandboxPaymentAdapter());
  const invoice = await service.createInvoice(TENANT, 'staff-1', {
    studentId: STUDENT,
    title: 'Term',
    amountCents: 10_000,
  });
  return { repository, service, invoice };
}

describe('PRC-M247 payment idempotency race', () => {
  it('5 concurrent recordPayment with the same key -> same payment id, one row', async () => {
    const { repository, service, invoice } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.recordPayment(TENANT, 'parent-1', {
          invoiceId: invoice.id,
          amountCents: 10_000,
          idempotencyKey: 'key-1',
        }),
      ),
    );
    const ids = new Set(results.map((r) => r.payment.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.idempotent)).toHaveLength(1);
    const rows = (await repository.listPaymentsForTenant(TENANT)).filter(
      (p) => p.idempotencyKey === 'key-1',
    );
    expect(rows).toHaveLength(1);
  });

  it('replay by a different actor is rejected', async () => {
    const { service, invoice } = await setup();
    await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: invoice.id,
      amountCents: 4_000,
      idempotencyKey: 'key-2',
    });
    await expect(
      service.recordPayment(TENANT, 'parent-2', {
        invoiceId: invoice.id,
        amountCents: 4_000,
        idempotencyKey: 'key-2',
      }),
    ).rejects.toThrow(/different payer/);
  });

  it('unique violation from a racing insert is turned into a replay', async () => {
    const { repository, service, invoice } = await setup();
    const first = await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: invoice.id,
      amountCents: 4_000,
      idempotencyKey: 'key-3',
    });
    const realFind = repository.findPaymentByIdempotencyKey.bind(repository);
    let calls = 0;
    repository.findPaymentByIdempotencyKey = async (t, k) => {
      calls += 1;
      return calls === 1 ? null : realFind(t, k); // pre-check misses (race window)
    };
    const realRecord = repository.recordPaymentOnInvoice.bind(repository);
    repository.recordPaymentOnInvoice = async () => {
      throw Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'uq_parent_fee_payments_tenant_idempotency',
      });
    };
    const replay = await service.recordPayment(TENANT, 'parent-1', {
      invoiceId: invoice.id,
      amountCents: 4_000,
      idempotencyKey: 'key-3',
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
    repository.recordPaymentOnInvoice = realRecord;
  });
});
