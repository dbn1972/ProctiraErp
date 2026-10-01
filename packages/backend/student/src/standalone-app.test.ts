/**
 * PRC-L502 — standalone student service: unauthenticated -> 401, tenant from
 * the verified token only, /ready fails when the DB is down, and production
 * refuses to construct StudentService without the legal-hold gate.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStudentRepository } from './in-memory-repository.js';
import { buildStandaloneStudentApp } from './standalone-app.js';
import { verifyHs256Jwt } from './standalone-auth.js';
import { StudentService } from './student-service.js';

delete process.env['DATABASE_URL'];

const SECRET = 'standalone-test-secret-0123456789abcdef';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

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
const registrar = (tenantId = TENANT_A) =>
  sign({ sub: 'u1', tenantId, roles: ['registrar'], exp: exp() });

describe('standalone student service (PRC-L502)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(dbUp = true) {
    app = await buildStandaloneStudentApp({
      repository: new InMemoryStudentRepository(),
      jwt: { secret: SECRET },
      readiness: {
        env: { NODE_ENV: 'test', DATABASE_URL: 'postgres://x' } as never,
        probeDatabase: async () => (dbUp ? { ok: true } : { ok: false, message: 'down' }),
      },
    });
    await app.ready();
    return app;
  }

  it('unauthenticated request -> 401', async () => {
    const a = await boot();
    const res = await a.inject({ method: 'GET', url: '/students' });
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
      url: '/students',
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid token -> 200; tenant comes from the token, not x-tenant-id', async () => {
    const a = await boot();
    const created = await a.inject({
      method: 'POST',
      url: '/students',
      headers: { authorization: `Bearer ${registrar(TENANT_A)}` },
      payload: { firstName: 'A', lastName: 'B', dateOfBirth: '2010-01-01', gender: 'male' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    // Tenant B token + spoofed tenant A header cannot read tenant A's student.
    const foreign = await a.inject({
      method: 'GET',
      url: `/students/${id}`,
      headers: { authorization: `Bearer ${registrar(TENANT_B)}`, 'x-tenant-id': TENANT_A },
    });
    expect(foreign.statusCode).toBe(404);
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
      buildStandaloneStudentApp({
        repository: new InMemoryStudentRepository(),
        jwt: { secret: '' },
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

describe('StudentService legal-hold gate in production (PRC-L502)', () => {
  const original = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = original;
  });
  it('throws without assertDestructiveDeleteAllowed when NODE_ENV=production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => new StudentService(new InMemoryStudentRepository())).toThrow(/legal-hold/);
    expect(
      () => new StudentService(new InMemoryStudentRepository(), undefined, async () => undefined),
    ).not.toThrow();
  });
});
