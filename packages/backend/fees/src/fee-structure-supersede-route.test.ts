/**
 * PRC-L471: fee structure supersede and instalment-driven due dates are reachable
 * over HTTP (they existed only in the service), supersede commits atomically, and
 * bulk invoices fall due on the first instalment when no dueAt is given.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feesPlugin } from './fees-plugin.js';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const CLASS_ID = '00000000-0000-4000-8000-0000000000c1';
const S1 = '00000000-0000-4000-8000-000000000091';

async function buildApp(repository: InMemoryFeesRepository, roles = ['bursar']) {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const r = request as { tenantId?: string; user?: { sub?: string; roles?: unknown } };
    r.tenantId = TENANT;
    r.user = { sub: 'bursar-1', roles };
  });
  await app.register(feesPlugin, { repository, prefix: '/fees' });
  await app.ready();
  return app;
}

describe('PRC-L471 fee structure supersede + instalment due dates', () => {
  let repository: InMemoryFeesRepository;
  let app: FastifyInstance;
  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    app = await buildApp(repository);
  });
  afterEach(async () => {
    await app.close();
  });

  async function createStructure(payload: Record<string, unknown>) {
    const res = await app.inject({ method: 'POST', url: '/fees/structures', payload });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; code: string };
  }

  it('POST /structures/:id/supersede closes the prior window and appends version 2', async () => {
    const prior = await createStructure({
      name: 'Tuition 2025',
      category: 'tuition',
      code: 'TUITION',
      amountCents: 10_000,
      validFrom: '2025-01-01',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/fees/structures/${prior.id}/supersede`,
      payload: {
        name: 'Tuition 2026',
        category: 'tuition',
        amountCents: 12_000,
        validFrom: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      code: 'TUITION',
      version: 2,
      supersedesId: prior.id,
      amountCents: 12_000,
      validFrom: '2026-01-01',
    });
    const closed = await repository.findFeeStructureById(prior.id, TENANT);
    expect(closed).toMatchObject({ validTo: '2025-12-31', amountCents: 10_000 });
  });

  it('supersede refuses a different code, a missing validFrom, and a non-staff caller', async () => {
    const prior = await createStructure({
      name: 'Bus',
      category: 'transport',
      code: 'BUS',
      amountCents: 500,
      validFrom: '2025-01-01',
    });
    const renamed = await app.inject({
      method: 'POST',
      url: `/fees/structures/${prior.id}/supersede`,
      payload: {
        name: 'Bus',
        category: 'transport',
        code: 'OTHER',
        amountCents: 600,
        validFrom: '2026-01-01',
      },
    });
    expect(renamed.statusCode).toBe(422);
    const noDate = await app.inject({
      method: 'POST',
      url: `/fees/structures/${prior.id}/supersede`,
      payload: { name: 'Bus', category: 'transport', amountCents: 600 },
    });
    expect(noDate.statusCode).toBe(400);
    const parentApp = await buildApp(repository, ['parent']);
    const denied = await parentApp.inject({
      method: 'POST',
      url: `/fees/structures/${prior.id}/supersede`,
      payload: { name: 'Bus', category: 'transport', amountCents: 600, validFrom: '2026-01-01' },
    });
    await parentApp.close();
    expect(denied.statusCode).toBe(403);
    expect((await repository.findFeeStructureById(prior.id, TENANT))?.validTo).toBeNull();
  });

  it('supersede is atomic: a failed successor insert leaves the prior window open', async () => {
    const service = new FeesService(repository);
    const prior = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Lab',
      category: 'lab',
      code: 'LAB',
      amountCents: 100,
      validFrom: '2025-01-01',
    });
    vi.spyOn(repository, 'createFeeStructure').mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.supersedeFeeStructure(TENANT, 'staff', prior.id, {
        name: 'Lab v2',
        category: 'lab',
        amountCents: 200,
        validFrom: '2026-01-01',
      }),
    ).rejects.toThrow('db down');
    expect((await repository.findFeeStructureById(prior.id, TENANT))?.validTo).toBeNull();
  });

  it('instalment routes return the calendar due date (validFrom + dueOffsetDays)', async () => {
    const structure = await createStructure({
      name: 'Term fee',
      category: 'tuition',
      amountCents: 9_000,
      validFrom: '2026-04-01',
    });
    const generated = await app.inject({
      method: 'POST',
      url: `/fees/structures/${structure.id}/instalments`,
      payload: { partCount: 3, dueOffsetDays: [10, 40, 100] },
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.map((r: { dueDate: string }) => r.dueDate)).toEqual([
      '2026-04-11',
      '2026-05-11',
      '2026-07-10',
    ]);
    const listed = await app.inject({
      method: 'GET',
      url: `/fees/structures/${structure.id}/instalments`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data[0]).toMatchObject({
      sequence: 1,
      dueOffsetDays: 10,
      dueDate: '2026-04-11',
    });
  });

  it('bulk invoice without dueAt falls due on the first instalment; explicit dueAt wins', async () => {
    repository.seedClassRoster(TENANT, { classId: CLASS_ID }, [S1]);
    const service = new FeesService(repository);
    const structure = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Term fee',
      category: 'tuition',
      amountCents: 9_000,
      validFrom: '2026-04-01',
    });
    await service.generateInstalmentSchedule(TENANT, structure.id, {
      partCount: 2,
      dueOffsetDays: [15, 45],
    });
    const res = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: structure.id,
      classId: CLASS_ID,
    });
    expect(res.created[0]?.dueAt?.toISOString()).toBe('2026-04-16T00:00:00.000Z');

    const other = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Exam fee',
      category: 'exam',
      amountCents: 1_000,
      validFrom: '2026-04-01',
      partCount: 2,
    });
    const explicit = await service.bulkInvoiceClass(TENANT, 'staff', {
      structureId: other.id,
      classId: CLASS_ID,
      dueAt: '2026-06-30',
    });
    expect(explicit.created[0]?.dueAt?.toISOString().slice(0, 10)).toBe('2026-06-30');
  });
});
