/**
 * PRC-M249: dues report and reminder feed use the outstanding balance.
 */
import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const STUDENT = '00000000-0000-4000-8000-0000000000d1';

describe('PRC-M249 outstanding dues', () => {
  it('invoice 10000 with 4000 paid -> overdueCents 6000 in dues report and reminder feed', async () => {
    const service = new FeesService(new InMemoryFeesRepository(), new SandboxPaymentAdapter());
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Term',
      amountCents: 10_000,
      dueAt: '2020-01-01T00:00:00.000Z',
    } as never);
    await service.recordPayment(TENANT, 'parent-1', { invoiceId: invoice.id, amountCents: 4_000 });
    const asOf = new Date('2024-01-01T00:00:00Z');

    const dues = await service.duesReport(TENANT, asOf);
    const cls = dues.byClass[0]!;
    expect(cls.overdueCents).toBe(6_000);
    expect(cls.openCents).toBe(6_000);
    expect(dues.overdue[0]?.amountCents).toBe(6_000);

    const feed = await service.listOverdueForReminder(TENANT, asOf);
    expect(feed).toHaveLength(1);
    expect(feed[0]?.amountCents).toBe(6_000);
    expect(feed[0]?.invoiceAmountCents).toBe(10_000);
  });
});
