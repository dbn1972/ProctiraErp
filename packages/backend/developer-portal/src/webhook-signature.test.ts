/**
 * W1-SEC-08 — webhook timestamp skew + nonce replay protection.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  createWebhookSignatureHeaders,
  createWebhookReplayStoreFromEnv,
  MemoryWebhookReplayStore,
  RedisWebhookReplayStore,
  verifyWebhookSignatureSecure,
  type RedisLikeForReplay,
} from './webhook-signature.js';

describe('webhook signature replay protection (W1-SEC-08)', () => {
  const secret = 'whsec_replay_test_secret';
  const payload = JSON.stringify({ id: 'del-1', event: 'student.created', payload: {} });
  let store: MemoryWebhookReplayStore;

  beforeEach(() => {
    store = new MemoryWebhookReplayStore();
  });

  it('accepts a freshly signed delivery within the tolerance window', async () => {
    const nowMs = 1_700_000_000_000;
    const signed = createWebhookSignatureHeaders(payload, secret, { nowMs });
    const result = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs,
      replayStore: store,
      nodeEnv: 'test',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects expired signatures outside the skew window', async () => {
    const signedAtMs = 1_700_000_000_000;
    const signed = createWebhookSignatureHeaders(payload, secret, { nowMs: signedAtMs });
    const tooLateMs =
      signedAtMs + (WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1) * 1000;
    const result = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs: tooLateMs,
      replayStore: store,
      nodeEnv: 'test',
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects replayed signatures that reuse the same nonce', async () => {
    const nowMs = 1_700_000_000_000;
    const signed = createWebhookSignatureHeaders(payload, secret, { nowMs });
    const first = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs,
      replayStore: store,
      nodeEnv: 'test',
    });
    expect(first).toEqual({ ok: true });

    const replay = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs,
      replayStore: store,
      nodeEnv: 'test',
    });
    expect(replay).toEqual({ ok: false, reason: 'replay' });
  });

  it('fail-closed in production when replay store is missing', async () => {
    const nowMs = 1_700_000_000_000;
    const signed = createWebhookSignatureHeaders(payload, secret, { nowMs });
    const result = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs,
      nodeEnv: 'production',
    });
    expect(result).toEqual({ ok: false, reason: 'replay_store_unavailable' });
  });

  it('fail-closed when replay store throws (unavailable)', async () => {
    const nowMs = 1_700_000_000_000;
    const signed = createWebhookSignatureHeaders(payload, secret, { nowMs });
    const failingStore = {
      claim: async () => {
        throw new Error('redis down');
      },
    };
    const result = await verifyWebhookSignatureSecure({
      payload,
      secret,
      signature: signed.signature,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      nowMs,
      replayStore: failingStore,
      nodeEnv: 'production',
    });
    expect(result).toEqual({ ok: false, reason: 'replay_store_unavailable' });
  });

  it('RedisWebhookReplayStore claims with SET NX EX and detects replay', async () => {
    const keys = new Map<string, string>();
    const redis: RedisLikeForReplay = {
      async set(key, value, ...args) {
        const nx = args.includes('NX');
        if (nx && keys.has(key)) return null;
        keys.set(key, value);
        return 'OK';
      },
    };
    const redisStore = new RedisWebhookReplayStore(redis);
    expect(await redisStore.claim('nonce-a', 600)).toBe(true);
    expect(await redisStore.claim('nonce-a', 600)).toBe(false);
    expect(await redisStore.claim('nonce-b', 600)).toBe(true);
  });

  it('createWebhookReplayStoreFromEnv returns null in production without redis', () => {
    expect(createWebhookReplayStoreFromEnv({ NODE_ENV: 'production' })).toBeNull();
    expect(createWebhookReplayStoreFromEnv({ NODE_ENV: 'test' })).toBeInstanceOf(
      MemoryWebhookReplayStore,
    );
  });

  it('emits signature, timestamp, and nonce headers for outbound delivery', () => {
    const signed = createWebhookSignatureHeaders(payload, secret);
    expect(signed.headers['x-proctira-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signed.headers['x-proctira-timestamp']).toMatch(/^\d+$/);
    expect(signed.headers['x-proctira-nonce']).toMatch(/^[0-9a-f]{64}$/);
  });
});
