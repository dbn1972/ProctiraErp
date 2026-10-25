/**
 * PRC-M621 — standalone examination service: unauthenticated -> 401, tenant
 * from the verified token only, and /ready fails when the DB is down.
 * Mirrors the assertions in packages/backend/student/src/standalone-app.test.ts
 * and packages/backend/assessment/src/standalone-app.test.ts for the same
 * server shape.
 */
import { createHmac } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { buildStandaloneExaminationApp } from './standalone-app.js';
import { verifyHs256Jwt } from './standalone-auth.js';

delete process.env['DATABASE_URL'];

const SECRET = 'standalone-test-secret-0123456789abcdef';
const TENANT_A = '11111111-1111-4111-8111-111111111111';

function b64url(v: unknown): string {
  return Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
}
function sign(claims: Record<string, unknown>, opts: { alg?: string; secret?: string } = {}) {
  const h = b64url({ alg: opts.alg ?? 'HS256', typ: 'JWT' });
  const p = b64url(claims);
  const sig = createHmac('sha256', opts.secret ?? SECRET)
    .update(`${h}.${p}`)
    .digest('base64url');
  return `${h}.${p}.${sig}`;
}
const exp = () => Math.floor(Date.now() / 1000) + 600;
const officer = (tenantId = TENANT_A) =>
  sign({ sub: 'u1', tenantId, roles: ['examinations_officer'], exp: exp() });

describe('standalone examination service (PRC-M621)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(dbUp = true) {
    app = await buildStandaloneExaminationApp({
      jwt: { secret: SECRET },
      repositories: {
        repository: new InMemoryExaminationRepository(),
        resultRepository: new InMemoryResultRepository(),
        documentRepository: new InMemoryDocumentRepository(),
      },
      readiness: {
        env: { NODE_ENV: 'test', DATABASE_URL: 'postgres://x' } as never,
        probeDatabase: async () => (dbUp ? { ok: true } : { ok: false, message: 'down' }),
      },
    });
    await app.ready();
    return app;
  }

  it('unauthenticated request to a domain route -> 401', async () => {
    const a = await boot();
    const res = await a.inject({ method: 'GET', url: '/examinations' });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['alg none', () => sign({ sub: 'u', tenantId: TENANT_A, exp: exp() }, { alg: 'none' })],
    [
      'wrong secret',
      () => sign({ sub: 'u', tenantId: TENANT_A, exp: exp() }, { secret: 'x'.repeat(40) }),
    ],
    ['expired', () => sign({ sub: 'u', tenantId: TENANT_A, exp: 1 })],
    ['no tenant', () => sign({ sub: 'u', exp: exp() })],
  ])('%s token -> 401', async (_label, token) => {
    const a = await boot();
    const res = await a.inject({
      method: 'GET',
      url: '/examinations',
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid token -> request reaches the domain route (tenant from the token)', async () => {
    const a = await boot();
    const res = await a.inject({
      method: 'GET',
      url: '/examinations',
      headers: { authorization: `Bearer ${officer(TENANT_A)}` },
    });
    // Authenticated and authorized for exam.read.staff: no longer a 401.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });

  it('/ready -> 503 when DB is down, 200 when up; /health stays public', async () => {
    const down = await boot(false);
    expect((await down.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
    expect((await down.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await down.close();
    app = undefined;
    const up = await boot(true);
    expect((await up.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('refuses to start without a strong JWT secret', async () => {
    await expect(
      buildStandaloneExaminationApp({
        jwt: { secret: '' },
        repositories: {
          repository: new InMemoryExaminationRepository(),
          resultRepository: new InMemoryResultRepository(),
          documentRepository: new InMemoryDocumentRepository(),
        },
      }),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('verifyHs256Jwt enforces issuer/audience when configured', () => {
    const t = sign({ sub: 'u', tenantId: TENANT_A, exp: exp(), iss: 'a', aud: 'b' });
    expect(verifyHs256Jwt(t, { secret: SECRET, issuer: 'a', audience: 'b' })).not.toBeNull();
    expect(verifyHs256Jwt(t, { secret: SECRET, issuer: 'other' })).toBeNull();
    expect(verifyHs256Jwt(t, { secret: SECRET, audience: 'other' })).toBeNull();
  });
});
