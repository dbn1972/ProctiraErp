/**
 * PRC-M027 — dedicated, hashed SCIM provisioning credentials.
 *
 * A tenant administrator issues one long-lived SCIM bearer token for its IdP
 * (`POST /api/v1/tenant/scim-token`, shown once) and revokes it with
 * `DELETE /api/v1/tenant/scim-token`. Only `sha256(SCIM_TOKEN_PEPPER ‖ token)`
 * is stored, as a tenant-owned row of the `control_plane_documents`
 * collection `gateway.scim_tokens` whose id is the hash. Authentication looks
 * the hash up subject-first (`{ platformAdmin: true }`, the same pattern as
 * pg-identity-store `findIdentity` / pg-api-key-store `getApiKeyByHash`): the
 * owning tenant is the result of the lookup, never a request input.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { isDeployedEnvironment } from '@proctira/common/node-env';
import {
  assertInMemoryFallbackAllowed,
  getSharedPgPool,
  PgDocumentCollection,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

/** Stored SCIM token metadata (never the raw token). */
export interface ScimTokenRecord {
  tokenId: string;
  tenantId: string;
  status: 'active' | 'revoked';
  /** ISO time the token was issued (a re-issue is a rotation). */
  issuedAt: string;
  revokedAt?: string;
  createdBy: string | null;
}

/** Document stored per token; `hash` repeats the row id for a constant-time compare. */
interface ScimTokenDoc extends ScimTokenRecord {
  hash: string;
}

export interface ScimTokenStore {
  /** Resolve an active or revoked token by its peppered hash. */
  findByHash(hash: string): Promise<ScimTokenRecord | null>;
  /** Issue (or rotate) the tenant's token: previous active tokens are revoked. */
  issue(
    tenantId: string,
    createdBy: string | null,
  ): Promise<{ token: string; record: ScimTokenRecord }>;
  /** Revoke every active token of the tenant; returns how many were revoked. */
  revoke(tenantId: string): Promise<number>;
}

/** Raw SCIM tokens: `scim_` + 32 random bytes (base64url). */
export const SCIM_TOKEN_PREFIX = 'scim_';
const SCIM_TOKEN_PATTERN = /^scim_[A-Za-z0-9_-]{43}$/;
export const MIN_SCIM_TOKEN_PEPPER_LENGTH = 32;
const COLLECTION = 'gateway.scim_tokens';

export function isScimTokenShape(token: string): boolean {
  return SCIM_TOKEN_PATTERN.test(token);
}

export function hashScimToken(pepper: string, token: string): string {
  return createHash('sha256').update(pepper).update('\u0000').update(token).digest('hex');
}

function mintToken(): string {
  return `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function hashesEqual(stored: string, computed: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(computed);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicRecord(doc: ScimTokenDoc): ScimTokenRecord {
  const { hash: _hash, ...record } = doc;
  return record;
}

/** Postgres store (tenant-owned rows, FORCE RLS on control_plane_documents). */
export class PgScimTokenStore implements ScimTokenStore {
  private readonly tokens: PgDocumentCollection<ScimTokenDoc>;

  constructor(
    pool: PgPoolWithConnect | PgQueryable,
    private readonly pepper: string,
  ) {
    this.tokens = new PgDocumentCollection<ScimTokenDoc>(pool, COLLECTION, { reviveDates: false });
  }

  async findByHash(hash: string): Promise<ScimTokenRecord | null> {
    const doc = await this.tokens.get(hash, { platformAdmin: true });
    if (!doc || !hashesEqual(doc.hash, hash)) return null;
    return publicRecord(doc);
  }

  async issue(tenantId: string, createdBy: string | null) {
    await this.revoke(tenantId);
    const token = mintToken();
    const hash = hashScimToken(this.pepper, token);
    const doc: ScimTokenDoc = {
      hash,
      tokenId: randomBytes(9).toString('base64url'),
      tenantId,
      status: 'active',
      issuedAt: new Date().toISOString(),
      createdBy,
    };
    await this.tokens.insertIfAbsent(hash, doc, tenantId);
    return { token, record: publicRecord(doc) };
  }

  async revoke(tenantId: string): Promise<number> {
    const docs = await this.tokens.byTenant(tenantId);
    let revoked = 0;
    for (const doc of docs) {
      if (doc.status !== 'active' || doc.tenantId !== tenantId) continue;
      await this.tokens.put(
        doc.hash,
        { ...doc, status: 'revoked', revokedAt: new Date().toISOString() },
        tenantId,
      );
      revoked += 1;
    }
    return revoked;
  }
}

/** Process-local store for development and tests. */
export class InMemoryScimTokenStore implements ScimTokenStore {
  private readonly docs = new Map<string, ScimTokenDoc>();

  constructor(private readonly pepper: string) {}

  async findByHash(hash: string): Promise<ScimTokenRecord | null> {
    const doc = this.docs.get(hash);
    if (!doc || !hashesEqual(doc.hash, hash)) return null;
    return publicRecord(doc);
  }

  async issue(tenantId: string, createdBy: string | null, issuedAt = new Date()) {
    await this.revoke(tenantId);
    const token = mintToken();
    const hash = hashScimToken(this.pepper, token);
    const doc: ScimTokenDoc = {
      hash,
      tokenId: randomBytes(9).toString('base64url'),
      tenantId,
      status: 'active',
      issuedAt: issuedAt.toISOString(),
      createdBy,
    };
    this.docs.set(hash, doc);
    return { token, record: publicRecord(doc) };
  }

  async revoke(tenantId: string): Promise<number> {
    let revoked = 0;
    for (const [hash, doc] of this.docs) {
      if (doc.tenantId !== tenantId || doc.status !== 'active') continue;
      this.docs.set(hash, { ...doc, status: 'revoked', revokedAt: new Date().toISOString() });
      revoked += 1;
    }
    return revoked;
  }
}

/**
 * Resolve SCIM_TOKEN_PEPPER. Deployed: required (>= 32 chars, not JWT_SECRET),
 * otherwise boot is refused. Development / test: a per-process random pepper.
 */
export function resolveScimTokenPepper(processEnv: NodeJS.ProcessEnv = process.env): string {
  const pepper = processEnv['SCIM_TOKEN_PEPPER']?.trim() ?? '';
  if (!isDeployedEnvironment(processEnv['NODE_ENV'], processEnv)) {
    return pepper || randomBytes(32).toString('hex');
  }
  if (pepper.length < MIN_SCIM_TOKEN_PEPPER_LENGTH) {
    throw new Error(
      `SCIM_TOKEN_PEPPER (at least ${MIN_SCIM_TOKEN_PEPPER_LENGTH} characters, from the secret manager) is required in a deployed environment (PRC-M027)`,
    );
  }
  if (pepper === processEnv['JWT_SECRET']?.trim()) {
    throw new Error('SCIM_TOKEN_PEPPER must not reuse JWT_SECRET (PRC-M027)');
  }
  return pepper;
}

/**
 * Postgres when DATABASE_URL is set; process memory only where the shared
 * persistence policy allows it (never production).
 */
export function createScimTokenStore(pepper: string): ScimTokenStore {
  if (process.env['DATABASE_URL']?.trim()) {
    const pool = getSharedPgPool();
    if (pool) return new PgScimTokenStore(pool, pepper);
  }
  assertInMemoryFallbackAllowed('scim-tokens');
  return new InMemoryScimTokenStore(pepper);
}
