/**
 * Idempotency-Key Plugin
 *
 * Implements idempotency support for POST/PUT/PATCH requests to prevent
 * duplicate operations when the offline-first Sync_Queue replays requests.
 *
 * Behavior:
 * - Reads the `Idempotency-Key` header on POST/PUT/PATCH requests
 * - Stores the response for a given key in Redis with a configurable TTL (default 24h)
 * - If the same key is seen again, returns the cached response without re-executing the handler
 * - Returns 409 Conflict if the key is currently in-flight (concurrent duplicate request)
 * - GET/DELETE/OPTIONS/HEAD requests are not subject to idempotency checks
 * - W1-ARCH-03: when Redis is required, store failures return 503 — never silent memory
 * - W1-ARCH-03: if Redis fails while saving a completed 2xx response after mutation,
 *   rewrite to 503 (IDEMPOTENCY_REPLAY_PENDING) and leave a durable
 *   completed-without-body marker so retries do not re-execute. Never return bare 2xx
 *   when the idempotency record was not durably saved.
 *
 * Redis key structure:
 *   idempotency:{tenantId}:{userSub}:{key} → JSON { statusCode, headers, body, fingerprint }
 *     or { status: "completed_without_body", originalStatusCode?, fingerprint? }
 *   idempotency:{tenantId}:{userSub}:{key}:lock → request fingerprint (SET NX EX; refreshed
 *     while the handler runs, capped at maxLockHoldSeconds)
 * - PRC-M010: replay happens in preHandler (after auth/RBAC/rate limit); a key
 *   reused for a different method/path/body returns 422 IDEMPOTENCY_KEY_REUSED.
 * - PRC-M020: only 2xx and deterministic 4xx (400/404/409/410/422) are cached.
 */

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { assertIdempotencyRedisClient, type IdempotencyStoreMode } from './idempotency-store.js';

/**
 * Options for the idempotency plugin.
 */
export interface IdempotencyOptions {
  /** TTL for cached responses in seconds (default: 86400 = 24 hours) */
  ttlSeconds?: number;
  /** TTL for the in-flight lock in seconds (default: 60) */
  lockTtlSeconds?: number;
  /**
   * Longest a still-running handler keeps the in-flight lock alive by
   * refreshing it, in seconds (default: 10 × lockTtlSeconds). After this the
   * refresh stops and the lock lapses one TTL later, so a hung handler cannot
   * pin its key at 409 forever.
   */
  maxLockHoldSeconds?: number;
  /** Header name for the idempotency key (default: 'idempotency-key') */
  headerName?: string;
  /**
   * Store mode (W1-ARCH-03). Defaults to `redis` when `redis` is provided,
   * otherwise `memory`. Redis mode never falls back to memory.
   */
  storeMode?: IdempotencyStoreMode;
  /** Redis client instance — required when storeMode is `redis` */
  redis?: RedisClient;
  /** Paths to exclude from idempotency checks */
  excludePaths?: string[];
  /**
   * PRC-M010: when true, requests without a resolved tenant AND authenticated
   * principal bypass idempotency entirely (no replay, no caching) instead of
   * sharing a `global` / anonymous key space. The gateway sets this.
   */
  requireScope?: boolean;
}

/**
 * Minimal Redis client interface for the idempotency plugin.
 * Compatible with ioredis and node-redis.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
}

/**
 * Process-local `RedisClient` for explicit `IDEMPOTENCY_STORE=memory` (dev/test).
 *
 * Honours `EX <seconds>` so cached responses and in-flight locks expire the
 * same way they do in Redis. Entries are bounded by `maxEntries` (oldest
 * evicted first). Single-process only: replays across gateway replicas are
 * not deduplicated — the plugin logs this at startup. Never used as a silent
 * fallback when Redis is required (W1-ARCH-03).
 */
export class InMemoryIdempotencyStore implements RedisClient {
  private readonly entries = new Map<string, { value: string; expiresAt: number | null }>();

  constructor(private readonly maxEntries = 10_000) {}

  private purge(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    let expiresAt: number | null = null;
    let onlyIfAbsent = false;
    for (let i = 0; i < args.length; i += 1) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'EX') {
        const seconds = Number(args[i + 1]);
        if (Number.isFinite(seconds) && seconds > 0) expiresAt = Date.now() + seconds * 1000;
      } else if (flag === 'NX') {
        onlyIfAbsent = true;
      }
    }
    const now = Date.now();
    // PRC-M019: SET ... NX semantics (Redis returns null when the key exists).
    if (onlyIfAbsent) {
      const existing = this.entries.get(key);
      if (existing && (existing.expiresAt === null || existing.expiresAt > now)) return null;
    }
    if (this.entries.size >= this.maxEntries) {
      this.purge(now);
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let removed = 0;
    for (const k of keys) {
      if (this.entries.delete(k)) removed += 1;
    }
    return removed;
  }

  /** Test helper. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Cached response stored in Redis.
 */
interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  /** PRC-M010: SHA-256 of method + path + body of the request that produced it. */
  fingerprint?: string;
}

/**
 * Durable marker when mutation completed but the full response body could not
 * be persisted. Retries must not re-execute; they receive 503 replay-pending.
 */
interface CompletedWithoutBodyRecord {
  status: 'completed_without_body';
  originalStatusCode?: number;
  fingerprint?: string;
}

/**
 * PRC-M020: only cache outcomes that are deterministic for the same request.
 * 401/403/408/423/429 (and every 5xx) depend on time, credentials or role
 * grants; caching them for 24h would poison legitimate retries.
 */
const CACHEABLE_CLIENT_ERRORS = new Set([400, 404, 409, 410, 422]);
export function isCacheableIdempotentStatus(statusCode: number): boolean {
  return (statusCode >= 200 && statusCode < 300) || CACHEABLE_CLIENT_ERRORS.has(statusCode);
}

type IdempotencyRequestState = {
  key: string;
  cacheKey: string;
  lockKey: string;
  fingerprint: string;
  refreshTimer?: ReturnType<typeof setInterval>;
};

const STATE = Symbol('proctira.idempotency');

function stateOf(request: FastifyRequest): IdempotencyRequestState | undefined {
  return (request as unknown as { [STATE]?: IdempotencyRequestState })[STATE];
}

function stopRefresh(state: IdempotencyRequestState | undefined): void {
  if (state?.refreshTimer) {
    clearInterval(state.refreshTimer);
    delete state.refreshTimer;
  }
}

/** Default cap on in-flight lock refreshes, as a multiple of the lock TTL. */
export const DEFAULT_LOCK_MAX_HOLD_TTLS = 10;

/**
 * PRC-M019: keep an in-flight lock alive while a slow handler runs, refreshing
 * every TTL/2 so it never lapses mid-mutation. Refreshes stop once
 * `maxHoldSeconds` of refreshing has elapsed: a handler that never completes
 * (e.g. a hung upstream) must not hold its key forever. `onCapped` runs once
 * when the cap is hit.
 */
export function startLockRefresh(input: {
  redis: Pick<RedisClient, 'set'>;
  lockKey: string;
  fingerprint: string;
  lockTtlSeconds: number;
  maxHoldSeconds: number;
  onError?: (err: unknown) => void;
  onCapped?: () => void;
}): ReturnType<typeof setInterval> {
  const refreshMs = Math.max(1000, Math.floor((input.lockTtlSeconds * 1000) / 2));
  const maxRefreshes = Math.max(1, Math.floor((input.maxHoldSeconds * 1000) / refreshMs));
  let refreshes = 0;
  const timer = setInterval(() => {
    if (refreshes >= maxRefreshes) {
      clearInterval(timer);
      input.onCapped?.();
      return;
    }
    refreshes += 1;
    input.redis
      .set(input.lockKey, input.fingerprint, 'EX', input.lockTtlSeconds)
      .catch((err: unknown) => input.onError?.(err));
  }, refreshMs);
  timer.unref?.();
  return timer;
}

/** Stable JSON (sorted object keys) so semantically equal bodies hash equally. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function idempotencyFingerprint(method: string, url: string, body: unknown): string {
  const [path = '', query = ''] = url.split('?');
  const normalizedQuery = query ? new URLSearchParams(query) : undefined;
  normalizedQuery?.sort();
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path.replace(/\/+$/, '') || '/'}\n`)
    .update(`${normalizedQuery?.toString() ?? ''}\n`)
    .update(stableStringify(body))
    .digest('hex');
}

function keyReusedReply(reply: FastifyReply) {
  return reply.status(422).send({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Idempotency-Key was already used for a different request',
    statusCode: 422,
  });
}

/** HTTP methods that support idempotency */
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function isCompletedWithoutBody(value: unknown): value is CompletedWithoutBodyRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CompletedWithoutBodyRecord).status === 'completed_without_body'
  );
}

function isCachedResponse(value: unknown): value is CachedResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as CachedResponse;
  return typeof record.statusCode === 'number' && typeof record.body === 'string';
}

function storeUnavailableReply(reply: FastifyReply) {
  return reply.status(503).send({
    code: 'IDEMPOTENCY_STORE_UNAVAILABLE',
    message: 'Idempotency store temporarily unavailable',
    statusCode: 503,
  });
}

function replayPendingBody() {
  return {
    code: 'IDEMPOTENCY_REPLAY_PENDING',
    message:
      'Idempotency-Key replay pending — prior mutation may have completed but the response was not durably recorded',
    statusCode: 503,
  };
}

function replayPendingReply(reply: FastifyReply) {
  reply.header('retry-after', '5');
  return reply.status(503).send(replayPendingBody());
}

const idempotencyPluginImpl: FastifyPluginAsync<IdempotencyOptions> = async (
  fastify: FastifyInstance,
  options: IdempotencyOptions = {},
) => {
  const {
    ttlSeconds = 86400, // 24 hours
    lockTtlSeconds = 60, // 1 minute lock for in-flight requests
    maxLockHoldSeconds = lockTtlSeconds * DEFAULT_LOCK_MAX_HOLD_TTLS,
    headerName = 'idempotency-key',
    excludePaths = [],
  } = options;

  const storeMode: IdempotencyStoreMode = options.storeMode ?? (options.redis ? 'redis' : 'memory');

  // W1-ARCH-03: redis mode must never silently construct an in-memory store.
  if (storeMode === 'redis') {
    assertIdempotencyRedisClient(storeMode, options.redis);
  }

  const redis: RedisClient =
    storeMode === 'memory' ? (options.redis ?? new InMemoryIdempotencyStore()) : options.redis!;

  if (storeMode === 'memory' && !options.redis) {
    fastify.log.warn(
      'Idempotency plugin using in-memory store (single-process only; set REDIS_URL and IDEMPOTENCY_STORE=redis for multi-replica deduplication)',
    );
  }

  // PRC-M010: replay runs in preHandler — after authentication, tenant
  // resolution, the RBAC / mutating-authz / scope onRequest gates, body parsing
  // and the preHandler rate limiter — so a cached body is never served to a
  // caller those gates would have rejected. Keys are partitioned by tenant AND
  // principal, and each entry carries a request fingerprint.
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply to write methods
    if (!IDEMPOTENT_METHODS.has(request.method)) return;

    // Check excluded paths
    const url = request.url.split('?')[0]!;
    const isExcluded = excludePaths.some((excluded) => {
      if (excluded.endsWith('/*')) {
        return url.startsWith(excluded.slice(0, -2));
      }
      return url === excluded;
    });
    if (isExcluded) return;

    // Read the idempotency key header
    const idempotencyKey = request.headers[headerName] as string | undefined;
    if (!idempotencyKey) return; // No key provided — proceed normally

    const tenantId = (request as unknown as { tenantId?: string }).tenantId || undefined;
    const principal = (request as unknown as { user?: { sub?: string } }).user?.sub || undefined;
    if (options.requireScope && (!tenantId || !principal)) {
      // Never share a `global` / anonymous replay space between callers.
      request.log.debug({ url }, 'idempotency skipped: no tenant/principal scope');
      return;
    }

    const cacheKey = `idempotency:${tenantId ?? 'global'}:${principal ?? 'anon'}:${idempotencyKey}`;
    const lockKey = `${cacheKey}:lock`;
    const fingerprint = idempotencyFingerprint(request.method, request.url, request.body);

    try {
      // Check if there's already a cached response or durable completion marker
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        const storedFingerprint = (parsed as { fingerprint?: unknown } | null)?.fingerprint;
        if (typeof storedFingerprint === 'string' && storedFingerprint !== fingerprint) {
          return keyReusedReply(reply);
        }
        if (isCompletedWithoutBody(parsed)) {
          // Mutation already completed without a durable body — do not re-execute.
          reply.header('x-idempotency-replay', 'pending');
          return replayPendingReply(reply);
        }
        if (!isCachedResponse(parsed)) {
          request.log.error(
            { cacheKey },
            'idempotency cache entry unreadable — treating as store unavailable',
          );
          return storeUnavailableReply(reply);
        }
        // Return the cached response without executing the handler
        reply.header('x-idempotency-replay', 'true');
        for (const [key, value] of Object.entries(parsed.headers ?? {})) {
          reply.header(key, value);
        }
        return reply.status(parsed.statusCode).send(JSON.parse(parsed.body));
      }

      // PRC-M019: atomic SET NX is the sole lock acquisition — no get-then-set race.
      const acquired = await redis.set(lockKey, fingerprint, 'EX', lockTtlSeconds, 'NX');
      if (acquired !== 'OK') {
        const holder = await redis.get(lockKey).catch(() => null);
        if (holder && holder !== 'processing' && holder !== fingerprint) {
          return keyReusedReply(reply);
        }
        return reply.status(409).send({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'A request with this Idempotency-Key is already being processed',
          statusCode: 409,
        });
      }
    } catch (err) {
      if (storeMode === 'redis') {
        request.log.error({ err }, 'idempotency store unavailable (fail-closed)');
        return storeUnavailableReply(reply);
      }
      throw err;
    }

    const state: IdempotencyRequestState = { key: idempotencyKey, cacheKey, lockKey, fingerprint };
    // PRC-M019: keep the lock alive while a slow handler is still running so the
    // TTL can never lapse mid-mutation and admit a second execution — but only
    // up to maxLockHoldSeconds, so a hung handler cannot hold the key forever.
    state.refreshTimer = startLockRefresh({
      redis,
      lockKey,
      fingerprint,
      lockTtlSeconds,
      maxHoldSeconds: maxLockHoldSeconds,
      onError: (err) => request.log.warn({ err }, 'idempotency lock refresh failed'),
      onCapped: () =>
        request.log.warn(
          { url, maxLockHoldSeconds },
          'idempotency lock refresh cap reached; lock will lapse after its TTL',
        ),
    });
    (request as unknown as { [STATE]?: IdempotencyRequestState })[STATE] = state;
  });

  fastify.addHook('onResponse', async (request: FastifyRequest) => {
    stopRefresh(stateOf(request));
  });

  // Hook: onSend — cache the response for future replays
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const state = stateOf(request);
      if (!state) return payload;
      stopRefresh(state);
      const { cacheKey, lockKey, fingerprint } = state;

      const statusCode = reply.statusCode;

      try {
        // PRC-M020: cache only 2xx and deterministic client errors. 5xx, 401,
        // 403, 408, 423 and 429 release the lock so a later retry executes.
        if (!isCacheableIdempotentStatus(statusCode)) {
          await redis.del(lockKey);
          return payload;
        }

        // Serialize the response for caching
        const responseBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const headersToCache: Record<string, string> = {};

        // Cache select response headers
        const rawHeaders = reply.getHeaders();
        for (const [key, value] of Object.entries(rawHeaders)) {
          if (key.startsWith('x-') || key === 'content-type' || key === 'location') {
            if (value !== undefined) {
              headersToCache[key] = String(value);
            }
          }
        }

        const cachedResponse: CachedResponse = {
          statusCode,
          headers: headersToCache,
          body: responseBody,
          fingerprint,
        };

        // Store in Redis with TTL — this is the durability gate for 2xx.
        await redis.set(cacheKey, JSON.stringify(cachedResponse), 'EX', ttlSeconds);
      } catch (err) {
        if (storeMode !== 'redis') {
          throw err;
        }

        request.log.error(
          { err },
          'idempotency store write failed after mutation (fail-closed, no memory fallback)',
        );

        // 5xx / non-cacheable: never mark as completed — allow retry after lock TTL.
        if (!isCacheableIdempotentStatus(statusCode)) {
          return payload;
        }

        // 4xx: mutation typically did not apply — release lock best-effort and keep body.
        if (statusCode >= 400 && statusCode < 500) {
          try {
            await redis.del(lockKey);
          } catch (lockErr) {
            request.log.error(
              { err: lockErr },
              'idempotency lock release failed after 4xx cache miss',
            );
          }
          return payload;
        }

        // 2xx: must not return bare success without a durable replay record.
        // Prefer a completed-without-body marker so retries do not re-execute.
        let markerSaved = false;
        try {
          const marker: CompletedWithoutBodyRecord = {
            status: 'completed_without_body',
            originalStatusCode: statusCode,
            fingerprint,
          };
          await redis.set(cacheKey, JSON.stringify(marker), 'EX', ttlSeconds);
          markerSaved = true;
          try {
            await redis.del(lockKey);
          } catch (lockErr) {
            request.log.error(
              { err: lockErr },
              'idempotency lock release failed after completed-without-body marker',
            );
          }
        } catch (markerErr) {
          request.log.error(
            { err: markerErr },
            'idempotency completed-without-body marker failed — retaining in-flight lock',
          );
          // Best-effort lock refresh so retries hit 409 while Redis recovers.
          try {
            await redis.set(lockKey, fingerprint, 'EX', lockTtlSeconds);
          } catch {
            // ignore — Redis may still be down
          }
        }

        reply.code(503);
        reply.header('retry-after', '5');
        reply.header('x-idempotency-replay', markerSaved ? 'pending' : 'unsaved');
        reply.removeHeader('content-length');
        return JSON.stringify(replayPendingBody());
      }

      // Durable response saved — release lock best-effort; do not rewrite 2xx if del fails.
      try {
        await redis.del(lockKey);
      } catch (lockErr) {
        if (storeMode === 'redis') {
          request.log.error(
            { err: lockErr },
            'idempotency lock release failed after durable cache write',
          );
        } else {
          throw lockErr;
        }
      }

      return payload;
    },
  );

  // Hook: onError — release the lock if the handler throws
  fastify.addHook('onError', async (request: FastifyRequest) => {
    const state = stateOf(request);
    stopRefresh(state);
    const lockKey = state?.lockKey;
    if (lockKey) {
      try {
        await redis.del(lockKey);
      } catch (err) {
        if (storeMode === 'redis') {
          request.log.error({ err }, 'idempotency lock release failed');
          return;
        }
        throw err;
      }
    }
  });
};

/**
 * Fastify plugin that provides Idempotency-Key support for write operations.
 * Prevents duplicate processing when the offline-first Sync_Queue replays requests.
 */
export const idempotencyPlugin = fp(idempotencyPluginImpl, {
  name: '@proctira/idempotency',
  fastify: '5.x',
});

export default idempotencyPlugin;
