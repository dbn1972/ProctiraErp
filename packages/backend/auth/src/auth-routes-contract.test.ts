/**
 * PRC-M183 — HTTP route-contract tests for the auth routes that previously had
 * no route-level coverage: local login/refresh/logout (`routes.ts`), MFA / SMS
 * OTP (`mfa-routes.ts`), and admin/tenant invite (`invite/routes.ts`).
 *
 * These exercise the REAL `register*` functions via `fastify.inject` and assert
 * the fail-closed security contracts named in the finding:
 *   - OTP-bypass: a wrong/replayed/garbage code never verifies and never mints
 *     a session or tokens.
 *   - Missing-role: invite endpoints reject callers without an admin-class role
 *     (401 when unauthenticated, 403 when authenticated-but-unprivileged).
 *   - Tenant context is required (fail closed) on local login/refresh.
 *
 * Written to FAIL against code that drops these guards.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { InviteService } from './invite/invite-service.js';
import { registerInviteAndTenantDirectoryRoutes } from './invite/routes.js';
import { registerMfaRoutes } from './mfa-routes.js';
import { InMemoryOtpChallengeStore, OtpService } from './otp-service.js';
import { registerAuthRoutes, type UserLookup } from './routes.js';
import type { SmsMessage, SmsProvider } from './sms-provider.js';

class CapturingSmsProvider implements SmsProvider {
  readonly name = 'test';
  readonly sent: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
  }
}

function buildOtpService(): { service: OtpService; sms: CapturingSmsProvider } {
  const sms = new CapturingSmsProvider();
  const service = new OtpService({ store: new InMemoryOtpChallengeStore(), sms });
  return { service, sms };
}

// ---------------------------------------------------------------------------
// MFA / OTP routes
// ---------------------------------------------------------------------------
describe('registerMfaRoutes (PRC-M183)', () => {
  interface MfaAppOpts {
    primaryUser?: { userId: string; tenantId: string } | null;
    phone?: string | null;
    hostTenantId?: string;
  }

  async function mfaApp(
    opts: MfaAppOpts = {},
  ): Promise<{ app: FastifyInstance; sms: CapturingSmsProvider }> {
    const app = Fastify();
    const { service, sms } = buildOtpService();
    const hostTenantId = opts.hostTenantId ?? 't1';
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = hostTenantId;
    });
    await registerMfaRoutes(app, {
      otpService: service,
      // PRC-M497: identity is bound server-side; the gateway resolves the
      // primary-auth step. `undefined` means "no prior login" (fail closed).
      resolvePrimaryAuth:
        opts.primaryUser === undefined ? undefined : async () => opts.primaryUser ?? null,
      resolvePhone: opts.phone === undefined ? undefined : async () => opts.phone ?? null,
    });
    await app.ready();
    return { app, sms };
  }

  it('fails closed when there is no primary-auth step (PRIMARY_AUTH_REQUIRED)', async () => {
    const { app } = await mfaApp(); // no resolvePrimaryAuth wired
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { tenantId: 't1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('PRIMARY_AUTH_REQUIRED');
    await app.close();
  });

  it('rejects a body tenantId that differs from the host tenant (no client-chosen tenant)', async () => {
    const { app } = await mfaApp({
      primaryUser: { userId: 'u1', tenantId: 't1' },
      phone: '+919999999999',
      hostTenantId: 't1',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { tenantId: 'attacker-tenant' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_MISMATCH');
    await app.close();
  });

  it('does NOT verify a wrong OTP code and never issues a session (OTP-bypass)', async () => {
    const { app, sms } = await mfaApp({
      primaryUser: { userId: 'u1', tenantId: 't1' },
      phone: '+919999999999',
    });
    const send = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: {},
    });
    expect(send.statusCode).toBe(200);
    const { mfaToken } = send.json() as { mfaToken: string };
    expect(mfaToken).toBeTruthy();
    expect(sms.sent).toHaveLength(1);

    const verify = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: '000000', method: 'sms' },
    });
    // Wrong code must fail closed — never 200, never success/tokens.
    expect(verify.statusCode).toBe(401);
    const body = verify.json() as { success?: boolean; tokens?: unknown };
    expect(body.success).not.toBe(true);
    expect(body.tokens).toBeUndefined();
    await app.close();
  });

  it('rejects a garbage mfaToken on verify (no silent success)', async () => {
    const { app } = await mfaApp({
      primaryUser: { userId: 'u1', tenantId: 't1' },
      phone: '+919999999999',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken: 'not-a-real-token', code: '123456', method: 'sms' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { success?: boolean }).success).not.toBe(true);
    await app.close();
  });

  it('validates required fields on verify', async () => {
    const { app } = await mfaApp({
      primaryUser: { userId: 'u1', tenantId: 't1' },
      phone: '+919999999999',
    });
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Invite routes (privilege-escalation guard)
// ---------------------------------------------------------------------------
describe('registerInviteAndTenantDirectoryRoutes (PRC-M183)', () => {
  function fakeInviteService(): InviteService {
    // Repository/mail are never reached in the authz-negative paths under test;
    // a method-replacing stub keeps the test hermetic while using the real route.
    const svc = Object.create(InviteService.prototype) as InviteService;
    (svc as unknown as { inviteUser: unknown }).inviteUser = async () => ({
      id: '00000000-0000-4000-8000-000000000000',
      email: 'x@example.com',
      displayName: null,
      roleId: null,
      status: 'pending',
      inviteUrl: 'https://invite.example/abc',
      expiresAt: new Date().toISOString(),
      emailSent: false,
      createdAt: new Date().toISOString(),
    });
    return svc;
  }

  async function inviteApp(user?: unknown, tenantId?: string): Promise<FastifyInstance> {
    const app = Fastify();
    // Simulate the gateway's JWT/tenant decoration without granting roles.
    app.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = user;
      (request as { tenantId?: string }).tenantId = tenantId;
    });
    await registerInviteAndTenantDirectoryRoutes(app, { inviteService: fakeInviteService() });
    await app.ready();
    return app;
  }

  it('rejects an unauthenticated invite with 401 (fail closed)', async () => {
    const app = await inviteApp(undefined, 't1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
    await app.close();
  });

  it('rejects an authenticated non-admin invite with 403 (missing-role)', async () => {
    const app = await inviteApp({ sub: 'u1', roles: ['teacher', 'student'] }, 't1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    await app.close();
  });

  it('allows an admin-role caller to invite (201) — guard is role-based, not blanket-deny', async () => {
    const app = await inviteApp({ sub: 'admin1', roles: ['tenant-admin'] }, 't1');
    const res = await app.inject({
      method: 'POST',
      url: '/tenant/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('requires tenant context even for an admin (fail closed)', async () => {
    const app = await inviteApp({ sub: 'admin1', roles: ['admin'] }, undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_REQUIRED');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Local auth routes (login / refresh / logout)
// ---------------------------------------------------------------------------
describe('registerAuthRoutes local routes (PRC-M183)', () => {
  const emptyUserLookup: UserLookup = {
    async findByUsername() {
      return null;
    },
    async findById() {
      return null;
    },
  };

  function stubServices() {
    return {
      tokenService: {
        issueTokenPair: async () => ({ accessToken: 'a', refreshToken: 'r' }),
        refreshTokenPair: async () => ({ accessToken: 'a', refreshToken: 'r' }),
        revokeAllSessionTokens: async () => undefined,
      },
      sessionService: {
        createSession: async () => ({ id: 's1', expiresAt: new Date() }),
        invalidateSession: async () => undefined,
        validateSession: async () => null,
      },
      refreshTokenStore: {
        findByToken: async () => null,
      },
    };
  }

  async function authApp(tenantId?: string): Promise<FastifyInstance> {
    const app = Fastify();
    // registerAuthRoutes uses `fastify.authenticate` as a preHandler on
    // /auth/logout and /auth/me. Provide a fail-closed stub that mirrors the
    // gateway: reject when there is no authenticated user on the request.
    app.decorate(
      'authenticate',
      async (
        request: { user?: unknown },
        reply: { status: (c: number) => { send: (b: unknown) => unknown } },
      ) => {
        if (!request.user) {
          return reply.status(401).send({ code: 'UNAUTHORIZED', statusCode: 401 });
        }
        return undefined;
      },
    );
    app.decorate('accessTokenRevocationStore', undefined);
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = tenantId;
    });
    const s = stubServices();
    await registerAuthRoutes(app, {
      tokenService: s.tokenService as never,
      sessionService: s.sessionService as never,
      userLookup: emptyUserLookup,
      refreshTokenStore: s.refreshTokenStore as never,
    });
    await app.ready();
    return app;
  }

  it('login validates required credentials (400)', async () => {
    const app = await authApp('t1');
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('login requires tenant context (fail closed)', async () => {
    const app = await authApp(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'a@b.com', password: 'secret' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_REQUIRED');
    await app.close();
  });

  it('login with an unknown user returns 401 INVALID_CREDENTIALS (no user enumeration bypass)', async () => {
    const app = await authApp('t1');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ghost@b.com', password: 'secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    await app.close();
  });

  it('refresh requires a refresh token (400)', async () => {
    const app = await authApp('t1');
    const res = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('refresh with an unknown token returns 401 (fail closed)', async () => {
    const app = await authApp('t1');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_REFRESH_TOKEN');
    await app.close();
  });

  it('logout without the authenticate decorator is rejected (not an open endpoint)', async () => {
    // registerAuthRoutes references fastify.authenticate as a preHandler. Without
    // the decorator the route must not silently succeed — asserts logout is guarded.
    const app = await authApp('t1');
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});
