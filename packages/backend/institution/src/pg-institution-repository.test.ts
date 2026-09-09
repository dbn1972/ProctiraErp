/**
 * G-812 — Institution repository smoke.
 *
 * - Always asserts the in-memory factory path when DATABASE_URL is unset.
 * - Live Prisma path runs only when DATABASE_URL and G812_LIVE=1 are set
 *   (requires migrated schema + tenant FK seed in CI integration job).
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createInstitutionRepository,
  isPgInstitutionEnabled,
} from './repository-factory.js';

const live = isPgInstitutionEnabled() && process.env['G812_LIVE'] === '1';

describe('InstitutionRepository (G-812)', () => {
  const savedUrl = process.env['DATABASE_URL'];

  afterEach(() => {
    if (savedUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = savedUrl;
  });

  it('uses in-memory repository when DATABASE_URL is unset', async () => {
    delete process.env['DATABASE_URL'];
    expect(isPgInstitutionEnabled()).toBe(false);
    const repo = createInstitutionRepository();
    const tenantId = randomUUID();
    const id = randomUUID();
    await repo.create({
      id,
      tenantId,
      name: 'Memory School',
      code: `MEM-${id.slice(0, 6)}`,
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
    });
    expect(await repo.findById(id, tenantId)).not.toBeNull();
    expect(await repo.findById(id, randomUUID())).toBeNull();
  });

  it.skipIf(!live)(
    'live Postgres: create → read within tenant → cross-tenant deny',
    async () => {
      const repo = createInstitutionRepository();
      const tenantId = randomUUID();
      const id = randomUUID();
      await repo.create({
        id,
        tenantId,
        name: 'Live School',
        code: `LIVE-${id.slice(0, 6)}`,
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
      });
      expect(await repo.findById(id, tenantId)).not.toBeNull();
      expect(await repo.findById(id, randomUUID())).toBeNull();
    },
  );
});
