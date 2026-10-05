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
  /**
   * True only when the IdP asserted `email_verified === true` for the `email`
   * claim. Email-based linking/provisioning is refused otherwise (PRC-H042).
   */
  emailVerified?: boolean;
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
  /** Tenant scope is mandatory: email lookup never crosses tenants (PRC-H042). */
  findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null>;
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
    // PRC-L283: lastUsedAt is telemetry; write it at most once per interval per
    // identity and never block (or fail) the request on it.
    if (shouldTouchIdentity(existing.id)) {
      void Promise.resolve()
        .then(() => store.touchIdentity(existing.id))
        .catch(() => undefined);
    }
    const user = await store.findUserByEmail(existing.email, existing.tenantId);
    return {
      userId: existing.userId,
      tenantId: existing.tenantId,
      email: existing.email,
      displayName: user?.displayName ?? input.displayName,
      countryCode: user?.countryCode ?? input.countryCode ?? 'IN',
    };
  }

  // PRC-H042: first-login linking is email based, so it must fail closed.
  // An unverified email would let anyone who registers the victim's address in
  // Keycloak take over the provisioned account, and a tenantless token must never
  // search every tenant for a matching email.
  if (input.emailVerified !== true) {
    throw new KeycloakIdentityError(
      'Keycloak email is not verified; refusing to link or provision an account',
    );
  }
  const tenantId = await resolveTenantId(input, store);
  if (!tenantId) {
    throw new KeycloakIdentityError(
      'Keycloak user has no tenant mapping (set tenant_id or tenant_slug)',
    );
  }
  const provisioned = await store.findUserByEmail(email, tenantId);
  if (provisioned && provisioned.tenantId === tenantId) {
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

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TOUCH_ENTRIES = 50_000;
const lastTouchedAt = new Map<string, number>();

function shouldTouchIdentity(id: string, now = Date.now()): boolean {
  const last = lastTouchedAt.get(id);
  if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return false;
  lastTouchedAt.delete(id);
  lastTouchedAt.set(id, now);
  while (lastTouchedAt.size > MAX_TOUCH_ENTRIES) {
    const oldest = lastTouchedAt.keys().next().value;
    if (oldest === undefined) break;
    lastTouchedAt.delete(oldest);
  }
  return true;
}

/**
 * PRC-L283: per-session cache of the linked identity so an authenticated request does not read
 * the identity store (findIdentity + findUserByEmail) every time. Keyed by the verified token's
 * session id *and* subject, bounded in size and age; only successful links are cached, so a
 * store outage still fails closed. Session revocation is enforced separately on every request.
 */
export interface SessionIdentityCache {
  get(sessionId: string, externalId: string): LinkedKeycloakUser | undefined;
  set(sessionId: string, externalId: string, user: LinkedKeycloakUser): void;
  /** Drop a session (e.g. on logout). */
  delete(sessionId: string, externalId: string): void;
  readonly size: number;
}

export function createSessionIdentityCache(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): SessionIdentityCache {
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 50_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { user: LinkedKeycloakUser; expiresAt: number }>();
  const keyOf = (sessionId: string, externalId: string) => `${sessionId}\u0000${externalId}`;
  return {
    get(sessionId, externalId) {
      const key = keyOf(sessionId, externalId);
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return { ...hit.user };
    },
    set(sessionId, externalId, user) {
      if (ttlMs <= 0) return;
      const key = keyOf(sessionId, externalId);
      entries.delete(key);
      entries.set(key, { user: { ...user }, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(sessionId, externalId) {
      entries.delete(keyOf(sessionId, externalId));
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * {@link linkKeycloakIdentity} behind a {@link SessionIdentityCache}. Tokens without a session id
 * are linked every time (never cached under a shared key).
 */
export async function linkKeycloakIdentityForSession(
  input: KeycloakIdentityInput,
  store: KeycloakIdentityStore,
  cache: SessionIdentityCache | undefined,
  sessionId: string | undefined,
): Promise<LinkedKeycloakUser> {
  if (!cache || !sessionId || !input.externalId) return linkKeycloakIdentity(input, store);
  const hit = cache.get(sessionId, input.externalId);
  if (hit) return hit;
  const linked = await linkKeycloakIdentity(input, store);
  cache.set(sessionId, input.externalId, linked);
  return linked;
}

/** Test hook: forget touch throttling state. */
export function resetIdentityTouchThrottleForTests(): void {
  lastTouchedAt.clear();
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
    // Only an explicit IdP assertion on a real `email` claim counts as verified.
    emailVerified: Boolean(claims.email) && claims.email_verified === true,
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

  async findUserByEmail(email: string, tenantId: string): Promise<StoredUser | null> {
    if (!tenantId) return null;
    const normalized = email.trim().toLowerCase();
    const user = this.usersByKey.get(`${tenantId}:${normalized}`);
    return user ? { ...user } : null;
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
    const key = `${user.tenantId}:${user.email}`;
    const existing = this.usersByKey.get(key);
    if (existing) return { ...existing };
    this.usersByKey.set(key, user);
    return { ...user };
  }

  async createIdentity(input: {
    userId: string;
    tenantId: string;
    externalId: string;
    email: string;
    realm: string;
  }): Promise<void> {
    if (this.identitiesByExternalId.has(input.externalId)) return;
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
