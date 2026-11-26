/**
 * PRC-L291 — live Postgres proof that a fee reminder sent through a messaging
 * provider can be audited as live (db/sql/328), and only with provider
 * evidence.
 *
 * Before 328 fee_reminder_send_audits had CHECK (mode = 'sandbox'): a real
 * send could never be recorded. After 328 a live row must name the provider
 * that matches its channel (sms -> msg91, email -> ses, DR50) and the
 * provider's message id; a sandbox row cannot carry a provider. FeesService
 * records live rows when a ReminderDeliveryPort is configured (here a stub;
 * no real MSG91/SES adapter exists yet) and stays sandbox otherwise.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 328.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';
import type { ReminderDeliveryPort } from './reminder-sandbox.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'reminder-live-mode.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;
const rawPool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

afterAll(async () => {
  await rawPool?.end();
});

async function overdueInvoice(service: FeesService) {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  const invoice = await service.createInvoice(tenantId, 'staff-1', {
    studentId,
    title: 'Overdue tuition',
    amountCents: 50_000,
    dueAt: '2026-01-01T00:00:00.000Z',
  });
  return { tenantId, studentId, invoice };
}

describe('PRC-L291 live fee reminder audit (live)', () => {
  it.skipIf(!live)('records a provider-confirmed send as live', async () => {
    const sent: string[] = [];
    const stub: ReminderDeliveryPort = {
      async send(input) {
        sent.push(input.idempotencyKey);
        return input.channel === 'sms'
          ? { provider: 'msg91', providerMessageId: `msg91-${sent.length}` }
          : { provider: 'ses', providerMessageId: `ses-${sent.length}` };
      },
    };
    const repo = new PgFeesRepository(pool!);
    const service = new FeesService(repo, new SandboxPaymentAdapter(), { reminderDelivery: stub });
    const { tenantId, invoice } = await overdueInvoice(service);
    const result = await service.sendReminders(
      tenantId,
      'bursar-1',
      { invoiceIds: [invoice.id], channels: ['sms', 'email'] },
      new Date('2026-02-01T09:00:00.000Z'),
    );
    expect(result.mode).toBe('live');
    expect(result.results.map((r) => r.skippedReason)).toEqual([undefined, undefined]);
    const audits = await service.listReminderSendAudits(tenantId);
    expect(
      audits
        .map((a) => [a.channel, a.mode, a.provider, a.providerMessageId])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ['email', 'live', 'ses', 'ses-2'],
      ['sms', 'live', 'msg91', 'msg91-1'],
    ]);
    // A repeat run the same day is idempotent: no second provider call.
    await service.sendReminders(
      tenantId,
      'bursar-1',
      { invoiceIds: [invoice.id], channels: ['sms', 'email'] },
      new Date('2026-02-01T15:00:00.000Z'),
    );
    expect(sent).toHaveLength(2);
  });

  it.skipIf(!live)('stays sandbox with no provider configured', async () => {
    const service = new FeesService(new PgFeesRepository(pool!), new SandboxPaymentAdapter());
    const { tenantId, invoice } = await overdueInvoice(service);
    const result = await service.sendReminders(
      tenantId,
      'bursar-1',
      { invoiceIds: [invoice.id], channels: ['email'] },
      new Date('2026-02-01T09:00:00.000Z'),
    );
    expect(result.mode).toBe('sandbox');
    const [audit] = await service.listReminderSendAudits(tenantId);
    expect([audit?.mode, audit?.provider ?? null]).toEqual(['sandbox', null]);
  });

  it.skipIf(!live)('refuses a live row without matching provider evidence', async () => {
    const service = new FeesService(new PgFeesRepository(pool!), new SandboxPaymentAdapter());
    const { tenantId, studentId, invoice } = await overdueInvoice(service);
    const client = await rawPool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const insert = (
        channel: string,
        mode: string,
        provider: string | null,
        providerMessageId: string | null,
      ) =>
        client.query(
          `INSERT INTO fee_reminder_send_audits (
             id, tenant_id, invoice_id, student_id, channel, message_id, mode, honesty_note,
             actor_id, provider, provider_message_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'note', 'bursar-1', $8, $9)`,
          [
            randomUUID(),
            tenantId,
            invoice.id,
            studentId,
            channel,
            randomUUID(),
            mode,
            provider,
            providerMessageId,
          ],
        );
      const bad: Array<[string, string, string | null, string | null]> = [
        ['sms', 'live', null, null],
        ['sms', 'live', 'msg91', null],
        ['sms', 'live', 'ses', 'id-1'],
        ['email', 'live', 'msg91', 'id-2'],
        ['email', 'sandbox', 'ses', 'id-3'],
      ];
      for (const [i, args] of bad.entries()) {
        await client.query(`SAVEPOINT b${i}`);
        await expect(insert(...args)).rejects.toMatchObject({ code: '23514' });
        await client.query(`ROLLBACK TO SAVEPOINT b${i}`);
      }
      await insert('sms', 'live', 'msg91', 'msg91-ok');
      await insert('email', 'sandbox', null, null);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
