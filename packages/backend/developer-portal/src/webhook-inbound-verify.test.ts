/**
 * W1-SEC-08 — inbound verify route wired to replay store (not library-only).
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import {
  MemoryWebhookReplayStore,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  createWebhookSignatureHeaders,
} from './webhook-signature.js';

describe('W1-SEC-08 inbound webhook verify route', () => {
  const secret = 'whsec_inbound_route_test';
  let app: ReturnType<typeof Fastify>;
  let store: MemoryWebhookReplayStore;

  beforeEach(async () => {
    store = new MemoryWebhookReplayStore();
    app = Fastify({ logger: false });
    await app.register(developerPortalPlugin, {
      repository: new InMemoryDeveloperPortalRepository(),
      replayStore: store,
      prefix: '/developer',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a freshly signed payload via POST /developer/webhooks/verify', async () => {
    const payload = JSON.stringify({ id: 'evt-1', event: 'student.created' });
    const signed = createWebhookSignatureHeaders(payload, secret);

    const res = await app.inject({
      method: 'POST',
      url: '/developer/webhooks/verify',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signed.signature,
        [WEBHOOK_TIMESTAMP_HEADER]: signed.timestamp,
        [WEBHOOK_NONCE_HEADER]: signed.nonce,
      },
      payload: { payload, secret },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects nonce replay with 409', async () => {
    const payload = JSON.stringify({ id: 'evt-2', event: 'student.updated' });
    const signed = createWebhookSignatureHeaders(payload, secret);
    const headers = {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signed.signature,
      [WEBHOOK_TIMESTAMP_HEADER]: signed.timestamp,
      [WEBHOOK_NONCE_HEADER]: signed.nonce,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/developer/webhooks/verify',
      headers,
      payload: { payload, secret },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/developer/webhooks/verify',
      headers,
      payload: { payload, secret },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ ok: false, reason: 'replay' });
  });

  it('fails closed with 503 when replay store is missing', async () => {
    await app.close();
    app = Fastify({ logger: false });
    await app.register(developerPortalPlugin, {
      repository: new InMemoryDeveloperPortalRepository(),
      replayStore: null,
      prefix: '/developer',
    });
    await app.ready();

    const payload = JSON.stringify({ id: 'evt-3' });
    const signed = createWebhookSignatureHeaders(payload, secret);
    const res = await app.inject({
      method: 'POST',
      url: '/developer/webhooks/verify',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signed.signature,
        [WEBHOOK_TIMESTAMP_HEADER]: signed.timestamp,
        [WEBHOOK_NONCE_HEADER]: signed.nonce,
      },
      payload: { payload, secret },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      ok: false,
      reason: 'replay_store_unavailable',
    });
  });

  it('self-test proves sign → accept → replay on the HTTP path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/developer/webhooks/verify-self-test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      first: { ok: true },
      second: { ok: false, reason: 'replay' },
    });
  });
});
