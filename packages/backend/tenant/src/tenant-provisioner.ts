/**
 * PRC-H099: tenant provisioning building blocks.
 *
 * - RolesAndSettingsSeeder seeds the built-in roles and default settings for a
 *   new tenant (and removes them again on rollback).
 * - KeycloakTenantAdminProvisioner creates the initial admin in Keycloak via
 *   the admin REST API (decision: keep admin.password, temporary credential).
 *   When the admin API is not configured it fails closed: every provisioning
 *   attempt throws, so TenantService rolls the tenant back.
 */
import type { RolesRepository } from './roles-repository.js';
import type { TenantAdminProvisioner, TenantAdminProvisioningRequest } from './tenant-service.js';
import {
  DEFAULT_TENANT_SETTINGS,
  type TenantSettingsRecord,
  type TenantSettingsStore,
} from './tenant-settings.js';

/** Seeds per-tenant defaults during createTenant (idempotent per tenant). */
export interface TenantDefaultsSeeder {
  seedTenantDefaults(tenant: { id: string; name: string; slug: string }): Promise<void>;
  /** Best-effort removal on provisioning rollback. */
  removeTenantDefaults?(tenantId: string): Promise<void>;
}

export class RolesAndSettingsSeeder implements TenantDefaultsSeeder {
  constructor(
    private readonly roles: Pick<RolesRepository, 'listRoles' | 'deleteRole'>,
    private readonly settings: TenantSettingsStore,
  ) {}

  async seedTenantDefaults(tenant: { id: string; name: string }): Promise<void> {
    // listRoles materialises the built-in DEFAULT_ROLES for the tenant.
    const roles = await this.roles.listRoles(tenant.id);
    if (roles.length === 0) throw new Error('role seeding produced no roles');
    if (!(await this.settings.get(tenant.id))) {
      const record: TenantSettingsRecord = {
        ...DEFAULT_TENANT_SETTINGS,
        displayName: tenant.name,
        tenantId: tenant.id,
        updatedAt: new Date().toISOString(),
        updatedBy: 'tenant-provisioner',
      };
      await this.settings.put(record);
    }
  }

  async removeTenantDefaults(tenantId: string): Promise<void> {
    for (const role of await this.roles.listRoles(tenantId)) {
      await this.roles.deleteRole(tenantId, role.id);
    }
  }
}

export interface KeycloakAdminConfig {
  /** Keycloak base URL, e.g. https://id.example.com */
  baseUrl: string;
  realm: string;
  /** Service-account client with realm-management manage-users. */
  clientId: string;
  clientSecret: string;
}

/** Reads KEYCLOAK_ADMIN_URL / KEYCLOAK_REALM / KEYCLOAK_ADMIN_CLIENT_ID / _SECRET. */
export function loadKeycloakAdminConfig(
  env: Record<string, string | undefined> = process.env,
): KeycloakAdminConfig | undefined {
  const baseUrl = env['KEYCLOAK_ADMIN_URL']?.trim();
  const clientId = env['KEYCLOAK_ADMIN_CLIENT_ID']?.trim();
  const clientSecret = env['KEYCLOAK_ADMIN_CLIENT_SECRET'];
  if (!baseUrl || !clientId || !clientSecret) return undefined;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    realm: env['KEYCLOAK_REALM']?.trim() || 'proctira',
    clientId,
    clientSecret,
  };
}

export type ProvisionerFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export class TenantAdminProvisioningNotConfiguredError extends Error {}

export class KeycloakTenantAdminProvisioner implements TenantAdminProvisioner {
  constructor(
    private readonly config: KeycloakAdminConfig | undefined,
    private readonly fetchImpl: ProvisionerFetch = fetch as unknown as ProvisionerFetch,
  ) {}

  static fromEnv(env?: Record<string, string | undefined>): KeycloakTenantAdminProvisioner {
    return new KeycloakTenantAdminProvisioner(loadKeycloakAdminConfig(env));
  }

  get configured(): boolean {
    return this.config !== undefined;
  }

  async provisionTenantAdmin(
    request: TenantAdminProvisioningRequest,
  ): Promise<{ adminUserId: string }> {
    const config = this.config;
    if (!config) {
      throw new TenantAdminProvisioningNotConfiguredError(
        'Keycloak admin API is not configured (KEYCLOAK_ADMIN_URL / KEYCLOAK_ADMIN_CLIENT_ID / KEYCLOAK_ADMIN_CLIENT_SECRET)',
      );
    }
    const token = await this.serviceToken(config);
    const usersUrl = `${config.baseUrl}/admin/realms/${encodeURIComponent(config.realm)}/users`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const res = await this.fetchImpl(usersUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: request.admin.email,
        email: request.admin.email,
        firstName: request.admin.firstName,
        lastName: request.admin.lastName,
        enabled: true,
        emailVerified: false,
        attributes: { tenant_id: [request.tenantId] },
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [{ type: 'password', value: request.admin.password, temporary: true }],
      }),
    });
    if (res.status === 201) {
      const location = res.headers.get('location') ?? '';
      const id = location.split('/').pop();
      if (!id) throw new Error('Keycloak did not return the created user id');
      return { adminUserId: id };
    }
    if (res.status === 409) {
      // Idempotent retry: reuse only a user already bound to this tenant.
      const lookup = await this.fetchImpl(
        `${usersUrl}?email=${encodeURIComponent(request.admin.email)}&exact=true`,
        { method: 'GET', headers },
      );
      const users = (lookup.ok ? await lookup.json() : []) as Array<{
        id?: string;
        attributes?: Record<string, string[]>;
      }>;
      const match = users.find((u) => u.attributes?.['tenant_id']?.includes(request.tenantId));
      if (match?.id) return { adminUserId: match.id };
      throw new Error('Admin email already exists in the identity provider for another tenant');
    }
    throw new Error(`Keycloak admin user creation failed (HTTP ${res.status})`);
  }

  private async serviceToken(config: KeycloakAdminConfig): Promise<string> {
    const res = await this.fetchImpl(
      `${config.baseUrl}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      },
    );
    const body = (res.ok ? await res.json() : {}) as { access_token?: string };
    if (!body.access_token) {
      throw new Error(`Keycloak service-account token request failed (HTTP ${res.status})`);
    }
    return body.access_token;
  }
}
