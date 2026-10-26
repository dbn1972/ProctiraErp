/**
 * PRC-M286 — `createLand` and `logRepairRequest` must verify that the
 * `institutionId` they are given belongs to the caller's tenant before
 * storing it. Without the guard, a caller from tenant B can create
 * infrastructure (or log a repair request) against tenant A's institution id
 * just by guessing/knowing it.
 */
import { randomUUID } from 'node:crypto';

import { NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import type { InstitutionEntity } from '../institution-repository.js';

import { InMemoryConditionOptionStore, InMemoryInfrastructureStore } from './in-memory-store.js';
import { InfrastructureService } from './service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

async function seedInstitution(
  repository: InMemoryInstitutionRepository,
  tenantId: string,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const entity: InstitutionEntity = {
    id,
    tenantId,
    name: 'Seed School',
    code: `CODE-${id.slice(0, 8)}`,
    areaId: randomUUID(),
    typeId: randomUUID(),
    sectorId: randomUUID(),
    ownershipId: randomUUID(),
    status: 'ACTIVE',
    latitude: null,
    longitude: null,
    address: null,
    contactPhone: null,
    contactEmail: null,
    deactivationReason: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.create(entity);
  return id;
}

describe('PRC-M286 infrastructure institution-ownership guard', () => {
  let repository: InMemoryInstitutionRepository;
  let institutionIdA: string;

  beforeEach(async () => {
    repository = new InMemoryInstitutionRepository();
    institutionIdA = await seedInstitution(repository, TENANT_A);
  });

  describe('createLand', () => {
    it('rejects a tenant-B caller naming tenant-A institution when the guard is wired', async () => {
      const service = new InfrastructureService({
        store: new InMemoryInfrastructureStore(),
        conditionStore: new InMemoryConditionOptionStore(),
        institutionRepository: repository,
      });

      await expect(
        service.createLand(
          { name: 'Stolen Land', institutionId: institutionIdA, capacity: 10, condition: 'Good' },
          TENANT_B,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows the owning tenant to create land for its own institution', async () => {
      const service = new InfrastructureService({
        store: new InMemoryInfrastructureStore(),
        conditionStore: new InMemoryConditionOptionStore(),
        institutionRepository: repository,
      });

      const land = await service.createLand(
        { name: 'Own Land', institutionId: institutionIdA, capacity: 10, condition: 'Good' },
        TENANT_A,
      );
      expect(land.institutionId).toBe(institutionIdA);
    });

    it('skips the guard (back-compat) when no institutionRepository is wired', async () => {
      const service = new InfrastructureService({
        store: new InMemoryInfrastructureStore(),
        conditionStore: new InMemoryConditionOptionStore(),
      });

      const land = await service.createLand({
        name: 'Unscoped Land',
        institutionId: institutionIdA,
        capacity: 10,
        condition: 'Good',
      });
      expect(land.institutionId).toBe(institutionIdA);
    });
  });

  describe('logRepairRequest', () => {
    it('rejects a tenant-B caller logging a repair request against tenant-A infrastructure', async () => {
      const store = new InMemoryInfrastructureStore();
      const service = new InfrastructureService({
        store,
        conditionStore: new InMemoryConditionOptionStore(),
        institutionRepository: repository,
      });
      const land = await service.createLand(
        { name: 'A Land', institutionId: institutionIdA, capacity: 10, condition: 'Good' },
        TENANT_A,
      );

      await expect(
        service.logRepairRequest(
          { institutionId: institutionIdA, infrastructureId: land.id, summary: 'Leak' },
          TENANT_B,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows the owning tenant to log a repair request', async () => {
      const store = new InMemoryInfrastructureStore();
      const service = new InfrastructureService({
        store,
        conditionStore: new InMemoryConditionOptionStore(),
        institutionRepository: repository,
      });
      const land = await service.createLand(
        { name: 'A Land', institutionId: institutionIdA, capacity: 10, condition: 'Good' },
        TENANT_A,
      );

      const repair = await service.logRepairRequest(
        { institutionId: institutionIdA, infrastructureId: land.id, summary: 'Leak' },
        TENANT_A,
      );
      expect(repair.institutionId).toBe(institutionIdA);
    });
  });
});
