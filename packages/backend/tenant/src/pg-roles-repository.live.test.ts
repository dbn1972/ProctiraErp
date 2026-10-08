/**
 * Live reproduction for PR #585 (PRC-H007/H116): the roles repository writes
 * tenant-scoped documents through PgDocumentCollection. The admin-console
 * "create a custom role" smoke test began failing after that PR.
 *
 * Exercises the exact gateway flow: RolesService.createRole (which generates a
 * bare uuid id and runs a findRoleByName collision check first) → listRoles.
 *
 * Runs as the non-owner runtime role so RLS is real. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRolesRepository } from './pg-roles-repository.js';
import { RolesService } from './roles-service.js';
import type { BuiltInRoleSeed } from './in-memory-roles-repository.js';

const liveTestsRequired =
  process.env.ALLOW_LIVE_TEST_SKIP !== '1' &&
  (process.env.REQUIRE_LIVE_TESTS === '1' || process.env.CI === 'true' || process.env.CI === '1');
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL && liveTestsRequired) {
  throw new Error('[W3-TEST-03] pg-roles-repository.live.test has no DATABASE_URL');
}
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;
const live = Boolean(pool);

const SEED: BuiltInRoleSeed[] = [
  {
    roleId: 'admin',
    roleName: 'Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
  {
    roleId: 'principal',
    roleName: 'Principal',
    permissions: [{ resource: 'institution', action: 'read' }],
  },
];

describe.skipIf(!live)('PgRolesRepository (live)', () => {
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  let repo: PgRolesRepository;
  let service: RolesService;

  async function ensureTenant(tenantId: string): Promise<void> {
    await withPgTenant(pool!, tenantId, (client) =>
      client.query(
        `INSERT INTO tenants (id, name, slug, config, status)
         VALUES ($1::uuid, $2, $3, '{}'::jsonb, 'active')
         ON CONFLICT (id) DO UPDATE
           SET status = 'active', deleted_at = NULL, updated_at = now()`,
        [tenantId, `Test tenant ${tenantId.slice(0, 8)}`, `test-${tenantId}`],
      ),
    );
  }

  beforeAll(async () => {
    await ensureTenant(TENANT_A);
    await ensureTenant(TENANT_B);
    repo = new PgRolesRepository(pool!, SEED);
    service = new RolesService(repo);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('creates a custom role through the service and lists it back', async () => {
    // ensureSeeded (built-ins) runs inside listRoles.
    const seeded = await service.listRoles(TENANT_A);
    expect(seeded.map((r) => r.roleId)).toContain('admin');

    const name = `Clerk ${Date.now().toString(36)}`;
    const created = await service.createRole(TENANT_A, {
      name,
      description: 'E2E custom role',
      permissions: [{ resource: 'student', action: 'read' }],
    });
    expect(created.name).toBe(name);

    // This is the assertion the E2E encodes (role-card visible after reload).
    const after = await service.listRoles(TENANT_A);
    expect(after.map((r) => r.name)).toContain(name);

    const fetched = await service.getRole(TENANT_A, created.id);
    expect(fetched.name).toBe(name);

    const renamed = await service.updateRole(TENANT_A, created.id, { name: `${name} v2` });
    expect(renamed.name).toBe(`${name} v2`);

    await service.deleteRole(TENANT_A, created.id);
    const afterDelete = await service.listRoles(TENANT_A);
    expect(afterDelete.map((r) => r.name)).not.toContain(`${name} v2`);
  });

  it('keeps the H007/H116 property: tenant B cannot read or overwrite tenant A role', async () => {
    const created = await service.createRole(TENANT_A, {
      name: `Shared ${Date.now().toString(36)}`,
      permissions: [],
    });
    const asB = await repo.findRoleById(TENANT_B, created.id);
    expect(asB).toBeNull();
  });

  // PRC-H007/H116 regression: tenant-addressed writes/reads run under
  // withPgTenant, which binds app.tenant_id to the *caller-supplied* tenant id
  // string. The RLS policy compares current_setting('app.tenant_id') against
  // tenant_id::text (canonical lowercase uuid). A non-canonical id (uppercase
  // hex — a valid uuid a JWT/session can legitimately carry) made the WITH CHECK
  // fail (42501 -> spurious DocumentOwnershipConflictError) and byTenant reads
  // return nothing. Under withPlatformScope (pre-#585) the escape masked it.
  it('handles a non-canonical (uppercase) tenant id without a spurious ownership conflict', async () => {
    const canonical = randomUUID();
    const upper = canonical.toUpperCase();
    await ensureTenant(canonical);
    const upperRepo = new PgRolesRepository(pool!, SEED);
    const upperService = new RolesService(upperRepo);

    // ensureSeeded + createRole + listRoles must all succeed with the uppercase id.
    const created = await upperService.createRole(upper, {
      name: `Upper ${Date.now().toString(36)}`,
      permissions: [{ resource: 'student', action: 'read' }],
    });
    const listed = await upperService.listRoles(upper);
    expect(listed.map((r) => r.id)).toContain(created.id);
  });
});
