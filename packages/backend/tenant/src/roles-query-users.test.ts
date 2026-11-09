/**
 * PRC-M026 — RolesService.queryUsers evaluates SCIM exact-match / role
 * filters and an offset window in the repository.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryRolesRepository } from './in-memory-roles-repository.js';
import type { RolesRepository } from './roles-repository.js';
import { RolesService } from './roles-service.js';

const TENANT = 'tenant-m026';

async function seeded(repo: RolesRepository) {
  const service = new RolesService(repo);
  const [role] = await service.listRoles(TENANT);
  for (let i = 0; i < 3; i += 1) {
    await service.inviteUser(TENANT, {
      email: `q${i}@school.org`,
      displayName: `Q ${i}`,
      roleIds: i === 0 && role ? [role.id] : [],
    });
  }
  return { service, roleId: role!.id };
}

const SEED = [{ roleId: 'teacher', roleName: 'Teacher', permissions: [] }];

describe('PRC-M026 RolesService.queryUsers', () => {
  it('uses the repository query (exact match, case-insensitive)', async () => {
    const { service } = await seeded(new InMemoryRolesRepository(SEED));
    const found = await service.queryUsers(
      TENANT,
      { match: { attribute: 'email', value: 'Q1@SCHOOL.ORG' } },
      { offset: 0, limit: 10 },
    );
    expect(found.total).toBe(1);
    expect(found.data[0]!.displayName).toBe('Q 1');
  });

  it('applies the role filter and window', async () => {
    const { service, roleId } = await seeded(new InMemoryRolesRepository(SEED));
    expect((await service.queryUsers(TENANT, { roleId }, { offset: 0, limit: 10 })).total).toBe(1);
    const page = await service.queryUsers(TENANT, {}, { offset: 1, limit: 1 });
    expect(page).toMatchObject({ total: 3, data: [{ displayName: 'Q 1' }] });
  });

  it('falls back to paging listUsers for repositories without queryUsers', async () => {
    const base = new InMemoryRolesRepository(SEED);
    const legacy: RolesRepository = Object.assign(Object.create(base) as RolesRepository, {
      queryUsers: undefined,
    });
    const { service } = await seeded(legacy);
    const found = await service.queryUsers(
      TENANT,
      { match: { attribute: 'email', value: 'q2@school.org' } },
      { offset: 0, limit: 10 },
    );
    expect(found.total).toBe(1);
  });
});
