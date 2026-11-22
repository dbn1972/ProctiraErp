/**
 * PRC-M338 — scheduled-report recipients were never sent anything: the catalogue plugin
 * built CatalogueService with the in-memory delivery port and tickDueSchedules counted
 * every schedule with recipients as `delivered`.
 *
 * After the fix the plugin takes the notification email sender (same EmailSender shape),
 * sends one email per recipient, counts only live sends, and reports nothing as delivered
 * when no delivery backend is configured or the sender is in sandbox mode.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { InMemoryReportStore } from './report-store.js';
import type { ScheduleEmailSender } from './schedule-delivery.js';

process.env.REPORT_DEMO_DATA = '1';

const TENANT = '00000000-0000-4000-8000-000000000001';

type Sent = { to: string; subject: string; body: string; tenantId: string };

function recordingSender(mode: 'live' | 'sandbox', failFor?: string) {
  const sent: Sent[] = [];
  const sender: ScheduleEmailSender = {
    async send(params) {
      sent.push(params);
      if (params.to === failFor) return { success: false, error: 'mailbox unavailable' };
      return { success: true, messageId: `m-${sent.length}`, mode };
    },
  };
  return { sender, sent };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function dueSchedule(options: Record<string, unknown>) {
  const store = new InMemoryReportStore();
  app = Fastify();
  await app.register(reportCataloguePlugin, {
    store,
    blobStore: new InMemoryReportBlobStore(),
    disableScheduler: true,
    ...options,
  });
  await app.ready();
  const service = app.reportCatalogueService!;
  const schedule = await service.createSchedule(TENANT, 'owner', {
    reportKey: 'attendance_summary',
    format: 'csv',
    cadence: 'daily',
    recipients: ['office@school.test', 'principal@school.test'],
  });
  const now = new Date();
  await store.updateSchedule(TENANT, schedule.id, { nextRunAt: new Date(now.getTime() - 60_000) });
  return { service, store, schedule, now };
}

describe('PRC-M338 scheduled report delivery through the notification email port', () => {
  it('emails every recipient through the injected sender and counts the live delivery', async () => {
    const { sender, sent } = recordingSender('live');
    const { service, now } = await dueSchedule({
      emailSender: sender,
      appBaseUrl: 'https://school.example/',
    });
    const tick = await service.tickDueSchedules(now);
    expect(tick).toMatchObject({ due: 1, completed: 1, failed: 0, delivered: 1, undelivered: 0 });
    expect(sent.map((m) => m.to)).toEqual(['office@school.test', 'principal@school.test']);
    for (const mail of sent) {
      expect(mail.tenantId).toBe(TENANT);
      expect(mail.subject).toContain('attendance_summary');
      expect(mail.body).toMatch(
        /https:\/\/school\.example\/api\/v1\/reports\/artifacts\/[^/\s]+\/download/,
      );
      // No bearer download token in a mailbox.
      expect(mail.body).not.toContain('token=');
    }
  });

  it('does not count recipients as delivered when no delivery backend is configured', async () => {
    const { service, now } = await dueSchedule({});
    const tick = await service.tickDueSchedules(now);
    expect(tick.completed).toBe(1);
    expect(tick.delivered).toBe(0);
    expect(tick.undelivered).toBe(1);
  });

  it('does not count a sandbox email sender as a delivery', async () => {
    const { sender, sent } = recordingSender('sandbox');
    const { service, now } = await dueSchedule({ emailSender: sender });
    const tick = await service.tickDueSchedules(now);
    expect(sent).toHaveLength(2);
    expect(tick.delivered).toBe(0);
    expect(tick.undelivered).toBe(1);
  });

  it('a failed send fails the run and retries instead of advancing the cadence', async () => {
    const { sender } = recordingSender('live', 'principal@school.test');
    const { service, store, schedule, now } = await dueSchedule({ emailSender: sender });
    const tick = await service.tickDueSchedules(now);
    expect(tick).toMatchObject({ completed: 0, failed: 1, delivered: 0 });
    const updated = await store.getSchedule(TENANT, schedule.id);
    expect(updated!.nextRunAt.getTime()).toBe(now.getTime() + 5 * 60_000);
  });
});
