/**
 * PRC-L341: schedule recipients are validated emails, de-duplicated, capped and
 * restricted to the school's email domains before the schedule is stored.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { CatalogueService } from './catalogue-service.js';
import { InMemoryReportStore } from './report-store.js';
import {
  readAllowedRecipientDomains,
  type ScheduleRecipientPolicy,
} from './schedule-recipients.js';

const TENANT = '00000000-0000-4000-8000-000000000341';

function service(policy?: ScheduleRecipientPolicy) {
  return new CatalogueService(
    new InMemoryReportStore(),
    new InMemoryReportBlobStore(),
    undefined,
    undefined,
    policy,
  );
}

const schedule = (recipients: string[]) => ({
  reportKey: 'attendance_summary',
  format: 'csv',
  cadence: 'daily',
  recipients,
});

describe('PRC-L341 schedule recipients', () => {
  const school = { allowedDomains: ['school.test'] };

  it('stores trimmed, lower-cased, de-duplicated addresses', async () => {
    const created = await service(school).createSchedule(
      TENANT,
      'staff-1',
      schedule([' Office@School.test', 'office@school.test', 'principal@school.test']),
    );
    expect(created.recipients).toEqual(['office@school.test', 'principal@school.test']);
  });

  it('rejects a value that is not an email address', async () => {
    await expect(
      service(school).createSchedule(TENANT, 'staff-1', schedule(['not an email'])),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an address outside the school domains', async () => {
    await expect(
      service(school).createSchedule(TENANT, 'staff-1', schedule(['someone@gmail.example'])),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects more than 20 distinct recipients', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `user${i}@school.test`);
    await expect(
      service(school).createSchedule(TENANT, 'staff-1', schedule(many)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('live delivery without a domain allow-list refuses recipients', async () => {
    await expect(
      service({ allowedDomains: [], requireAllowedDomains: true }).createSchedule(
        TENANT,
        'staff-1',
        schedule(['office@school.test']),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    // A schedule without recipients is still allowed.
    const created = await service({
      allowedDomains: [],
      requireAllowedDomains: true,
    }).createSchedule(TENANT, 'staff-1', schedule([]));
    expect(created.recipients).toEqual([]);
  });

  it('reads REPORT_RECIPIENT_ALLOWED_DOMAINS', () => {
    expect(
      readAllowedRecipientDomains({ REPORT_RECIPIENT_ALLOWED_DOMAINS: ' School.test, ,b.example' }),
    ).toEqual(['school.test', 'b.example']);
  });
});

describe('PRC-L341 plugin: live delivery in production needs school domains', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  async function pluginService(options: Record<string, unknown>) {
    process.env.NODE_ENV = 'production';
    const app = Fastify();
    await app.register(reportCataloguePlugin, {
      store: new InMemoryReportStore(),
      blobStore: new InMemoryReportBlobStore(),
      disableScheduler: true,
      emailSender: { send: async () => ({ success: true, messageId: 'm', mode: 'live' }) },
      ...options,
    });
    await app.ready();
    return { app, service: app.reportCatalogueService! };
  }

  it('refuses recipients without configured domains, accepts in-domain ones with them', async () => {
    const bare = await pluginService({ allowedRecipientDomains: [] });
    await expect(
      bare.service.createSchedule(TENANT, 'staff-1', schedule(['office@school.test'])),
    ).rejects.toMatchObject({ statusCode: 400 });
    await bare.app.close();

    const configured = await pluginService({ allowedRecipientDomains: ['school.test'] });
    const created = await configured.service.createSchedule(
      TENANT,
      'staff-1',
      schedule(['office@school.test']),
    );
    expect(created.recipients).toEqual(['office@school.test']);
    await expect(
      configured.service.createSchedule(TENANT, 'staff-1', schedule(['x@other.example'])),
    ).rejects.toMatchObject({ statusCode: 400 });
    await configured.app.close();
  });
});
