/**
 * PRC-M027 — per-subject session revocation for SCIM deprovisioning.
 *
 * The SCIM directory record and the login identity are linked by
 * (tenant id, lower-cased email): the directory's `userName` is the email, and
 * both Keycloak and local access tokens carry `tenantId` and `email`.
 *
 * Deprovisioning a user records `{ revokedAt, suspended: true }` for that
 * subject. While suspended, every token for the subject is refused (including
 * tokens minted later by a refresh). Reprovisioning clears `suspended` but keeps
 * `revokedAt`, so tokens issued before the deprovision stay dead and the user
 * signs in again. Production must use the shared Redis store so every replica
 * sees the entry. Implementations MUST throw when their backend is unavailable
 * so callers can fail closed.
 */
import { DEFAULT_TENANT_SESSION_REVOCATION_TTL_SECONDS } from './tenant-session-revocation.js';

export interface SubjectRevocationEntry {
  /** Epoch seconds of the latest deprovision. */
  revokedAt: number;
  /** True while the directory record is deprovisioned. */
  suspended: boolean;
}

export interface SubjectSessionRevocationStore {
  readonly shared?: boolean;
  /** Deprovision: refuse every token of the subject until restored. */
  revokeSubject(
    tenantId: string,
    email: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void>;
  /** Reprovision: lift the suspension; tokens issued before `revokedAt` stay revoked. */
  restoreSubject(tenantId: string, email: string, ttlSeconds: number): Promise<void>;
  subjectRevocation(tenantId: string, email: string): Promise<SubjectRevocationEntry | null>;
}

/** Marker lifetime: the refresh-token maximum lifetime (30 days). */
export const DEFAULT_SUBJECT_REVOCATION_TTL_SECONDS = DEFAULT_TENANT_SESSION_REVOCATION_TTL_SECONDS;

/** Link key between a SCIM directory record and a login identity. */
export function subjectRevocationKey(tenantId: string, email: string): string {
  return `${tenantId}:${email.trim().toLowerCase()}`;
}

/** True when a token issued at `issuedAtSeconds` must be refused for this subject. */
export function isSubjectTokenRevoked(
  issuedAtSeconds: number | undefined,
  entry: SubjectRevocationEntry | null,
): boolean {
  if (!entry) return false;
  if (entry.suspended) return true;
  // A token without iat cannot prove it was issued after the deprovision.
  if (typeof issuedAtSeconds !== 'number' || !Number.isFinite(issuedAtSeconds)) return true;
  return issuedAtSeconds <= entry.revokedAt;
}

function parseEntry(raw: string | null): SubjectRevocationEntry | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<SubjectRevocationEntry>;
    if (typeof value.revokedAt !== 'number' || !Number.isFinite(value.revokedAt)) return null;
    return { revokedAt: value.revokedAt, suspended: value.suspended === true };
  } catch {
    return null;
  }
}

/** Process-local store for tests and single-process non-production use only. */
export class MemorySubjectSessionRevocationStore implements SubjectSessionRevocationStore {
  readonly shared = false;
  private readonly entries = new Map<
    string,
    { entry: SubjectRevocationEntry; expiresAt: number }
  >();

  revokeSubject(
    tenantId: string,
    email: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void> {
    const key = subjectRevocationKey(tenantId, email);
    const previous = this.read(key);
    this.entries.set(key, {
      entry: {
        revokedAt: Math.max(Math.trunc(revokedAtSeconds), previous?.revokedAt ?? 0),
        suspended: true,
      },
      expiresAt: Date.now() + Math.max(1, Math.trunc(ttlSeconds)) * 1000,
    });
    return Promise.resolve();
  }

  restoreSubject(tenantId: string, email: string, ttlSeconds: number): Promise<void> {
    const key = subjectRevocationKey(tenantId, email);
    const previous = this.read(key);
    if (previous) {
      this.entries.set(key, {
        entry: { revokedAt: previous.revokedAt, suspended: false },
        expiresAt: Date.now() + Math.max(1, Math.trunc(ttlSeconds)) * 1000,
      });
    }
    return Promise.resolve();
  }

  subjectRevocation(tenantId: string, email: string): Promise<SubjectRevocationEntry | null> {
    return Promise.resolve(this.read(subjectRevocationKey(tenantId, email)));
  }

  private read(key: string): SubjectRevocationEntry | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return hit.entry;
  }
}

/** Minimal Redis client surface (ioredis-compatible). */
export interface RedisLikeForSubjectRevocation {
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

/** Redis-backed subject entries (`SET key <json> EX ttl`), shared across replicas. */
export class RedisSubjectSessionRevocationStore implements SubjectSessionRevocationStore {
  readonly shared = true;

  constructor(
    private readonly redis: RedisLikeForSubjectRevocation,
    private readonly keyPrefix = 'auth:subject-revoke:',
  ) {}

  private key(tenantId: string, email: string): string {
    return `${this.keyPrefix}${subjectRevocationKey(tenantId, email)}`;
  }

  async revokeSubject(
    tenantId: string,
    email: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void> {
    const key = this.key(tenantId, email);
    const previous = parseEntry(await this.redis.get(key));
    const entry: SubjectRevocationEntry = {
      revokedAt: Math.max(Math.trunc(revokedAtSeconds), previous?.revokedAt ?? 0),
      suspended: true,
    };
    await this.redis.set(key, JSON.stringify(entry), 'EX', Math.max(1, Math.trunc(ttlSeconds)));
  }

  async restoreSubject(tenantId: string, email: string, ttlSeconds: number): Promise<void> {
    const key = this.key(tenantId, email);
    const previous = parseEntry(await this.redis.get(key));
    if (!previous) return;
    const entry: SubjectRevocationEntry = { revokedAt: previous.revokedAt, suspended: false };
    await this.redis.set(key, JSON.stringify(entry), 'EX', Math.max(1, Math.trunc(ttlSeconds)));
  }

  async subjectRevocation(tenantId: string, email: string): Promise<SubjectRevocationEntry | null> {
    return parseEntry(await this.redis.get(this.key(tenantId, email)));
  }
}

/**
 * Shared Redis store when a client is available; process-local memory otherwise. Production
 * without Redis refuses to start (same contract as the tenant revocation store, PRC-H008).
 */
export function createSubjectSessionRevocationStore(
  env: { redis?: RedisLikeForSubjectRevocation; NODE_ENV?: string } = {},
): SubjectSessionRevocationStore {
  if (env.redis) return new RedisSubjectSessionRevocationStore(env.redis);
  const nodeEnv = (env.NODE_ENV ?? process.env['NODE_ENV'] ?? '').toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error(
      'Shared subject session revocation store (REDIS_URL / redis) is required in production (PRC-M027).',
    );
  }
  return new MemorySubjectSessionRevocationStore();
}
