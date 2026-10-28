/**
 * PRC-M183: HTTP tests for local POST /auth/login and POST /auth/logout.
 */
import type { RefreshToken, Session } from '@proctira/auth';
import { createAuthConfig } from '@proctira/auth';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryAccessTokenRevocationStore } from './access-token-revocation.js';
import { createPreMfaTicketCodec } from './pre-mfa-ticket.js';
import { hashPassword, verifyPassword } from './local-auth.js';
import type { AccountLockoutService, LockoutStatus } from './lockout-service.js';
import { registerAuthRoutes, type UserLookup } from './routes.js';
import { SessionService, type SessionStore } from './session-service.js';
import { TokenService, type JwtSigner, type RefreshTokenStore } from './token-service.js';

// PRC-L445: count bcrypt comparisons so timing equalisation is observable.
vi.mock('./local-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./local-auth.js')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const TENANT = 'tenant-m183';
const PASSWORD = 'correct horse battery staple';

function memoryRefreshStore(): RefreshTokenStore & { tokens: Map<string, RefreshToken> } {
  const tokens = new Map<string, RefreshToken>();
  return {
    tokens,
    async create(input) {
      const t: RefreshToken = { id: `rt-${tokens.size}`, ...input, createdAt: new Date() };
      tokens.set(input.token, t);
      return t;
    },
    async findByToken(token) {
      return tokens.get(token) ?? null;
    },
    async revoke(token, reason) {
      const t = tokens.get(token);
      if (t) Object.assign(t, { revoked: true, revokedReason: reason });
    },
    async revokeAllForSession(sessionId, reason) {
      for (const t of tokens.values()) {
        if (t.sessionId === sessionId) Object.assign(t, { revoked: true, revokedReason: reason });
      }
    },
    async revokeAllForUser(userId, tenantId, reason) {
      for (const t of tokens.values()) {
        if (t.userId === userId && t.tenantId === tenantId) {
          Object.assign(t, { revoked: true, revokedReason: reason });
        }
      }
    },
  };
}

function memorySessionStore(): SessionStore & { sessions: Map<string, Session> } {
  const sessions = new Map<string, Session>();
  return {
    sessions,
    async create(s) {
      sessions.set(s.id, s);
      return s;
    },
    async findById(id) {
      return sessions.get(id) ?? null;
    },
    async updateLastActivity(id, at) {
      const s = sessions.get(id);
      if (s) s.lastActivityAt = at;
    },
    async invalidate(id) {
      const s = sessions.get(id);
      if (s) s.isActive = false;
    },
    async invalidateAllForUser(userId, tenantId) {
      for (const s of sessions.values()) {
        if (s.userId === userId && s.tenantId === tenantId) s.isActive = false;
      }
    },
    async findActiveByUser(userId, tenantId) {
      return [...sessions.values()].filter(
        (s) => s.userId === userId && s.tenantId === tenantId && s.isActive,
      );
    },
  } as SessionStore & { sessions: Map<string, Session> };
}

const signer: JwtSigner = {
  sign: (payload) => `jwt.${String(payload['sub'])}.${String(payload['jti'])}`,
  verify: (() => ({})) as unknown as JwtSigner['verify'],
};

interface LockoutStub {
  isAccountLocked: ReturnType<typeof vi.fn<() => Promise<LockoutStatus>>>;
  recordFailure: ReturnType<typeof vi.fn<() => Promise<LockoutStatus>>>;
  resetOnSuccess: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

describe('PRC-M183 local login / logout routes', () => {
  let passwordHash: string;
  let app: FastifyInstance;
  let refreshStore: ReturnType<typeof memoryRefreshStore>;
  let sessionStore: ReturnType<typeof memorySessionStore>;
  let sessionService: SessionService;
  let tokenService: TokenService;
  let denylist: MemoryAccessTokenRevocationStore;
  let lockout: LockoutStub;
  let tenantId: string | undefined;
  let authUser: { sessionId: string; jti: string; sub: string } | null;
  const user = {
    id: 'user-1',
    email: 'u@example.com',
    displayName: 'U',
    passwordHash: '',
    tenantId: TENANT,
    roles: [],
    areas: [],
    institutions: [],
    isActive: true,
  };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD, 4);
  });

  beforeEach(async () => {
    const config = createAuthConfig({
      jwt: { secret: 's', issuer: 'i', audience: 'a', accessTokenExpiresIn: 900 },
      refreshToken: { maxLifetime: 30 * 24 * 3600 },
      session: { duration: 3600 },
    } as never);
    refreshStore = memoryRefreshStore();
    sessionStore = memorySessionStore();
    denylist = new MemoryAccessTokenRevocationStore();
    tokenService = new TokenService(config, signer, refreshStore, denylist);
    sessionService = new SessionService(config, sessionStore, tokenService);
    Object.assign(user, { passwordHash, isActive: true });
    tenantId = TENANT;
    authUser = null;
    lockout = {
      isAccountLocked: vi.fn(async () => ({ isLocked: false })),
      recordFailure: vi.fn(async () => ({ isLocked: false, remainingAttempts: 4 })),
      resetOnSuccess: vi.fn(async () => undefined),
    };
    const userLookup: UserLookup = {
      findByUsername: async (username: string) => (username === user.email ? { ...user } : null),
      findById: async () => ({ ...user }),
    } as unknown as UserLookup;

    app = Fastify();
    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!authUser) {
        return reply.status(401).send({ code: 'UNAUTHORIZED', statusCode: 401 });
      }
      (request as unknown as { user: unknown }).user = authUser;
    });
    app.addHook('onRequest', async (req: FastifyRequest) => {
      (req as FastifyRequest & { tenantId?: string }).tenantId = tenantId;
    });
    await registerAuthRoutes(app, {
      tokenService,
      sessionService,
      userLookup,
      refreshTokenStore: refreshStore,
      lockoutService: lockout as unknown as AccountLockoutService,
      accessTokenRevocationStore: denylist,
      accessTokenExpiresIn: 900,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/auth/login', payload });

  describe('POST /auth/login', () => {
    it('missing credentials -> 400 VALIDATION_ERROR naming the missing field', async () => {
      const res = await login({ username: user.email });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(res.json().errors).toEqual([expect.objectContaining({ field: 'password' })]);
    });

    it('no tenant context -> 400 TENANT_REQUIRED', async () => {
      tenantId = undefined;
      const res = await login({ username: user.email, password: PASSWORD });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_REQUIRED');
    });

    it('unknown user -> 401 INVALID_CREDENTIALS', async () => {
      const res = await login({ username: 'nobody@example.com', password: PASSWORD });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INVALID_CREDENTIALS');
    });

    it('inactive user -> 401 ACCOUNT_INACTIVE and no session', async () => {
      user.isActive = false;
      const res = await login({ username: user.email, password: PASSWORD });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('ACCOUNT_INACTIVE');
      expect(sessionStore.sessions.size).toBe(0);
    });

    it('wrong password -> 401 INVALID_CREDENTIALS and the failure is recorded', async () => {
      const res = await login({ username: user.email, password: 'wrong' });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INVALID_CREDENTIALS');
      expect(lockout.recordFailure).toHaveBeenCalledWith(user.id, TENANT, expect.anything());
      expect(sessionStore.sessions.size).toBe(0);
    });

    it('wrong password that trips the lockout -> the same 401 INVALID_CREDENTIALS (PRC-L445)', async () => {
      lockout.recordFailure.mockResolvedValueOnce({
        isLocked: true,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const res = await login({ username: user.email, password: 'wrong' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
        statusCode: 401,
      });
    });

    it('locked account -> generic 401 even with the right password, no session (PRC-L445)', async () => {
      lockout.isAccountLocked.mockResolvedValueOnce({
        isLocked: true,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const res = await login({ username: user.email, password: PASSWORD });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
        statusCode: 401,
      });
      expect(res.json().lockedUntil).toBeUndefined();
      expect(sessionStore.sessions.size).toBe(0);
    });

    describe('PRC-L445 disclosure, timing and body validation', () => {
      const verifyMock = vi.mocked(verifyPassword);
      beforeEach(() => {
        verifyMock.mockClear();
      });

      it('inactive account + wrong password -> INVALID_CREDENTIALS (state not disclosed)', async () => {
        user.isActive = false;
        const res = await login({ username: user.email, password: 'wrong' });
        expect(res.statusCode).toBe(401);
        expect(res.json().code).toBe('INVALID_CREDENTIALS');
        expect(sessionStore.sessions.size).toBe(0);
      });

      it('inactive account + correct password -> ACCOUNT_INACTIVE', async () => {
        user.isActive = false;
        const res = await login({ username: user.email, password: PASSWORD });
        expect(res.statusCode).toBe(401);
        expect(res.json().code).toBe('ACCOUNT_INACTIVE');
      });

      it('unknown, locked and inactive accounts each spend exactly one bcrypt comparison', async () => {
        await login({ username: 'nobody@example.com', password: PASSWORD });
        expect(verifyMock).toHaveBeenCalledTimes(1);
        verifyMock.mockClear();

        lockout.isAccountLocked.mockResolvedValueOnce({ isLocked: true });
        await login({ username: user.email, password: PASSWORD });
        expect(verifyMock).toHaveBeenCalledTimes(1);
        // The locked account's real hash is never evaluated (no guessing oracle).
        expect(verifyMock.mock.calls[0]?.[1]).not.toBe(passwordHash);
        verifyMock.mockClear();

        user.isActive = false;
        await login({ username: user.email, password: PASSWORD });
        expect(verifyMock).toHaveBeenCalledTimes(1);
      });

      it('locked account does not record another failure', async () => {
        lockout.isAccountLocked.mockResolvedValueOnce({ isLocked: true });
        await login({ username: user.email, password: 'wrong' });
        expect(lockout.recordFailure).not.toHaveBeenCalled();
      });

      it('non-string or oversized fields -> 400 VALIDATION_ERROR without a user lookup', async () => {
        const typed = await login({ username: { $ne: '' }, password: PASSWORD });
        expect(typed.statusCode).toBe(400);
        expect(typed.json().errors).toEqual([
          expect.objectContaining({ field: 'username', rule: 'type' }),
        ]);
        const long = await login({ username: user.email, password: 'x'.repeat(1025) });
        expect(long.statusCode).toBe(400);
        expect(long.json().errors).toEqual([
          expect.objectContaining({ field: 'password', rule: 'maxLength' }),
        ]);
        expect(verifyMock).not.toHaveBeenCalled();
      });
    });

    it('valid credentials -> 200 with tokens, session and user; lockout reset', async () => {
      const res = await login({ username: user.email, password: PASSWORD });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tokens.accessToken).toEqual(expect.any(String));
      expect(body.tokens.refreshToken).toEqual(expect.any(String));
      expect(body.session.id).toEqual(expect.any(String));
      expect(body.user).toMatchObject({ userId: user.id, tenantId: TENANT, email: user.email });
      expect(body.user.passwordHash).toBeUndefined();
      expect(sessionStore.sessions.get(body.session.id)?.isActive).toBe(true);
      expect(lockout.resetOnSuccess).toHaveBeenCalledWith(user.id, TENANT);
    });
  });

  describe('POST /auth/logout', () => {
    it('authenticated -> 200; session invalid, refresh tokens revoked, jti denylisted', async () => {
      const loginRes = await login({ username: user.email, password: PASSWORD });
      const { session, tokens } = loginRes.json();
      authUser = { sessionId: session.id, jti: 'jti-logout-1', sub: user.id };
      const res = await app.inject({ method: 'POST', url: '/auth/logout' });
      expect(res.statusCode).toBe(200);
      expect(sessionStore.sessions.get(session.id)?.isActive).toBe(false);
      expect(refreshStore.tokens.get(tokens.refreshToken)?.revoked).toBe(true);
      expect(await denylist.isRevoked('jti', 'jti-logout-1')).toBe(true);
      expect(await denylist.isRevoked('sid', session.id)).toBe(true);
    });

    it('unauthenticated -> 401 and nothing is revoked', async () => {
      const loginRes = await login({ username: user.email, password: PASSWORD });
      const { session } = loginRes.json();
      const res = await app.inject({ method: 'POST', url: '/auth/logout' });
      expect(res.statusCode).toBe(401);
      expect(sessionStore.sessions.get(session.id)?.isActive).toBe(true);
    });
  });
});

describe('PRC-M497 local login mints a pre-MFA ticket when MFA is required', () => {
  it('returns mfa_required + a ticket for the authenticated user, with no session or tokens', async () => {
    const config = createAuthConfig({
      jwt: { secret: 's', issuer: 'i', audience: 'a', accessTokenExpiresIn: 900 },
      refreshToken: { maxLifetime: 30 * 24 * 3600 },
      session: { duration: 3600 },
    } as never);
    const refreshStore = memoryRefreshStore();
    const sessionStore = memorySessionStore();
    const tokenService = new TokenService(config, signer, refreshStore);
    const sessionService = new SessionService(config, sessionStore, tokenService);
    const hash = await hashPassword(PASSWORD, 4);
    const account = {
      id: 'user-mfa',
      email: 'mfa@example.com',
      displayName: 'M',
      passwordHash: hash,
      tenantId: TENANT,
      roles: [],
      areas: [],
      institutions: [],
      isActive: true,
    };
    const codec = createPreMfaTicketCodec({ secret: 'm497-local-login-secret-0123456789ab' });
    const app = Fastify();
    app.decorate('authenticate', async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(401).send({ code: 'UNAUTHORIZED', statusCode: 401 }),
    );
    app.addHook('onRequest', async (req: FastifyRequest) => {
      (req as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
    });
    await registerAuthRoutes(app, {
      tokenService,
      sessionService,
      userLookup: {
        findByUsername: async (u: string) => (u === account.email ? { ...account } : null),
        findById: async () => ({ ...account }),
      } as unknown as UserLookup,
      refreshTokenStore: refreshStore,
      mfa: { preMfaTicket: codec, isRequired: async ({ userId }) => userId === 'user-mfa' },
    });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: account.email, password: PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.status).toBe('mfa_required');
      expect(body.tokens).toBeUndefined();
      expect(sessionStore.sessions.size).toBe(0);
      expect(codec.verify(body.preMfaTicket)).toEqual({ userId: 'user-mfa', tenantId: TENANT });
      const wrong = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: account.email, password: 'nope' },
      });
      expect(wrong.json().preMfaTicket).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
