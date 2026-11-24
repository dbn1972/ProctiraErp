/**
 * PR B1 (FKB-047): institution create/update resolve `areaId` inside the caller's
 * tenant, so another tenant's area and an unknown id give the same NotFoundError.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { InstitutionService } from './institution-service.js';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '11111111-1111-4111-8111-1111111111bb';
const AREA_A = '22222222-2222-4222-8222-2222222222aa';
const AREA_A2 = '22222222-2222-4222-8222-2222222222a2';
const AREA_B = '22222222-2222-4222-8222-2222222222bb';
const UNKNOWN = '22222222-2222-4222-8222-222222222299';

function setup() {
  const repo = new InMemoryInstitutionRepository();
  repo.seedArea(AREA_A, TENANT_A);
  repo.seedArea(AREA_A2, TENANT_A);
  repo.seedArea(AREA_B, TENANT_B);
  return { repo, service: new InstitutionService(repo) };
}

const input = (code: string, areaId: string) => ({
  name: `School ${code}`,
  code,
  areaId,
  typeId: 'school',
  sectorId: 'public',
  ownershipId: 'government',
});

describe('FKB-047 institution area tenancy', () => {
  it('create and update accept areas of the caller tenant', async () => {
    const { service } = setup();
    const created = await service.create(TENANT_A, input('S1', AREA_A));
    expect(created.areaId).toBe(AREA_A);
    const updated = await service.update(TENANT_A, created.id, { areaId: AREA_A2 });
    expect(updated.areaId).toBe(AREA_A2);
  });

  it.each([
    ['another tenant area', AREA_B],
    ['an unknown area', UNKNOWN],
  ])('create and update reject %s with the same NotFoundError', async (_label, areaId) => {
    const { repo, service } = setup();
    const create = service.create(TENANT_A, input('S2', areaId));
    await expect(create).rejects.toBeInstanceOf(NotFoundError);
    await expect(create).rejects.toThrow(`Area with id '${areaId}' not found`);
    expect(await repo.findByCode('S2', TENANT_A)).toBeNull();

    const existing = await service.create(TENANT_A, input('S3', AREA_A));
    await expect(service.update(TENANT_A, existing.id, { areaId })).rejects.toThrow(
      `Area with id '${areaId}' not found`,
    );
    expect((await repo.findById(existing.id, TENANT_A))?.areaId).toBe(AREA_A);
  });
});
