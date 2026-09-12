/**
 * F2 — dunning / overdue reminder console (sandbox honesty).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService, FEES_REMINDER_SANDBOX_HONESTY_NOTE } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

describe('FeesService dunning / reminders (F2)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;
  const asOf = new Date('2026-09-12T12:00:00.000Z');

  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository, new SandboxPaymentAdapter());
    await service.createInvoice(TENANT_A, 'staff-1', {
      studentId: STUDENT_ID,
      title: 'Overdue tuition',
      amountCents: 50_000,
      dueAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('lists overdue feed with suppressed=false by default', async () => {
    const rows = await service.listOverdueForReminder(TENANT_A, asOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.suppressed).toBe(false);
    expect(rows[0]!.overdueDays).toBeGreaterThanOrEqual(11);
  });

  it('marks and skips suppressed invoices on send', async () => {
    const feed = await service.listOverdueForReminder(TENANT_A, asOf);
    const invoiceId = feed[0]!.invoiceId;

    await service.addReminderSuppression(TENANT_A, 'staff-1', {
      invoiceId,
      reason: 'Payment plan arranged',
    });

    const after = await service.listOverdueForReminder(TENANT_A, asOf);
    expect(after[0]!.suppressed).toBe(true);

    const send = await service.sendReminders(
      TENANT_A,
      'staff-1',
      { invoiceIds: [invoiceId], channels: ['email', 'sms'] },
      asOf,
    );

    expect(send.mode).toBe('sandbox');
    expect(send.honestyNote).toBe(FEES_REMINDER_SANDBOX_HONESTY_NOTE);
    expect(send.results).toHaveLength(2);
    expect(send.results.every((r) => r.suppressed && r.skippedReason === 'suppressed')).toBe(true);
    expect(await service.listReminderSendAudits(TENANT_A)).toHaveLength(0);
  });

  it('records sandbox send audit without claiming live Twilio', async () => {
    const feed = await service.listOverdueForReminder(TENANT_A, asOf);
    const invoiceId = feed[0]!.invoiceId;

    const send = await service.sendReminders(
      TENANT_A,
      'staff-1',
      { invoiceIds: [invoiceId], channels: ['email'] },
      asOf,
    );

    expect(send.results[0]!.messageId).toMatch(/^sandbox-email:/);
    const audits = await service.listReminderSendAudits(TENANT_A);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.mode).toBe('sandbox');
    expect(audits[0]!.honestyNote).toContain('Twilio');
  });

  it('respects cadenceDays and isolates suppressions by tenant', async () => {
    const feed = await service.listOverdueForReminder(TENANT_A, asOf);
    const invoiceId = feed[0]!.invoiceId;

    await service.sendReminders(
      TENANT_A,
      'staff-1',
      { invoiceIds: [invoiceId], channels: ['sms'], cadenceDays: 7 },
      asOf,
    );
    const second = await service.sendReminders(
      TENANT_A,
      'staff-1',
      { invoiceIds: [invoiceId], channels: ['sms'], cadenceDays: 7 },
      asOf,
    );
    expect(second.results[0]!.skippedReason).toBe('within_cadence');

    await service.addReminderSuppression(TENANT_A, 'staff-1', {
      studentId: STUDENT_ID,
      reason: 'Do not contact',
    });
    expect(await service.listReminderSuppressions(TENANT_B)).toHaveLength(0);
    expect(await service.listReminderSuppressions(TENANT_A)).toHaveLength(1);
  });

  it('rejects send without channels', async () => {
    await expect(
      service.sendReminders(TENANT_A, 'staff-1', { invoiceIds: ['x'], channels: [] }, asOf),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
