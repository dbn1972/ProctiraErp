import { randomUUID } from 'node:crypto';

import type { KeycloakAccessClaims } from './verify.js';

export const KEYCLOAK_PROVIDER = 'keycloak';

export class KeycloakIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeycloakIdentityError';
  }
}

export type KeycloakIdentityInput = {
  externalId: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  tenantId?: string;
  tenantSlug?: string;
  countryCode?: string;
  realm: string;
};

export type LinkedKeycloakUser = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  countryCode: string;
};

type StoredIdentity = {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
};

type StoredUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  countryCode: string;
};

export interface KeycloakIdentityStore {
  findIdentity(externalId: string): Promise<StoredIdentity | null>;
  touchIdentity(id: string): Promise<void>;
  findUserByEmail(email: string, tenantId?: string): Promise<StoredUser | null>;
  findTenantById(id: string): Promise<{ id: string } | null>;
  findTenantBySlug(slug: string): Promise<{ id: string } | null>;
  createUser(input: {
    tenantId: string;
    email: string;
    displayName: string;
    firstName: string;
    lastName: string;
    countryCode: string;
  }): Promise<StoredUser>;
  createIdentity(input: {
    userId: string;
    tenantId: string;
    externalId: string;
    email: string;
    realm: string;
  }): Promise<void>;
}

/**
 * Project a Keycloak login onto a local identity store.
 * Roles and passwords stay in Keycloak; this only records tenant membership.
 *
 * Default store is in-memory (optional Keycloak). Persistence via Prisma User /
 * UserIdentity models is intentionally not wired on main — those models are absent.
 */
export async function linkKeycloakIdentity(
  input: KeycloakIdentityInput,
  store: KeycloakIdentityStore,
): Promise<LinkedKeycloakUser> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new KeycloakIdentityError('Keycloak token is missing an email');
  }
  if (!input.externalId) {
    throw new KeycloakIdentityError('Keycloak token is missing a subject');
  }

  const existing = await store.findIdentity(input.externalId);
  if (existing) {
    await store.touchIdentity(existing.id);
    const user = await store.findUserByEmail(existing.email, existing.tenantId);
    return {
      userId: existing.userId,
      tenantId: existing.tenantId,
      email: existing.email,
      displayName: user?.displayName ?? input.displayName,
      countryCode: user?.countryCode ?? input.countryCode ?? 'IN',
    };
  }

  const tenantId = await resolveTenantId(input, store);
  const provisioned = await store.findUserByEmail(email, tenantId);
  if (provisioned) {
    await store.createIdentity({
      userId: provisioned.id,
      tenantId: provisioned.tenantId,
      externalId: input.externalId,
      email,
      realm: input.realm,
    });
    return {
      userId: provisioned.id,
      tenantId: provisioned.tenantId,
      email: provisioned.email,
      displayName: provisioned.displayName,
      countryCode: provisioned.countryCode,
    };
  }

  if (!tenantId) {
    throw new KeycloakIdentityError(
      'Keycloak user has no tenant mapping (set tenant_id or tenant_slug)',
    );
  }

  const names = splitDisplayName(input);
  const created = await store.createUser({
    tenantId,
    email,
    displayName: input.displayName || email,
    firstName: names.firstName,
    lastName: names.lastName,
    countryCode: (input.countryCode ?? 'IN').toUpperCase(),
  });
  await store.createIdentity({
    userId: created.id,
    tenantId: created.tenantId,
    externalId: input.externalId,
    email,
    realm: input.realm,
  });
  return {
    userId: created.id,
    tenantId: created.tenantId,
    email: created.email,
    displayName: created.displayName,
    countryCode: created.countryCode,
  };
}

export function identityInputFromClaims(
  claims: KeycloakAccessClaims,
  realm: string,
): KeycloakIdentityInput {
  const displayName =
    claims.name ??
    [claims.given_name, claims.family_name].filter(Boolean).join(' ') ??
    claims.preferred_username ??
    claims.email ??
    claims.sub;

  return {
    externalId: claims.sub || claims.preferred_username || claims.email || '',
    email: claims.email ?? claims.preferred_username ?? '',
    displayName,
    firstName: claims.given_name,
    lastName: claims.family_name,
    tenantId: firstAttribute(claims.tenant_id ?? claims.tenantId),
    tenantSlug: firstAttribute(claims.tenant_slug ?? claims.tenantSlug),
    countryCode: firstAttribute(claims.country) ?? 'IN',
    realm,
  };
}

/**
 * Ephemeral identity store for optional Keycloak without Prisma User models.
 * Tenant id/slug claims are trusted (claim-driven); seed via seedTenant for tests.
 */
export class InMemoryKeycloakIdentityStore implements KeycloakIdentityStore {
  private readonly identitiesByExternalId = new Map<
    string,
    StoredIdentity & { lastUsedAt?: Date }
  >();
  private readonly usersByKey = new Map<string, StoredUser>();
  private readonly tenantsById = new Map<string, { id: string; slug?: string }>();

  seedTenant(tenant: { id: string; slug?: string }): void {
    this.tenantsById.set(tenant.id, tenant);
    if (tenant.slug) {
      this.tenantsById.set(`slug:${tenant.slug}`, tenant);
    }
  }

  async findIdentity(externalId: string): Promise<StoredIdentity | null> {
    const row = this.identitiesByExternalId.get(externalId);
    return row
      ? { id: row.id, userId: row.userId, tenantId: row.tenantId, email: row.email }
      : null;
  }

  async touchIdentity(id: string): Promise<void> {
    for (const [key, row] of this.identitiesByExternalId) {
      if (row.id === id) {
        this.identitiesByExternalId.set(key, { ...row, lastUsedAt: new Date() });
        return;
      }
    }
  }

  async findUserByEmail(email: string, tenantId?: string): Promise<StoredUser | null> {
    const normalized = email.trim().toLowerCase();
    if (tenantId) {
      return this.usersByKey.get(`${tenantId}:${normalized}`) ?? null;
    }
    for (const user of this.usersByKey.values()) {
      if (user.email === normalized) return { ...user };
    }
    return null;
  }

  async findTenantById(id: string): Promise<{ id: string } | null> {
    const seeded = this.tenantsById.get(id);
    if (seeded) return { id: seeded.id };
    // Claim-driven: accept unknown tenant UUIDs so Keycloak can bootstrap without DB.
    return { id };
  }

  async findTenantBySlug(slug: string): Promise<{ id: string } | null> {
    const seeded = this.tenantsById.get(`slug:${slug}`);
    if (seeded) return { id: seeded.id };
    for (const tenant of this.tenantsById.values()) {
      if (tenant.slug === slug) return { id: tenant.id };
    }
    // Claim-driven ephemeral mapping (not a durable tenant UUID).
    return { id: `slug:${slug}` };
  }

  async createUser(input: {
    tenantId: string;
    email: string;
    displayName: string;
    firstName: string;
    lastName: string;
    countryCode: string;
  }): Promise<StoredUser> {
    const user: StoredUser = {
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      countryCode: input.countryCode,
    };
    this.usersByKey.set(`${user.tenantId}:${user.email}`, user);
    return { ...user };
  }

  async createIdentity(input: {
    userId: string;
    tenantId: string;
    externalId: string;
    email: string;
    realm: string;
  }): Promise<void> {
    this.identitiesByExternalId.set(input.externalId, {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
      lastUsedAt: new Date(),
    });
  }
}

async function resolveTenantId(
  input: KeycloakIdentityInput,
  store: KeycloakIdentityStore,
): Promise<string | undefined> {
  if (input.tenantId) {
    const tenant = await store.findTenantById(input.tenantId);
    if (!tenant) {
      throw new KeycloakIdentityError(`Unknown tenant_id in Keycloak token: ${input.tenantId}`);
    }
    return tenant.id;
  }
  if (input.tenantSlug) {
    const tenant = await store.findTenantBySlug(input.tenantSlug);
    if (!tenant) {
      throw new KeycloakIdentityError(`Unknown tenant_slug in Keycloak token: ${input.tenantSlug}`);
    }
    return tenant.id;
  }
  return undefined;
}

function splitDisplayName(input: KeycloakIdentityInput): { firstName: string; lastName: string } {
  if (input.firstName || input.lastName) {
    return {
      firstName: input.firstName || input.displayName || 'User',
      lastName: input.lastName || 'Account',
    };
  }
  const parts = input.displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? 'User',
    lastName: parts.slice(1).join(' ') || 'Account',
  };
}

function firstAttribute(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
