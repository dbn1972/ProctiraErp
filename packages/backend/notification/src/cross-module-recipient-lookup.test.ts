/**
 * Unit tests for CrossModuleNotificationRecipientLookup — sequential port
 * calls + in-memory UUID merge (OR semantics), matching the in-memory repo.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CrossModuleNotificationRecipientLookup,
  createNotificationRecipientLookup,
  type CrossModuleRecipientLookupDeps,
} from './cross-module-recipient-lookup.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const ROLE_A = '00000000-0000-4000-8000-000000000011';
const ROLE_B = '00000000-0000-4000-8000-000000000012';
const AREA_A = '00000000-0000-4000-8000-000000000021';
const INST_A = '00000000-0000-4000-8000-000000000031';
const USER_1 = '00000000-0000-4000-8000-000000000041';
const USER_2 = '00000000-0000-4000-8000-000000000042';
const USER_3 = '00000000-0000-4000-8000-000000000043';

function buildDeps(
  overrides?: Partial<CrossModuleRecipientLookupDeps>,
): CrossModuleRecipientLookupDeps {
  return {
    roles: {
      findUserIdsByRoleIds: vi.fn(async (_t, roleIds) =>
        roleIds.includes(ROLE_A) ? [USER_1] : [],
      ),
    },
    areas: {
      findUserIdsByAreaIds: vi.fn(async (_t, areaIds) =>
        areaIds.includes(AREA_A) ? [USER_2] : [],
      ),
    },
    institutions: {
      findUserIdsByInstitutionIds: vi.fn(async (_t, institutionIds) =>
        institutionIds.includes(INST_A) ? [USER_3] : [],
      ),
    },
    ...overrides,
  };
}

describe('CrossModuleNotificationRecipientLookup', () => {
  it('expands role criteria via the roles port', async () => {
    const lookup = new CrossModuleNotificationRecipientLookup(buildDeps());
    const ids = await lookup.expandRoleAreaInstitution(TENANT, {
      roleIds: [ROLE_A],
    });
    expect(ids).toEqual([USER_1]);
  });

  it('expands area criteria via the areas port', async () => {
    const lookup = new CrossModuleNotificationRecipientLookup(buildDeps());
    const ids = await lookup.expandRoleAreaInstitution(TENANT, {
      areaIds: [AREA_A],
    });
    expect(ids).toEqual([USER_2]);
  });

  it('merges role OR area OR institution (union)', async () => {
    const lookup = createNotificationRecipientLookup(buildDeps());
    const ids = await lookup.expandRoleAreaInstitution(TENANT, {
      roleIds: [ROLE_A, ROLE_B],
      areaIds: [AREA_A],
      institutionIds: [INST_A],
    });
    expect(new Set(ids)).toEqual(new Set([USER_1, USER_2, USER_3]));
  });

  it('returns empty when ports are missing', async () => {
    const lookup = new CrossModuleNotificationRecipientLookup({});
    const ids = await lookup.expandRoleAreaInstitution(TENANT, {
      roleIds: [ROLE_A],
      areaIds: [AREA_A],
    });
    expect(ids).toEqual([]);
  });

  it('skips empty criterion arrays without calling ports', async () => {
    const deps = buildDeps();
    const lookup = new CrossModuleNotificationRecipientLookup(deps);
    await lookup.expandRoleAreaInstitution(TENANT, {
      roleIds: [],
      areaIds: [],
      institutionIds: [],
    });
    expect(deps.roles!.findUserIdsByRoleIds).not.toHaveBeenCalled();
    expect(deps.areas!.findUserIdsByAreaIds).not.toHaveBeenCalled();
    expect(deps.institutions!.findUserIdsByInstitutionIds).not.toHaveBeenCalled();
  });
});
