/**
 * V15-16 — the `AUDIT_UNAVAILABLE` 503 tells the truth and can be quoted.
 *
 * Three defects were reproduced before these were written, all on the one response a user
 * gets when their write landed but the audit row did not:
 *
 *  1. **No `requestId`.** The body was a frozen constant, and the `onSend` hook in
 *     `error-handler.ts` that stamps every other error envelope is registered *before* the
 *     audit hook (`app.ts:222` vs `app.ts:838`). Fastify runs onSend in registration order,
 *     so the stamping hook had already run — and seen a 2xx — by the time this payload
 *     existed. The test below reproduces that ordering directly rather than asserting it.
 *  2. **The message said the opposite of what happened.** "Refusing to acknowledge" reads as
 *     "nothing was applied". Outside the four atomic paths the handler has already committed.
 *  3. **`ERROR_CODE_REGISTRY` published `retryable: true`.** That is the published contract,
 *     served to clients by `plugins/api-contract.ts`, so it actively told integrators to
 *     repeat a write that had already succeeded.
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { ERROR_CODE_REGISTRY } from '@proctira/common';

import { errorHandlerPlugin } from './plugins/error-handler.js';
import { mutationAuditUnavailableBody } from './mutation-audit.js';

describe('V15-16 AUDIT_UNAVAILABLE body', () => {
  it('carries the request id when given one', () => {
    const body = mutationAuditUnavailableBody('req-abc-123');
    expect(body.requestId).toBe('req-abc-123');
    expect(body.code).toBe('AUDIT_UNAVAILABLE');
    expect(body.statusCode).toBe(503);
  });

  it('omits requestId rather than emitting an empty one', () => {
    expect(Object.hasOwn(mutationAuditUnavailableBody(), 'requestId')).toBe(false);
    expect(Object.hasOwn(mutationAuditUnavailableBody(''), 'requestId')).toBe(false);
  });

  it('does not claim the mutation was rejected', () => {
    const { message } = mutationAuditUnavailableBody('r1');
    // The old copy was "refusing to acknowledge security-sensitive mutation".
    expect(message).not.toMatch(/refus/i);
    expect(message).toMatch(/may have been applied/i);
    expect(message).toMatch(/do not retry/i);
  });

  it('is marked not-retryable, because the write already committed', () => {
    expect(mutationAuditUnavailableBody('r1').retryable).toBe(false);
  });

  it('agrees with the published error-code registry', () => {
    // The registry is what clients branch on. A body saying "do not retry" beside a registry
    // entry saying `retryable: true` is worse than either alone.
    const entry = ERROR_CODE_REGISTRY.find((e) => e.code === 'AUDIT_UNAVAILABLE');
    expect(entry).toBeDefined();
    expect(entry?.retryable).toBe(false);
    expect(entry?.httpStatus).toBe(mutationAuditUnavailableBody('r1').statusCode);
  });
});

describe('V15-16 why the request id must be stamped at construction', () => {
  it('reproduces the hook ordering that leaves a swapped-in 503 unstamped', async () => {
    const app = Fastify({ genReqId: () => 'req-ordering-1' });
    await app.register(errorHandlerPlugin, {});

    // Registered after errorHandlerPlugin, mirroring app.ts:838 vs app.ts:222. Returns a
    // *bare* envelope with no requestId, as the old constant did.
    app.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode !== 200) return payload;
      reply.code(503);
      reply.header('content-type', 'application/json; charset=utf-8');
      void reply.removeHeader('content-length');
      return JSON.stringify({
        code: 'AUDIT_UNAVAILABLE',
        message: 'stand-in for the pre-fix constant',
        statusCode: 503,
      });
    });

    app.post('/api/v1/fees/refunds', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/v1/fees/refunds', payload: {} });
    expect(res.statusCode).toBe(503);
    // The error-handler hook cannot rescue it: it ran first, while the status was still 200.
    expect(Object.hasOwn(res.json() as object, 'requestId')).toBe(false);
    await app.close();
  });

  it('a body built by the helper survives the same ordering', async () => {
    const app = Fastify({ genReqId: () => 'req-ordering-2' });
    await app.register(errorHandlerPlugin, {});

    app.addHook('onSend', async (request, reply, payload) => {
      if (reply.statusCode !== 200) return payload;
      reply.code(503);
      reply.header('content-type', 'application/json; charset=utf-8');
      void reply.removeHeader('content-length');
      return JSON.stringify(mutationAuditUnavailableBody(String(request.id)));
    });

    app.post('/api/v1/fees/refunds', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/v1/fees/refunds', payload: {} });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { requestId?: string }).requestId).toBe('req-ordering-2');
    // No retry invitation: the domain write is already committed.
    expect(res.headers['retry-after']).toBeUndefined();
    await app.close();
  });
});
