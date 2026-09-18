/**
 * W1-SEC-09 — Access-token jti / sid (session) revocation.
 *
 * Local HS-JWT and Keycloak access tokens carry `jti` and `sessionId`.
 * Logout/session termination denylists both identifiers until the access token
 * expires. Production must use a shared store so revocation is consistent
 * across every gateway replica.
 */
import { DEFAULT_ACCESS_TOKEN_EXPIRES } from '@proctira/auth';

export type AccessTokenRevocationKind = 'jti' | 'sid';

/**
 * Denylist for access-token identifiers.
 * Implementations MUST throw when their backend is unavailable so callers can
 * fail closed. `shared` is an explicit production capability marker; only a
 * cluster-visible implementation may set it to true.
 */
export interface AccessTokenRevocationStore {
  readonly shared?: boolean;
  /** Mark `id` revoked for `ttlSeconds` (at least remaining access-token life). */
  revoke(kind: AccessTokenRevocationKind, id: string, ttlSeconds: number): Promise<void>;
  /** True when the identifier is currently on the denylist. */
  isRevoked(kind: AccessTokenRevocationKind, id: string): Promise<boolean>;
}

export type AccessTokenRevocationFailure = 'revoked_jti' | 'revoked_sid' | 'store_unavailable';

export type AccessTokenRevocationCheckResult =
  | { ok: true }
  | { ok: false; reason: AccessTokenRevocationFailure };

export interface AccessTokenClaimsForRevocation {
  jti?: string;
  sessionId?: string;
  /** Keycloak session id (mapped to sessionId by verify.ts; accepted as alias). */
  sid?: string;
}

export interface AssertAccessTokenNotRevokedOptions {
  store?: AccessTokenRevocationStore | null;
  /** Override NODE_ENV for tests. */
  nodeEnv?: string;
  /**
   * When true (default in production), a missing/throwing store rejects the
   * request. Dev/test may omit the store so existing unit suites stay lean.
   */
  requireStore?: boolean;
}

function isProductionEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

/**
 * Default denylist TTL: access-token lifetime (covers remaining validity of
 * any outstanding bearer issued for the session).
 */
export function defaultAccessTokenRevocationTtlSeconds(
  accessTokenExpiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRES,
): number {
  return Math.max(1, Math.trunc(accessTokenExpiresIn));
}

/**
 * Fail closed when jti or sid is on the denylist.
 * In production, a missing or unavailable store also rejects (requireStore).
 */
export async function assertAccessTokenNotRevoked(
  claims: AccessTokenClaimsForRevocation,
  opts: AssertAccessTokenNotRevokedOptions = {},
): Promise<AccessTokenRevocationCheckResult> {
  const nodeEnv = opts.nodeEnv ?? process.env['NODE_ENV'];
  const requireStore = opts.requireStore ?? isProductionEnv(nodeEnv);
  const store = opts.store;

  if (!store) {
    if (requireStore) {
      return { ok: false, reason: 'store_unavailable' };
    }
    return { ok: true };
  }

  const jti = claims.jti?.trim();
  const sid = (claims.sessionId ?? claims.sid)?.trim();

  try {
    if (jti && (await store.isRevoked('jti', jti))) {
      return { ok: false, reason: 'revoked_jti' };
    }
    if (sid && (await store.isRevoked('sid', sid))) {
      return { ok: false, reason: 'revoked_sid' };
    }
  } catch {
    return { ok: false, reason: 'store_unavailable' };
  }

  return { ok: true };
}

/**
 * Revoke both the current access-token jti and its session sid.
 * Sid revocation invalidates every outstanding access token for the session.
 */
export async function revokeAccessTokenIdentifiers(
  store: AccessTokenRevocationStore,
  claims: AccessTokenClaimsForRevocation,
  ttlSeconds: number = defaultAccessTokenRevocationTtlSeconds(),
): Promise<void> {
  const ttl = defaultAccessTokenRevocationTtlSeconds(ttlSeconds);
  const jti = claims.jti?.trim();
  const sid = (claims.sessionId ?? claims.sid)?.trim();
  if (jti) {
    await store.revoke('jti', jti, ttl);
  }
  if (sid) {
    await store.revoke('sid', sid, ttl);
  }
}

/** In-memory denylist for tests and single-process non-production use only. */
export class MemoryAccessTokenRevocationStore implements AccessTokenRevocationStore {
  readonly shared = false;
  private readonly entries = new Map<string, number>();

  revoke(kind: AccessTokenRevocationKind, id: string, ttlSeconds: number): Promise<void> {
    const key = this.key(kind, id);
    const now = Date.now();
    this.gc(now);
    this.entries.set(key, now + Math.max(1, Math.trunc(ttlSeconds)) * 1000);
    return Promise.resolve();
  }

  isRevoked(kind: AccessTokenRevocationKind, id: string): Promise<boolean> {
    const key = this.key(kind, id);
    const now = Date.now();
    this.gc(now);
    const exp = this.entries.get(key);
    return Promise.resolve(typeof exp === 'number' && exp > now);
  }

  /** Test helper. */
  clear(): void {
    this.entries.clear();
  }

  private key(kind: AccessTokenRevocationKind, id: string): string {
    return `${kind}:${id}`;
  }

  private gc(now: number): void {
    for (const [key, exp] of this.entries) {
      if (exp <= now) this.entries.delete(key);
    }
  }
}

/** Minimal Redis client surface (ioredis-compatible) for SET EX. */
export interface RedisLikeForAccessTokenRevocation {
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<string | null>;
  exists(...keys: string[]): Promise<number>;
}

/** Redis-backed access-token denylist (SET key EX ttl). */
export class RedisAccessTokenRevocationStore implements AccessTokenRevocationStore {
  readonly shared = true;

  constructor(
    private readonly redis: RedisLikeForAccessTokenRevocation,
    private readonly keyPrefix = 'auth:access-revoke:',
  ) {}

  async revoke(kind: AccessTokenRevocationKind, id: string, ttlSeconds: number): Promise<void> {
    const key = `${this.keyPrefix}${kind}:${id}`;
    await this.redis.set(key, '1', 'EX', Math.max(1, Math.trunc(ttlSeconds)));
  }

  async isRevoked(kind: AccessTokenRevocationKind, id: string): Promise<boolean> {
    const key = `${this.keyPrefix}${kind}:${id}`;
    const n = await this.redis.exists(key);
    return n > 0;
  }
}

export type AccessTokenRevocationStoreEnv = {
  /** Shared Redis client (cluster-wide denylist). */
  redis?: RedisLikeForAccessTokenRevocation;
  /** Override NODE_ENV for tests / DI. */
  NODE_ENV?: string;
};

export type AccessTokenRevocationStoreDecision =
  | { mode: 'redis'; reason: string }
  | { mode: 'memory'; reason: string };

/** True only for stores that explicitly guarantee cross-replica visibility. */
export function isSharedAccessTokenRevocationStore(store: AccessTokenRevocationStore): boolean {
  return store.shared === true;
}

/**
 * Decide whether access-token revocation uses Redis or process-local memory.
 * Production without Redis always fails startup. There is intentionally no
 * environment-variable escape hatch back to replica-local memory.
 */
export function decideAccessTokenRevocationStore(
  env: AccessTokenRevocationStoreEnv = {},
): AccessTokenRevocationStoreDecision {
  if (env.redis) {
    return { mode: 'redis', reason: 'shared redis client injected (cluster-wide)' };
  }

  const nodeEnv = env.NODE_ENV ?? process.env['NODE_ENV'];
  if (isProductionEnv(nodeEnv)) {
    throw new Error(
      'Shared access-token revocation store (REDIS_URL / redis) is required in production (W1-SEC-09).',
    );
  }

  return {
    mode: 'memory',
    reason: 'redis unset (dev/test process-local store)',
  };
}

/** Build the production-shared Redis store or the explicit non-prod memory store. */
export function createAccessTokenRevocationStore(
  env: AccessTokenRevocationStoreEnv = {},
): AccessTokenRevocationStore {
  const decision = decideAccessTokenRevocationStore(env);
  if (decision.mode === 'redis') {
    return new RedisAccessTokenRevocationStore(env.redis!);
  }
  return new MemoryAccessTokenRevocationStore();
}
