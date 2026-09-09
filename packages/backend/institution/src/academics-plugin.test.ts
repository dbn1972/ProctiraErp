/**
 * G-901 — institutionPlugin mounts the academics sub-domains
 * (academic periods → grades → classes → subjects → infrastructure) using the
 * in-memory Prisma look-alike, with tenant partitioning of the infrastructure
 * store via the request-scoped tenant context.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { institutionPlugin } from './institution-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof header === 'string' ? header : TENANT_A;
  });
  await app.register(institutionPlugin, { repository: new InMemoryInstitutionRepository() });
  await app.ready();
  return app;
}

describe('G-901 institutionPlugin academics mount', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('serves academic periods, grades, classes and subjects without DATABASE_URL', async () => {
    const institution = await app.inject({
      method: 'POST',
      url: '/institutions',
      payload: {
        name: 'Mount School',
        code: `SCH-${Date.now()}`,
        areaId: randomUUID(),
        typeId: randomUUID(),
        sectorId: randomUUID(),
        ownershipId: randomUUID(),
      },
    });
    expect(institution.statusCode).toBe(201);
    const institutionId = institution.json().id as string;

    const period = await app.inject({
      method: 'POST',
      url: '/academic-periods',
      payload: { name: 'AY 2026-27', code: 'AY26', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    expect(period.statusCode).toBe(201);
    expect(period.json().status).toBe('active');

    const list = await app.inject({ method: 'GET', url: '/academic-periods' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/academic-periods',
      payload: { name: 'Dup', code: 'AY26', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    expect(duplicate.statusCode).toBe(409);

    const grade = await app.inject({
      method: 'POST',
      url: '/grades',
      payload: { name: 'Grade 7', code: 'G7', order: 7 },
    });
    expect(grade.statusCode).toBe(201);

    const cls = await app.inject({
      method: 'POST',
      url: '/classes',
      payload: {
        institutionId,
        gradeId: grade.json().id,
        academicPeriodId: period.json().id,
        name: '7-A',
        capacity: 40,
      },
    });
    expect(cls.statusCode).toBe(201);

    const classes = await app.inject({
      method: 'GET',
      url: `/classes?institutionId=${institutionId}`,
    });
    expect(classes.statusCode).toBe(200);
    expect(classes.json()).toHaveLength(1);
    expect(classes.json()[0].name).toBe('7-A');

    const unknownInstitution = await app.inject({
      method: 'POST',
      url: '/classes',
      payload: {
        institutionId: randomUUID(),
        gradeId: grade.json().id,
        academicPeriodId: period.json().id,
        name: '7-B',
      },
    });
    expect(unknownInstitution.statusCode).toBe(404);

    const subject = await app.inject({
      method: 'POST',
      url: '/subjects',
      payload: { name: 'Mathematics', code: 'MATH' },
    });
    expect(subject.statusCode).toBe(201);
    const subjects = await app.inject({ method: 'GET', url: '/subjects' });
    expect(subjects.json()).toHaveLength(1);
  });

  it('serves the infrastructure hierarchy and partitions it per tenant', async () => {
    const institutionId = randomUUID();
    const land = await app.inject({
      method: 'POST',
      url: '/infrastructure/lands',
      payload: { name: 'Main campus', institutionId, capacity: 5000, condition: 'GOOD' },
    });
    expect(land.statusCode).toBe(201);

    const building = await app.inject({
      method: 'POST',
      url: '/infrastructure/buildings',
      payload: {
        name: 'Block A',
        landId: land.json().id,
        institutionId,
        capacity: 800,
        condition: 'GOOD',
      },
    });
    expect(building.statusCode).toBe(201);

    const hierarchy = await app.inject({
      method: 'GET',
      url: `/infrastructure/hierarchy/${institutionId}`,
    });
    expect(hierarchy.statusCode).toBe(200);
    expect(hierarchy.json().lands).toHaveLength(1);
    expect(hierarchy.json().lands[0].buildings).toHaveLength(1);

    const otherTenant = await app.inject({
      method: 'GET',
      url: `/infrastructure/hierarchy/${institutionId}`,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(otherTenant.statusCode).toBe(200);
    expect(otherTenant.json().lands).toHaveLength(0);
  });

  it('isolates academic periods between tenants', async () => {
    await app.inject({
      method: 'POST',
      url: '/academic-periods',
      payload: { name: 'A', code: 'A', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    const other = await app.inject({
      method: 'GET',
      url: '/academic-periods',
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(other.json()).toHaveLength(0);
  });
});
