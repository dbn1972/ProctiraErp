/**
 * UATENV-D36 (T3-N4): auth sign-in and refresh events never reached the audit
 * trail. `operationFor()` returned UPDATE for login/ticket/refresh with null
 * before/after values, which AuditService rejects ("Invalid audit input"), and
 * events without a tenant UUID used the string `'platform'`, which the uuid
 * `audit_log_entries.tenant_id` column (FK to tenants) rejects.
 *
 * The sink here is the real AuditService over the in-memory repository, with
 * the Postgres column rule (tenant must be a UUID) applied in front of it.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { AuditService, InMemoryAuditRepository } from '@proctira/backend-audit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAuthAudit, type AuthAuditRecord } from './auth-audit.js';

const TENANT = '7c9e6679-7425-50de-a3b7-5a5c0e3c8b11'; // version-5 id, as seeded in UAT
const USER = '0d8e2f5a-1b3c-5d4e-8f60-718293a4b5c6';
const EMAIL = 'teacher@sunrise.example';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const tenantAccess = (extra: Record<string, unknown> = {}) =>
  jwt({ sub: USER, tenant_id: TENANT, email: EMAIL, preferred_username: EMAIL, ...extra });
const platformAccess = () =>
  jwt({ sub: 'op-kc-1', tenant_id: 'platform', email: 'ops@proctira.test' });

interface LogLine {
  level: string;
  obj: Record<string, unknown>;
  msg: string;
}

let app: FastifyInstance;
let repo: InMemoryAuditRepository;
let sinkCalls: AuthAuditRecord[];
let logs: LogLine[];

/** Routes shaped like the Keycloak auth routes' responses. */
async function buildAuthApp(): Promise<FastifyInstance> {
  logs = [];
  const stream = {
    write(line: string) {
      const parsed = JSON.parse(line) as Record<string, unknown> & { level: number; msg: string };
      const level = parsed.level >= 50 ? 'error' : parsed.level >= 40 ? 'warn' : 'info';
      logs.push({ level, obj: parsed, msg: parsed.msg });
    },
  };
  const instance = Fastify({ logger: { level: 'info', stream } });
  repo = new InMemoryAuditRepository();
  const service = new AuditService(repo);
  sinkCalls = [];
  const sink = {
    async recordAudit(input: AuthAuditRecord) {
      sinkCalls.push(input);
      // Postgres: audit_log_entries.tenant_id is uuid (db/sql/100).
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.tenantId)) {
        throw new Error(`invalid input syntax for type uuid: "${input.tenantId}"`);
      }
      return service.recordAudit(input);
    },
  };
  registerAuthAudit(instance, () => sink);
  instance.post('/api/v1/auth/password', async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    if (body.password !== 'right') {
      return reply.status(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid' });
    }
    const platform = body.username === 'ops@proctira.test';
    return reply.status(200).send({
      provider: 'keycloak',
      accessToken: platform ? platformAccess() : tenantAccess(),
      refreshToken: 'kc-refresh',
      user: platform
        ? { userId: 'op-1', tenantId: 'platform', email: 'ops@proctira.test' }
        : { userId: USER, tenantId: TENANT, email: EMAIL },
    });
  });
  instance.get('/api/v1/auth/ticket', async (request, reply) => {
    const { ticket } = request.query as { ticket?: string };
    if (ticket !== 'good') return reply.status(401).send({ code: 'KEYCLOAK_TICKET_INVALID' });
    return reply.status(200).send({ provider: 'keycloak', accessToken: tenantAccess() });
  });
  instance.post('/api/v1/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (refreshToken === 'bad') return reply.status(401).send({ code: 'KEYCLOAK_REFRESH_FAILED' });
    const platform = refreshToken === 'platform';
    return reply.status(200).send({
      provider: 'keycloak',
      accessToken: platform ? platformAccess() : tenantAccess(),
      refreshToken: 'rotated',
    });
  });
  instance.get('/api/v1/auth/callback', async (_request, reply) =>
    reply.redirect('https://sunrise.example/api/auth/callback?ticket=good', 302),
  );
  await instance.ready();
  return instance;
}

async function storedRows() {
  const result = await repo.query({ tenantId: TENANT, page: 1, pageSize: 100, sortOrder: 'asc' });
  return result.data;
}

function writeFailures(): LogLine[] {
  return logs.filter((l) => l.msg.includes('auth audit write failed'));
}

beforeEach(async () => {
  app = await buildAuthApp();
});
afterEach(async () => {
  await app.close();
});

describe('UATENV-D36: sign-in and refresh rows reach the audit trail', () => {
  it('SSO ticket redemption writes one row for the user and tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/ticket?ticket=good' });
    expect(res.statusCode).toBe(200);
    expect(writeFailures()).toEqual([]);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT,
      entityType: 'auth',
      entityId: 'auth.ticket.redeem',
      operation: 'CREATE',
      userId: USER,
      userName: USER,
    });
    expect(rows[0]!.metadata).toMatchObject({ action: 'auth.ticket.redeem', outcome: 'success' });
  });

  it('password sign-in writes one row with no email, username or password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: EMAIL, password: 'right' },
    });
    expect(res.statusCode).toBe(200);
    expect(writeFailures()).toEqual([]);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: 'auth.login.password',
      operation: 'CREATE',
      tenantId: TENANT,
      userId: USER,
    });
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain('right');
    expect(serialized).not.toContain('kc-refresh');
  });

  it('a successful refresh writes a row; repeats for the same user are rate-limited', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: `kc-${i}` },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(writeFailures()).toEqual([]);
    const rows = (await storedRows()).filter((r) => r.entityId === 'auth.refresh');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'CREATE', tenantId: TENANT, userId: USER });
  });

  it('never sends a non-UUID tenant to the audit store (platform operator, anonymous)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'ops@proctira.test', password: 'right' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: EMAIL, password: 'wrong' },
    });
    await app.inject({ method: 'GET', url: '/api/v1/auth/callback?code=c&state=s' });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'bad' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'platform' },
    });
    expect(sinkCalls).toEqual([]);
    expect(writeFailures()).toEqual([]);
    const notPersisted = logs.filter((l) => l.msg.includes('auth event without a tenant'));
    expect(notPersisted).toHaveLength(5);
    // The log line carries the event, never the attempted identifier or password.
    expect(JSON.stringify(notPersisted)).not.toContain(EMAIL);
    expect(JSON.stringify(notPersisted)).not.toContain('wrong');
    expect(
      notPersisted.map((l) => (l.obj['authAudit'] as Record<string, unknown>)['action']),
    ).toEqual([
      'auth.login.password',
      'auth.login.password',
      'auth.login.sso_callback',
      'auth.refresh',
      'auth.refresh',
    ]);
  });
});
