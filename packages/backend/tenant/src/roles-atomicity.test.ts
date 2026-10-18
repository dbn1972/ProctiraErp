/**
 * PRC-L371 — invite / role-create atomicity (no check-then-insert race).
 *
 * FAILING-FIRST: the two concurrency tests below release both callers past
 * their existence check before either writes. On the unmodified service
 * (which does `findByEmail`/`findByName` then a separate `upsert`/`create`)
 * BOTH callers see "absent" and BOTH write, so two records survive and the
 * "exactly one wins / the other throws ConflictError" assertion FAILS. After
 * the fix delegates uniqueness to an atomic conditional write
 * (`insertUserIfEmailAbsent` / `createRoleIfNameAbsent`) exactly one wins.
 *
 * The wrapper makes the OLD read path (`findUserByEmail` / `findRoleByName`)
 * block on a shared gate so the interleaving is deterministic. The NEW path
 * no longer relies on those reads for uniqueness, so the gate is a no-op for
 * correctness there and the atomic method decides the winner.
 */
import { describe, expect, it } from 'vitest';

import { ConflictError } from '@proctira/common';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import type { RoleEntity, RolesRepository, UserRecord } from './roles-repository.js';
import { RolesService } from './roles-service.js';

const SEED: BuiltInRoleSeed[] = [
  {
    roleId: 'admin',
    roleName: 'Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
];

const TENANT = 'tenant-a';

/**
 * Wraps a real repository and makes the legacy uniqueness-read methods block
 * on a gate the test opens once both concurrent callers have arrived, forcing
 * the classic check-then-insert interleaving.
 */
class GatedRepo implements RolesRepository {
  private arrivals = 0;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(
    private readonly inner: InMemoryRolesRepository,
    private readonly expectedArrivals: number,
  ) {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  private async passGate(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals >= this.expectedArrivals) this.release();
    await this.gate;
  }

  // Legacy uniqueness reads — gated to force the race on old code.
  async findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    await this.passGate();
    return this.inner.findUserByEmail(tenantId, email);
  }
  async findRoleByName(tenantId: string, name: string): Promise<RoleEntity | null> {
    await this.passGate();
    return this.inner.findRoleByName(tenantId, name);
  }

  // Everything else delegates straight through.
  listRoles(t: string) {
    return this.inner.listRoles(t);
  }
  findRoleById(t: string, id: string) {
    return this.inner.findRoleById(t, id);
  }
  createRole(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>) {
    return this.inner.createRole(data);
  }
  createRoleIfNameAbsent(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>) {
    return this.inner.createRoleIfNameAbsent(data);
  }
  updateRole(t: string, id: string, data: Parameters<RolesRepository['updateRole']>[2]) {
    return this.inner.updateRole(t, id, data);
  }
  deleteRole(t: string, id: string) {
    return this.inner.deleteRole(t, id);
  }
  listUsers(
    t: string,
    f: Parameters<RolesRepository['listUsers']>[1],
    p: Parameters<RolesRepository['listUsers']>[2],
  ) {
    return this.inner.listUsers(t, f, p);
  }
  findUserById(t: string, id: string) {
    return this.inner.findUserById(t, id);
  }
  upsertUser(u: UserRecord) {
    return this.inner.upsertUser(u);
  }
  insertUserIfEmailAbsent(u: UserRecord) {
    return this.inner.insertUserIfEmailAbsent(u);
  }
  setUserRoles(t: string, id: string, roleIds: string[]) {
    return this.inner.setUserRoles(t, id, roleIds);
  }
}

describe('RolesService atomicity (PRC-L371)', () => {
  it('two concurrent invites for the same e-mail: exactly one succeeds', async () => {
    const inner = new InMemoryRolesRepository(SEED);
    const repo = new GatedRepo(inner, 2);
    const service = new RolesService(repo);

    const invite = () =>
      service.inviteUser(TENANT, {
        email: 'dup@example.test',
        displayName: 'Dup',
        roleIds: [],
      });

    const results = await Promise.allSettled([invite(), invite()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // The directory holds exactly one user with that e-mail.
    const page = await inner.listUsers(
      TENANT,
      { search: 'dup@example.test' },
      { page: 1, pageSize: 10 },
    );
    expect(page.meta.totalItems).toBe(1);
  });

  it('two concurrent role creates with the same name: exactly one succeeds', async () => {
    const inner = new InMemoryRolesRepository(SEED);
    const repo = new GatedRepo(inner, 2);
    const service = new RolesService(repo);

    const create = () => service.createRole(TENANT, { name: 'Dup Role', permissions: [] });

    const results = await Promise.allSettled([create(), create()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const roles = await inner.listRoles(TENANT);
    expect(roles.filter((r) => r.name === 'Dup Role')).toHaveLength(1);
  });
});
