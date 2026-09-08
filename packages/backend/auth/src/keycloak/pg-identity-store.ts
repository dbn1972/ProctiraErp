/**
 * Postgres Keycloak identity store (G-704) on `control_plane_documents`.
 *
 * Records the tenant membership projected from Keycloak logins so linked
 * identities survive restarts. Tenant resolution is claim-driven when the
 * tenant is unknown (matching the in-memory store) unless `strictTenants` is
 * set, in which case unknown tenant ids/slugs are rejected.
 */
import { randomUUID } from 'node:crypto';

import {
  assertInMemoryFallbackAllowed,
  getSharedPgPool,
  PgDocumentCollection,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

import { InMemoryKeycloakIdentityStore, type KeycloakIdentityStore } from './identity.js';

interface IdentityDoc {
  id: string;
  userId: string;
  tenantId: string;
  externalId: string;
  email: string;
  realm: string;
  lastUsedAt: Date;
}

interface UserDoc {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  countryCode: string;
}

interface TenantDoc {
  id: string;
  slug?: string;
}

export interface PgKeycloakIdentityStoreOptions {
  /** Reject unknown tenant ids / slugs instead of trusting the claim. */
  strictTenants?: boolean;
}

export class PgKeycloakIdentityStore implements KeycloakIdentityStore {
  private readonly identities: PgDocumentCollection<IdentityDoc>;
  private readonly users: PgDocumentCollection<UserDoc>;
  private readonly tenants: PgDocumentCollection<TenantDoc>;

  constructor(
    pool: PgPoolWithConnect | PgQueryable,
    private readonly options: PgKeycloakIdentityStoreOptions = {},
  ) {
    this.identities = new PgDocumentCollection<IdentityDoc>(pool, 'auth.keycloak_identities');
    this.users = new PgDocumentCollection<UserDoc>(pool, 'auth.keycloak_users');
    this.tenants = new PgDocumentCollection<TenantDoc>(pool, 'auth.keycloak_tenants');
  }

  async seedTenant(tenant: TenantDoc): Promise<void> {
    await this.tenants.put(tenant.id, tenant);
  }

  async findIdentity(externalId: string) {
    const row = await this.identities.get(externalId);
    return row ? { id: row.id, userId: row.userId, tenantId: row.tenantId, email: row.email } : null;
  }

  async touchIdentity(id: string): Promise<void> {
    const row = await this.identities.first({ id } as Partial<IdentityDoc>);
    if (!row) return;
    await this.identities.put(row.externalId, { ...row, lastUsedAt: new Date() }, row.tenantId);
  }

  async findUserByEmail(email: string, tenantId?: string) {
    const normalized = email.trim().toLowerCase();
    if (tenantId) {
      const user = await this.users.get(`${tenantId}:${normalized}`);
      return user ? this.publicUser(user) : null;
    }
    const user = await this.users.first({ email: normalized } as Partial<UserDoc>);
    return user ? this.publicUser(user) : null;
  }

  async findTenantById(id: string): Promise<{ id: string } | null> {
    const seeded = await this.tenants.get(id);
    if (seeded) return { id: seeded.id };
    return this.options.strictTenants ? null : { id };
  }

  async findTenantBySlug(slug: string): Promise<{ id: string } | null> {
    const seeded = await this.tenants.first({ slug } as Partial<TenantDoc>);
    if (seeded) return { id: seeded.id };
    return this.options.strictTenants ? null : { id: `slug:${slug}` };
  }

  async createUser(input: {
    tenantId: string;
    email: string;
    displayName: string;
    firstName: string;
    lastName: string;
    countryCode: string;
  }) {
    const user: UserDoc = {
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      countryCode: input.countryCode,
    };
    await this.users.put(`${user.tenantId}:${user.email}`, user, user.tenantId);
    return this.publicUser(user);
  }

  async createIdentity(input: {
    userId: string;
    tenantId: string;
    externalId: string;
    email: string;
    realm: string;
  }): Promise<void> {
    const doc: IdentityDoc = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      externalId: input.externalId,
      email: input.email.trim().toLowerCase(),
      realm: input.realm,
      lastUsedAt: new Date(),
    };
    await this.identities.put(input.externalId, doc, input.tenantId);
  }

  private publicUser(user: UserDoc) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      countryCode: user.countryCode,
    };
  }
}

/** Postgres when DATABASE_URL is set, else in-memory (refused in production). */
export function createKeycloakIdentityStore(
  options: PgKeycloakIdentityStoreOptions & { databaseUrl?: string } = {},
): KeycloakIdentityStore {
  const pool = getSharedPgPool(options.databaseUrl);
  if (pool) return new PgKeycloakIdentityStore(pool, options);
  assertInMemoryFallbackAllowed('auth-keycloak-identity');
  return new InMemoryKeycloakIdentityStore();
}
