/**
 * PRC-L591 — cross-tenant negative authorization + concurrency.
 *
 * Tenant A's context must never be able to READ or MUTATE tenant B's roles,
 * settings, or branding. These tests drive the HTTP routes with two tenants
 * and assert that a request carrying A's tenant id, targeting a B-owned
 * resource, returns 404/403 (never 200 with B's content) and leaves B
 * unchanged. A direct concurrency assertion (two concurrent role adds for the
 * same user) confirms neither update is lost. The invite/role-create and
 * branding-clobber concurrency races are proven in `roles-atomicity.test.ts`
 * and `branding-atomicity.test.ts`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { InMemoryTenantSettingsStore, registerTenantSettingsRoutes } from './tenant-settings.js';
import { registerBrandingRoutes } from './branding-routes.js';
import { registerRolesRoutes } from './roles-routes.js';
import { RolesService } from './roles-service.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const PUBLISHER = '11111111-1111-4111-8111-111111111111';

const SEED: BuiltInRoleSeed[] = [
  { roleId: 'admin', roleName: 'Administrator', permissions: [{ resource: '*', action: 'manage' }] },
];

const tenantHeader = (t: string) => ({ 'x-tenant-id': t });

describe('cross-tenant roles isolation (PRC-L591)', () => {
  let app: FastifyInstance;
  let repo: InMemoryRolesRepository;

  beforeEach(async () => {
    repo = new InMemoryRolesRepository(SEED);
    repo.seedUsers(TENANT_A, [
      { id: 'a-user', tenantId: TENANT_A, email: 'a@a.test', displayName: 'A', roleIds: [], status: 'ACTIVE' },
    ]);
    const service = new RolesService(repo);
    app = Fastify();
    await registerRolesRoutes(app, {
      rolesService: service,
      getTenantId: (req) => req.headers['x-tenant-id'] as string | undefined,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('tenant A cannot READ a role created in tenant B', async () => {
    // B creates a custom role.
    const created = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: tenantHeader(TENANT_B),
      payload: { name: 'B Only', permissions: [{ resource: 'student', action: 'read' }] },
    });
    expect(created.statusCode).toBe(201);
    const bRoleId = created.json().id;

    // A tries to read B's role by id — must NOT get B's data.
    const read = await app.inject({
      method: 'GET',
      url: `/tenant/roles/${bRoleId}`,
      headers: tenantHeader(TENANT_A),
    });
    expect(read.statusCode).toBe(404);
  });

  it('tenant A cannot MUTATE (delete) a role owned by tenant B', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: tenantHeader(TENANT_B),
      payload: { name: 'B Mutable', permissions: [] },
    });
    const bRoleId = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/tenant/roles/${bRoleId}`,
      headers: tenantHeader(TENANT_A),
    });
    expect(del.statusCode).toBe(404);

    // B still has the role.
    const stillThere = await app.inject({
      method: 'GET',
      url: `/tenant/roles/${bRoleId}`,
      headers: tenantHeader(TENANT_B),
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('tenant A listing roles never includes tenant B custom roles', async () => {
    await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: tenantHeader(TENANT_B),
      payload: { name: 'B Custom', permissions: [] },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/tenant/roles',
      headers: tenantHeader(TENANT_A),
    });
    const names = list.json().data.map((r: { name: string }) => r.name);
    expect(names).not.toContain('B Custom');
  });
});

describe('cross-tenant settings isolation (PRC-L591)', () => {
  let app: FastifyInstance;
  const validSettings = {
    displayName: 'B School',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    timezone: 'UTC',
    academicYearStartMonth: 4,
    branding: { primaryColor: '#111111', accentColor: '#222222' },
    contact: {},
  };

  beforeEach(async () => {
    const store = new InMemoryTenantSettingsStore();
    app = Fastify();
    await registerTenantSettingsRoutes(app, {
      store,
      getTenantId: (req) => req.headers['x-tenant-id'] as string | undefined,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('A reads its own (default) settings, never B saved settings', async () => {
    // B saves custom settings.
    const saved = await app.inject({
      method: 'PUT',
      url: '/tenant/settings',
      headers: tenantHeader(TENANT_B),
      payload: validSettings,
    });
    expect(saved.statusCode).toBe(200);

    // A reads — gets defaults scoped to A, not B's displayName.
    const read = await app.inject({
      method: 'GET',
      url: '/tenant/settings',
      headers: tenantHeader(TENANT_A),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().tenantId).toBe(TENANT_A);
    expect(read.json().displayName).not.toBe('B School');
  });

  it("A's PUT writes only A's record and leaves B untouched", async () => {
    await app.inject({
      method: 'PUT',
      url: '/tenant/settings',
      headers: tenantHeader(TENANT_B),
      payload: validSettings,
    });
    await app.inject({
      method: 'PUT',
      url: '/tenant/settings',
      headers: tenantHeader(TENANT_A),
      payload: { ...validSettings, displayName: 'A School' },
    });
    const bRead = await app.inject({
      method: 'GET',
      url: '/tenant/settings',
      headers: tenantHeader(TENANT_B),
    });
    expect(bRead.json().displayName).toBe('B School');
  });
});

describe('cross-tenant branding isolation (PRC-L591)', () => {
  let app: FastifyInstance;
  let service: TenantService;
  let idA: string;
  let idB: string;

  beforeEach(async () => {
    const repo = new InMemoryTenantRepository();
    service = new TenantService(repo, undefined, new RecordingAdminProvisioner());
    const mk = async (slug: string) =>
      (
        await service.createTenant({
          name: slug,
          slug,
          admin: { firstName: 'A', lastName: 'B', email: `a@${slug}.test`, password: 'password123' },
        })
      ).id;
    idA = await mk('brand-a');
    idB = await mk('brand-b');

    app = Fastify();
    await registerBrandingRoutes(app, {
      tenantService: service,
      getTenantId: (req) => req.headers['x-tenant-id'] as string | undefined,
      hasPermission: () => true,
      getActorId: () => PUBLISHER,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("A's published branding does not leak into B's active branding", async () => {
    await service.publishBranding(idA, { tokens: { primaryColor: '#aaaaaa' }, publishedBy: PUBLISHER });

    const bActive = await app.inject({
      method: 'GET',
      url: '/tenant/branding',
      headers: { 'x-tenant-id': idB },
    });
    expect(bActive.statusCode).toBe(200);
    expect(bActive.json().tokens).toBeNull();
  });

  it('A cannot roll back to a revision that belongs to B', async () => {
    // B publishes revision 1.
    await service.publishBranding(idB, { tokens: { primaryColor: '#bbbbbb' }, publishedBy: PUBLISHER });

    // A (no revisions) tries to roll back to "revision 1" — in A's scope there
    // is no revision 1, so it must 404 rather than pick up B's revision.
    const res = await app.inject({
      method: 'POST',
      url: '/tenant/branding/rollback',
      headers: { 'x-tenant-id': idA },
      payload: { revision: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('role-assignment concurrency (PRC-L591)', () => {
  it('two concurrent role adds for the same user do not lose an update', async () => {
    const repo = new InMemoryRolesRepository(SEED);
    repo.seedUsers(TENANT_A, [
      { id: 'u', tenantId: TENANT_A, email: 'u@a.test', displayName: 'U', roleIds: [], status: 'ACTIVE' },
    ]);
    const service = new RolesService(repo);
    const r1 = await service.createRole(TENANT_A, { name: 'R1', permissions: [] });
    const r2 = await service.createRole(TENANT_A, { name: 'R2', permissions: [] });

    await Promise.all([
      service.modifyUserRoles(TENANT_A, 'u', { add: [r1.id] }),
      service.modifyUserRoles(TENANT_A, 'u', { add: [r2.id] }),
    ]);

    const user = await repo.findUserById(TENANT_A, 'u');
    expect(user?.roleIds).toContain(r1.id);
    expect(user?.roleIds).toContain(r2.id);
  });
});
