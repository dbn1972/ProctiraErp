import { getPrismaClient, type PrismaClient } from '@proctira/database';

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
 * Project a Keycloak login onto the local users / user_identities tables.
 * Roles and passwords stay in Keycloak; this only records tenant membership.
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

export function createPrismaKeycloakIdentityStore(
  prisma: PrismaClient = getPrismaClient(),
): KeycloakIdentityStore {
  return {
    async findIdentity(externalId) {
      const row = await prisma.userIdentity.findFirst({
        where: { provider: KEYCLOAK_PROVIDER, externalId },
      });
      return row
        ? { id: row.id, userId: row.userId, tenantId: row.tenantId, email: row.email }
        : null;
    },
    async touchIdentity(id) {
      await prisma.userIdentity.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      });
    },
    async findUserByEmail(email, tenantId) {
      const row = await prisma.user.findFirst({
        where: tenantId ? { email, tenantId } : { email },
      });
      return row
        ? {
            id: row.id,
            tenantId: row.tenantId,
            email: row.email,
            displayName: row.displayName,
            countryCode: row.countryCode,
          }
        : null;
    },
    async findTenantById(id) {
      const row = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
      return row;
    },
    async findTenantBySlug(slug) {
      const row = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
      return row;
    },
    async createUser(input) {
      const row = await prisma.user.create({
        data: {
          tenantId: input.tenantId,
          email: input.email,
          displayName: input.displayName,
          firstName: input.firstName,
          lastName: input.lastName,
          status: 'active',
          countryCode: input.countryCode,
        },
      });
      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        displayName: row.displayName,
        countryCode: row.countryCode,
      };
    },
    async createIdentity(input) {
      await prisma.userIdentity.create({
        data: {
          userId: input.userId,
          tenantId: input.tenantId,
          provider: KEYCLOAK_PROVIDER,
          externalId: input.externalId,
          email: input.email,
          realm: input.realm,
          lastUsedAt: new Date(),
        },
      });
    },
  };
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
