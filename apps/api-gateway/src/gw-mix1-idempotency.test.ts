/**
 * PRC-M010 / PRC-M020 — gateway-level Idempotency-Key behaviour through buildApp:
 * replay happens after RBAC and keys are partitioned per principal.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';

delete process.env['DATABASE_URL'];

describe('gateway idempotency scoping (PRC-M010)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const student = (lastName: string) => ({
    firstName: 'Ada',
    lastName,
    dateOfBirth: '2010-01-01',
  });
  const create = (sub: string, roles: string[], key: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { ...authHeaders(app, { sub, roles }), 'idempotency-key': key },
      payload: body as Record<string, unknown>,
    });

  it('replays only for the same principal and request', async () => {
    const first = await create('admin-a', ['admin'], 'gw-key-1', student('One'));
    expect([401, 403, 429]).not.toContain(first.statusCode);
    const replay = await create('admin-a', ['admin'], 'gw-key-1', student('One'));
    expect(replay.headers['x-idempotency-replay']).toBe('true');
    expect(replay.body).toBe(first.body);

    // Another admin with the same key executes fresh — never sees A's body.
    const other = await create('admin-b', ['admin'], 'gw-key-1', student('One'));
    expect(other.headers['x-idempotency-replay']).toBeUndefined();

    // Same principal + key, different body → 422.
    const reused = await create('admin-a', ['admin'], 'gw-key-1', student('Two'));
    expect(reused.statusCode).toBe(422);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a caller RBAC denies gets 403 even when presenting a cached key (and 403 is not cached)', async () => {
    const first = await create('admin-c', ['admin'], 'gw-key-2', student('Three'));
    expect([401, 403, 429]).not.toContain(first.statusCode);
    const denied = await create('parent-c', ['parent'], 'gw-key-2', student('Three'));
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['x-idempotency-replay']).toBeUndefined();
  });
});
