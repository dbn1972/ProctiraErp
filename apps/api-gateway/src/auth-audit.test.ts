/**
 * PRC-M501 — auth mutations emit one audit row each (actor, tenant, ip,
 * outcome), with no OTP codes / phones / passwords in the payload.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { authAuditOutcome, classifyAuthAuditAction } from './auth-audit.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

describe('PRC-M501 auth route classification', () => {
  it.each([
    ['POST', '/api/v1/auth/password', 'auth.login.password'],
    ['GET', '/api/v1/auth/login', 'auth.login.sso_start'],
    ['GET', '/api/v1/auth/callback', 'auth.login.sso_callback'],
    ['GET', '/api/v1/auth/ticket', 'auth.ticket.redeem'],
    ['POST', '/api/v1/auth/refresh', 'auth.refresh'],
    ['GET', '/api/v1/auth/logout', 'auth.logout'],
    ['POST', '/api/v1/auth/logout', 'auth.logout'],
    ['POST', '/api/v1/auth/mfa/otp/send', 'auth.mfa.send'],
    ['POST', '/auth/mfa/otp/resend', 'auth.mfa.resend'],
    ['POST', '/api/v1/auth/mfa/verify', 'auth.mfa.verify'],
    ['POST', '/admin/users/invite', 'auth.invite.create'],
    ['POST', '/tenant/users/invite', 'auth.invite.create'],
  ])('%s %s -> %s', (method, url, action) => {
    expect(classifyAuthAuditAction(method, url)).toBe(action);
  });

  it('fails closed: unknown mutating auth route is still audited', () => {
    expect(classifyAuthAuditAction('POST', '/api/v1/auth/new-thing')).toBe('auth.other');
  });

  it('ignores non-auth routes, unmatched routes and read-only catalogs', () => {
    expect(classifyAuthAuditAction('POST', '/api/v1/students')).toBeNull();
    expect(classifyAuthAuditAction('POST', '/api/v1/authorities')).toBeNull();
    expect(classifyAuthAuditAction('POST', undefined)).toBeNull();
    expect(classifyAuthAuditAction('GET', '/api/v1/auth/me')).toBeNull();
  });

  it('maps status to outcome (lockout, revoked)', () => {
    expect(authAuditOutcome(200)).toBe('success');
    expect(authAuditOutcome(401)).toBe('failure');
    expect(authAuditOutcome(429)).toBe('lockout');
    expect(authAuditOutcome(401, 'KEYCLOAK_SESSION_REVOKED')).toBe('revoked');
  });
});

describe('PRC-M501 auth audit rows through buildApp', () => {
  let app: FastifyInstance;
  let record: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    const svc = (app as unknown as { auditService: { recordAudit: () => Promise<unknown> } })
      .auditService;
    record?.mockRestore();
    record = vi.spyOn(svc, 'recordAudit');
  });

  function authRows() {
    return record.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((r) => r['entityType'] === 'auth');
  }

  // UATENV-D36: an unauthenticated request has no verified tenant. The unverified
  // tenant header never selects the audit chain, and a non-UUID tenant is not sent
  // to the store (it is logged instead; see auth-audit-d36.test.ts).
  it('MFA verify failure (unauthenticated) never writes into the claimed tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: { 'x-tenant-id': TENANT },
      payload: { mfaToken: 'bogus-token', code: '123456' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(authRows()).toHaveLength(0);
  });

  it('OTP send (unauthenticated) never writes into the claimed tenant', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/otp/send',
      headers: { 'x-tenant-id': TENANT },
      payload: { phone: '+919876543210', userId: 'u-1' },
    });
    expect(authRows()).toHaveLength(0);
  });

  it('authenticated caller: actor and tenant come from the verified JWT', async () => {
    const token = app.jwt.sign({
      sub: 'user-m501',
      tenantId: TENANT,
      email: 'u@example.com',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-m501',
      sessionId: 'sess-m501',
    } as never);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/otp/send',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT },
      payload: { phone: '+919876543210' },
    });
    const rows = authRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!['entityId']).toBe('auth.mfa.send');
    expect(rows[0]!['userId']).toBe('user-m501');
    expect(rows[0]!['tenantId']).toBe(TENANT);
    expect(rows[0]!['ipAddress']).toBeTruthy();
    // UATENV-D36: user id and tenant only; no email, phone or user agent.
    expect(rows[0]!['userName']).toBe('user-m501');
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('u@example.com');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('userAgent');
  });

  it('non-auth requests do not produce auth rows', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    expect(authRows()).toHaveLength(0);
  });
});
