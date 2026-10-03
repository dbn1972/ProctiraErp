/**
 * PRC-M051 / PRC-M056 — the public directory gets real filter options and the
 * form-config response carries the institution name.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { isPublicRegistrationPath } from './registration-access.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

const TENANT = 'tenant-filters';
const PRIMARY = '11111111-1111-4111-8111-111111111111';
const SECONDARY = '22222222-2222-4222-8222-222222222222';
const INST_A = '33333333-3333-4333-8333-333333333333';
const INST_B = '44444444-4444-4444-8444-444444444444';

async function build() {
  const repo = new InMemoryRegistrationRepository();
  const base = { tenantId: TENANT, latitude: null, longitude: null, address: null };
  repo.seedInstitutions([
    { ...base, id: INST_A, name: 'Alpha Primary', code: 'A', typeId: PRIMARY, typeName: 'Primary', areaId: 'n', areaName: 'North', status: 'ACTIVE', availableGrades: ['1', '2'] },
    { ...base, id: INST_B, name: 'Beta High', code: 'B', typeId: SECONDARY, typeName: 'Secondary', areaId: 's', areaName: 'South', status: 'ACTIVE', availableGrades: ['9'] },
    { ...base, id: '55555555-5555-4555-8555-555555555555', name: 'Closed', code: 'C', typeId: 'gone', typeName: 'Gone', areaId: 'x', areaName: 'X', status: 'INACTIVE' },
  ]);
  repo.seedFormConfigurations([
    { id: '66666666-6666-4666-8666-666666666666', tenantId: TENANT, institutionId: INST_A, version: 1, publishedAt: '2026-01-01T00:00:00.000Z', fields: [] },
  ]);
  const app = Fastify();
  await registerRegistrationRoutes(app, {
    registrationService: new RegistrationService(repo),
    defaultTenantId: TENANT,
  });
  await app.ready();
  return app;
}

describe('PRC-M051/M056 institution filters + form-config name', () => {
  it('returns real active type/area/grade options (no inactive types)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/registrations/institution-filters' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      types: [
        { id: PRIMARY, name: 'Primary' },
        { id: SECONDARY, name: 'Secondary' },
      ],
      areas: [
        { id: 'n', name: 'North' },
        { id: 's', name: 'South' },
      ],
      grades: ['1', '2', '9'],
    });
    // Clicking a type tile with its real id lists matching institutions.
    const listed = await app.inject({
      method: 'GET',
      url: `/registrations/institutions?typeId=${PRIMARY}`,
    });
    expect((listed.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual([
      INST_A,
    ]);
    await app.close();
  });

  it('form-config includes institutionName (single call for the apply heading)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: `/registrations/form-config/${INST_A}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ institutionId: INST_A, institutionName: 'Alpha Primary' });
    await app.close();
  });

  it('filters endpoint is public', () => {
    expect(isPublicRegistrationPath('/api/v1/registrations/institution-filters')).toBe(true);
  });
});
