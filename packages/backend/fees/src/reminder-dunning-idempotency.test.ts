/**
 * PRC-L106: dunning reads the send audit once per run (no N+1) and uses a stable
 * message id per (tenant, invoice, channel, day), so a repeated run is idempotent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENTS = [
  '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000092',
  '00000000-0000-4000-8000-000000000093',
];

describe('PRC-L106 dunning audit reads and idempotent message ids', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;
  let invoiceIds: string[];
  const asOf = new Date('2026-09-12T12:00:00.000Z');

  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
    invoiceIds = [];
    for (const studentId of STUDENTS) {
      const invoice = await service.createInvoice(TENANT, 'staff-1', {
        studentId,
        title: 'Overdue tuition',
        amountCents: 10_000,
        dueAt: '2026-09-01T00:00:00.000Z',
      });
      invoiceIds.push(invoice.id);
    }
  });

  it('reads the send audit once per run, not once per invoice and channel', async () => {
    const reads = vi.spyOn(repository, 'listReminderSendAudits');
    const send = await service.sendReminders(
      TENANT,
      'staff-1',
      { invoiceIds, channels: ['email', 'sms'], cadenceDays: 7 },
      asOf,
    );
    expect(send.results.filter((r) => r.auditId && !r.skippedReason)).toHaveLength(6);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('message ids are stable per invoice/channel/day and a repeated run sends nothing new', async () => {
    const first = await service.sendReminders(
      TENANT,
      'staff-1',
      { invoiceIds: [invoiceIds[0]!], channels: ['email'] },
      asOf,
    );
    expect(first.results[0]!.messageId).toBe(
      `sandbox-email:fees:${TENANT}:${invoiceIds[0]}:2026-09-12`,
    );
    const later = new Date('2026-09-12T18:30:00.000Z');
    const again = await service.sendReminders(
      TENANT,
      'staff-1',
      { invoiceIds: [invoiceIds[0]!, invoiceIds[0]!], channels: ['email'] },
      later,
    );
    expect(again.results.map((r) => r.skippedReason)).toEqual(['already_sent', 'already_sent']);
    expect(again.results[0]!.messageId).toBe(first.results[0]!.messageId);
    expect(again.results[0]!.auditId).toBe(first.results[0]!.auditId);
    expect(await service.listReminderSendAudits(TENANT)).toHaveLength(1);
  });

  it('a new day gets a new message id when no cadence blocks it', async () => {
    await service.sendReminders(
      TENANT,
      'staff-1',
      { invoiceIds: [invoiceIds[1]!], channels: ['sms'] },
      asOf,
    );
    const nextDay = await service.sendReminders(
      TENANT,
      'staff-1',
      { invoiceIds: [invoiceIds[1]!], channels: ['sms'] },
      new Date('2026-09-13T09:00:00.000Z'),
    );
    expect(nextDay.results[0]!.skippedReason).toBeUndefined();
    expect(nextDay.results[0]!.messageId).toBe(
      `sandbox-sms:fees:${TENANT}:${invoiceIds[1]}:2026-09-13`,
    );
    expect(await service.listReminderSendAudits(TENANT)).toHaveLength(2);
  });
});
