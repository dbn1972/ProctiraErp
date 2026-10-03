/**
 * PRC-H099: provisioner flow — roles/settings seeding, Keycloak admin creation
 * (fail closed when unconfigured) and all-or-nothing rollback.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { InMemoryRolesRepository } from './in-memory-roles-repository.js';
import type { CreateTenantInput } from './schemas.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import {
  KeycloakTenantAdminProvisioner,
  RolesAndSettingsSeeder,
  TenantAdminProvisioningNotConfiguredError,
  loadKeycloakAdminConfig,
  type ProvisionerFetch,
} from './tenant-provisioner.js';
import { TenantService } from './tenant-service.js';
import { InMemoryTenantSettingsStore } from './tenant-settings.js';

const input: CreateTenantInput = {
  name: 'District B',
  slug: 'district-b',
  admin: {
    firstName: 'Ravi',
    lastName: 'Admin',
    email: 'admin@district-b.example',
    password: 'Correct-Horse-9',
  },
};

const SEED = [
  { roleId: 'admin', roleName: 'Admin', permissions: [{ resource: '*', action: 'manage' as const }] },
];

function seeder() {
  const roles = new InMemoryRolesRepository(SEED);
  const settings = new InMemoryTenantSettingsStore();
  return { roles, settings, seeder: new RolesAndSettingsSeeder(roles, settings) };
}

describe('PRC-H099 tenant provisioner flow', () => {
  it('seeds roles + settings, provisions the admin, then activates', async () => {
    const { roles, settings, seeder: s } = seeder();
    const service = new TenantService(
      new InMemoryTenantRepository(),
      undefined,
      new RecordingAdminProvisioner(),
      s,
    );
    const tenant = await service.createTenant(input);
    expect(tenant.status).toBe('active');
    expect((await roles.listRoles(tenant.id)).map((r) => r.roleId)).toEqual(['admin']);
    expect((await settings.get(tenant.id))?.displayName).toBe('District B');
  });

  it('rolls back seeded defaults and the tenant when admin provisioning fails', async () => {
    const { settings, seeder: s } = seeder();
    const repository = new InMemoryTenantRepository();
    const service = new TenantService(
      repository,
      undefined,
      new RecordingAdminProvisioner(new Error('idp down')),
      s,
    );
    await expect(service.createTenant(input)).rejects.toMatchObject({ statusCode: 422 });
    expect(await repository.findTenantBySlug('district-b')).toBeNull();
    expect((await repository.listTenants({}, { page: 1, pageSize: 10 })).data).toHaveLength(0);
    // Settings record of the discarded tenant is not left active (slug retry works).
    const retry = new TenantService(repository, undefined, new RecordingAdminProvisioner(), s);
    await expect(retry.createTenant(input)).resolves.toMatchObject({ status: 'active' });
    expect(settings).toBeDefined();
  });

  it('Keycloak provisioner fails closed when not configured', async () => {
    expect(loadKeycloakAdminConfig({})).toBeUndefined();
    const kc = KeycloakTenantAdminProvisioner.fromEnv({});
    expect(kc.configured).toBe(false);
    await expect(
      kc.provisionTenantAdmin({ tenantId: 't', slug: 's', name: 'n', admin: input.admin }),
    ).rejects.toBeInstanceOf(TenantAdminProvisioningNotConfiguredError);
    // Through TenantService the tenant is rolled back.
    const repository = new InMemoryTenantRepository();
    const service = new TenantService(repository, undefined, kc);
    await expect(service.createTenant(input)).rejects.toMatchObject({ statusCode: 422 });
    expect(await repository.findTenantBySlug('district-b')).toBeNull();
  });

  it('Keycloak provisioner creates a tenant-bound user with a temporary password', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl: ProvisionerFetch = async (url, init) => {
      calls.push({ url, body: init.body });
      if (url.endsWith('/token')) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ access_token: 'svc-token' }),
        };
      }
      return {
        status: 201,
        ok: true,
        headers: { get: (n) => (n === 'location' ? `${url}/kc-user-1` : null) },
        json: async () => ({}),
      };
    };
    const config = loadKeycloakAdminConfig({
      KEYCLOAK_ADMIN_URL: 'https://id.example.com/',
      KEYCLOAK_ADMIN_CLIENT_ID: 'provisioner',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'not-a-real-secret',
    });
    const kc = new KeycloakTenantAdminProvisioner(config, fetchImpl);
    const out = await kc.provisionTenantAdmin({
      tenantId: 'tenant-1',
      slug: 'district-b',
      name: 'District B',
      admin: input.admin,
    });
    expect(out.adminUserId).toBe('kc-user-1');
    expect(calls[1]!.url).toBe('https://id.example.com/admin/realms/proctira/users');
    const body = JSON.parse(calls[1]!.body!);
    expect(body.attributes.tenant_id).toEqual(['tenant-1']);
    expect(body.credentials[0]).toMatchObject({ type: 'password', temporary: true });
  });

  it('Keycloak 409 reuses only a user bound to the same tenant', async () => {
    const fetchImpl: ProvisionerFetch = async (url, init) => {
      if (url.endsWith('/token')) {
        return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ access_token: 't' }) };
      }
      if (init.method === 'POST') {
        return { status: 409, ok: false, headers: { get: () => null }, json: async () => ({}) };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => [{ id: 'other', attributes: { tenant_id: ['tenant-x'] } }],
      };
    };
    const kc = new KeycloakTenantAdminProvisioner(
      { baseUrl: 'https://id', realm: 'r', clientId: 'c', clientSecret: 's' },
      fetchImpl,
    );
    await expect(
      kc.provisionTenantAdmin({ tenantId: 'tenant-1', slug: 's', name: 'n', admin: input.admin }),
    ).rejects.toThrow(/another tenant/);
  });
});
