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

  /**
   * Deliberately unscoped, and it cannot be otherwise.
   *
   * This resolves a Keycloak subject to the tenant that owns it, so the tenant id
   * is the *result* of the call, not an input -- it runs before any tenant context
   * exists. The safety property here is that `externalId` is a Keycloak `sub`,
   * which is opaque and unguessable; it is not RLS, and it is not a tenant
   * predicate. Adding one would break authentication.
   *
   * Recorded rather than fixed so it is not mistaken for an oversight when the
   * scope parameter becomes mandatory.
   */
  async findIdentity(externalId: string) {
    const row = await this.identities.get(externalId);
    return row
      ? { id: row.id, userId: row.userId, tenantId: row.tenantId, email: row.email }
      : null;
  }

  async touchIdentity(id: string): Promise<void> {
    const row = await this.identities.first({ id } as Partial<IdentityDoc>);
    if (!row) return;
    await this.identities.put(row.externalId, { ...row, lastUsedAt: new Date() }, row.tenantId);
  }

  async findUserByEmail(email: string, tenantId?: string) {
    const normalized = email.trim().toLowerCase();
    if (tenantId) {
      // The key is already tenant-prefixed, so this was scoped in practice --
      // but only by string convention, enforced nowhere. Passing the scope makes
      // it a real SQL predicate, so a malformed or spoofed key cannot reach
      // another tenant's row. Verified the invariant holds in existing data: every
      // auth.keycloak_users id begins with its own tenant_id.
      const user = await this.users.get(`${tenantId}:${normalized}`, { tenantId });
      return user ? this.publicUser(user) : null;
    }
    const user = await this.users.first({ email: normalized } as Partial<UserDoc>);
    return user ? this.publicUser(user) : null;
  }

  async findTenantById(id: string): Promise<{ id: string } | null> {
    // auth.keycloak_tenants is platform-owned: every row has a NULL tenant_id
    // (verified on the evaluation database -- 6 rows, 0 with a tenant_id). Scoping
    // to `platform` adds the predicate this lookup should always have had, so a
    // tenant-owned row can never be returned here even though `(collection, id)`
    // is otherwise a global key. See SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md.
    const seeded = await this.tenants.get(id, { platform: true });
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
