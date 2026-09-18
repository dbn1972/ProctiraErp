/**
 * W1-SEC-08 — Webhook HMAC with timestamp skew + nonce replay protection.
 *
 * Signed material: `${timestamp}.${nonce}.${payload}`
 * Headers (outbound):
 *   x-proctira-signature  sha256=<hex>
 *   x-proctira-timestamp  unix seconds
 *   x-proctira-nonce      32-byte hex
 *
 * Verification is fail-closed in production when a replay store is required
 * but missing or unavailable.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Default clock-skew tolerance (5 minutes). */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Header names for Proctira outbound webhooks. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-proctira-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-proctira-timestamp';
export const WEBHOOK_NONCE_HEADER = 'x-proctira-nonce';

/**
 * Durable (or in-process) nonce claim store.
 * `claim` must be atomic: first claim → true; duplicate → false.
 * Implementations MUST throw when the backend is unavailable so callers
 * can fail closed in production.
 */
export interface WebhookReplayStore {
  claim(nonce: string, ttlSeconds: number): Promise<boolean>;
}

export interface WebhookSignatureParts {
  signature: string;
  timestamp: string;
  nonce: string;
}

export interface WebhookSignedHeaders extends WebhookSignatureParts {
  headers: Record<string, string>;
}

export type WebhookVerifyFailureReason =
  | 'malformed'
  | 'expired'
  | 'replay'
  | 'bad_signature'
  | 'replay_store_unavailable';

export type WebhookVerifyResult = { ok: true } | { ok: false; reason: WebhookVerifyFailureReason };

export interface VerifyWebhookSignatureOptions {
  payload: string;
  secret: string;
  signature: string;
  timestamp: string | number;
  nonce: string;
  /** Epoch ms override for tests. */
  nowMs?: number;
  /** Skew window in seconds (default {@link WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS}). */
  toleranceSeconds?: number;
  /** Nonce replay cache; required in production unless allowMissingReplayStore. */
  replayStore?: WebhookReplayStore;
  /** Override NODE_ENV for tests. */
  nodeEnv?: string;
  /**
   * Escape hatch for local unit tests that only assert HMAC/skew.
   * Never set in production callers.
   */
  allowMissingReplayStore?: boolean;
}

/** Canonical string covered by the HMAC. */
export function buildWebhookSignedPayload(
  timestamp: string | number,
  nonce: string,
  payload: string,
): string {
  return `${String(timestamp)}.${nonce}.${payload}`;
}

/**
 * Generate HMAC-SHA256 signature for a webhook payload.
 * Format: `sha256=<hex>` over `${timestamp}.${nonce}.${payload}`.
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  opts: { timestamp: string | number; nonce: string },
): string {
  const material = buildWebhookSignedPayload(opts.timestamp, opts.nonce, payload);
  const digest = createHmac('sha256', secret).update(material, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Mint timestamp + nonce and sign the payload (outbound delivery helper).
 */
export function createWebhookSignatureHeaders(
  payload: string,
  secret: string,
  opts?: { nowMs?: number; nonce?: string },
): WebhookSignedHeaders {
  const timestamp = String(Math.floor((opts?.nowMs ?? Date.now()) / 1000));
  const nonce = opts?.nonce ?? randomBytes(32).toString('hex');
  const signature = generateWebhookSignature(payload, secret, { timestamp, nonce });
  return {
    signature,
    timestamp,
    nonce,
    headers: {
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_NONCE_HEADER]: nonce,
    },
  };
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Sync HMAC-only check (no skew / replay). Prefer
 * {@link verifyWebhookSignatureSecure} for receivers.
 */
export function verifyWebhookSignature(
  payload: string,
  secret: string,
  signature: string,
  opts: { timestamp: string | number; nonce: string },
): boolean {
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) {
    return false;
  }
  if (typeof opts.nonce !== 'string' || opts.nonce.length < 16) {
    return false;
  }
  const expected = generateWebhookSignature(payload, secret, opts);
  return timingSafeEqualUtf8(expected, signature);
}

function parseUnixSeconds(raw: string | number): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return Math.trunc(raw);
  }
  if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isProductionEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

/**
 * Verify webhook authenticity with timestamp skew + nonce replay protection.
 * Fail-closed in production when the replay store is missing or throws.
 */
export async function verifyWebhookSignatureSecure(
  options: VerifyWebhookSignatureOptions,
): Promise<WebhookVerifyResult> {
  const {
    payload,
    secret,
    signature,
    timestamp,
    nonce,
    nowMs = Date.now(),
    toleranceSeconds = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
    replayStore,
    nodeEnv,
    allowMissingReplayStore = false,
  } = options;

  const ts = parseUnixSeconds(timestamp);
  if (ts === null || typeof nonce !== 'string' || nonce.length < 16) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) {
    return { ok: false, reason: 'malformed' };
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - ts) > toleranceSeconds) {
    return { ok: false, reason: 'expired' };
  }

  if (!verifyWebhookSignature(payload, secret, signature, { timestamp: ts, nonce })) {
    return { ok: false, reason: 'bad_signature' };
  }

  const prod = isProductionEnv(nodeEnv);
  if (!replayStore) {
    if (prod || !allowMissingReplayStore) {
      return { ok: false, reason: 'replay_store_unavailable' };
    }
    return { ok: true };
  }

  const ttl = Math.max(toleranceSeconds * 2, toleranceSeconds + 60);
  let claimed: boolean;
  try {
    claimed = await replayStore.claim(nonce, ttl);
  } catch {
    return { ok: false, reason: 'replay_store_unavailable' };
  }
  if (!claimed) {
    return { ok: false, reason: 'replay' };
  }

  return { ok: true };
}

/**
 * In-memory nonce store for tests and single-process non-prod use.
 * Not durable across replicas — use {@link RedisWebhookReplayStore} in prod.
 */
export class MemoryWebhookReplayStore implements WebhookReplayStore {
  private readonly seen = new Map<string, number>();

  async claim(nonce: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    this.gc(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + ttlSeconds * 1000);
    return true;
  }

  /** Test helper — force-expire all entries. */
  clear(): void {
    this.seen.clear();
  }

  private gc(now: number): void {
    for (const [key, exp] of this.seen) {
      if (exp <= now) this.seen.delete(key);
    }
  }
}

/**
 * Minimal Redis client surface (ioredis-compatible) for SET NX EX.
 */
export interface RedisLikeForReplay {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    existenceMode: 'NX',
  ): Promise<string | null>;
}

/**
 * Redis-backed nonce replay cache (SET key NX EX ttl).
 * Throws on Redis errors so verification fails closed.
 */
export class RedisWebhookReplayStore implements WebhookReplayStore {
  constructor(
    private readonly redis: RedisLikeForReplay,
    private readonly keyPrefix = 'webhook:nonce:',
  ) {}

  async claim(nonce: string, ttlSeconds: number): Promise<boolean> {
    const key = `${this.keyPrefix}${nonce}`;
    const result = await this.redis.set(key, '1', 'EX', Math.max(1, Math.trunc(ttlSeconds)), 'NX');
    return result === 'OK';
  }
}

/**
 * Build a replay store from env / DI.
 * - Injected `redis` → {@link RedisWebhookReplayStore}
 * - Production without redis → `null` (callers fail closed)
 * - Non-production → {@link MemoryWebhookReplayStore} (single-process only)
 */
export function createWebhookReplayStoreFromEnv(env: {
  NODE_ENV?: string;
  /** Injected Redis client (production / multi-replica). */
  redis?: RedisLikeForReplay;
}): WebhookReplayStore | null {
  if (env.redis) {
    return new RedisWebhookReplayStore(env.redis);
  }
  if (isProductionEnv(env.NODE_ENV)) {
    return null;
  }
  return new MemoryWebhookReplayStore();
}
