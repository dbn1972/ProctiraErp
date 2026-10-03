/**
 * PRC-M584 — local POST /auth/refresh must reject deactivated users and
 * invalidated/expired sessions, never extend past the session expiry, and
 * invalidateAllUserSessions must also kill refresh tokens + sids.
 */
import type { RefreshToken, Session } from '@proctira/auth';
import { createAuthConfig } from '@proctira/auth';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAccessTokenRevocationStore } from './access-token-revocation.js';
import { registerAuthRoutes, type UserLookup } from './routes.js';
import { SessionService, type SessionStore } from './session-service.js';
import { TokenService, type JwtSigner, type RefreshTokenStore } from './token-service.js';

const TENANT = 'tenant-m584';

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

describe('PRC-M584 local refresh guards', () => {
  let app: FastifyInstance;
  let refreshStore: ReturnType<typeof memoryRefreshStore>;
  let sessionStore: ReturnType<typeof memorySessionStore>;
  let tokenService: TokenService;
  let sessionService: SessionService;
  let denylist: MemoryAccessTokenRevocationStore;
  const user = {
    id: 'user-1',
    email: 'u@example.com',
    displayName: 'U',
    tenantId: TENANT,
    roles: [],
    areas: [],
    institutions: [],
    isActive: true,
  };

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
    user.isActive = true;
    const userLookup: UserLookup = {
      findByUsername: async () => null,
      findById: async () => ({ ...user }),
    } as unknown as UserLookup;
    app = Fastify();
    app.decorate('authenticate', async () => undefined);
    app.addHook('onRequest', async (req: FastifyRequest) => {
      (req as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
    });
    await registerAuthRoutes(app, {
      tokenService,
      sessionService,
      userLookup,
      refreshTokenStore: refreshStore,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function login() {
    const session = await sessionService.createSession(user.id, TENANT);
    const pair = await tokenService.issueTokenPair(
      { ...user, userId: user.id } as never,
      session.id,
    );
    return { session, refreshToken: pair.refreshToken };
  }
  const refresh = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

  it('happy path rotates and caps the new refresh token at the session expiry', async () => {
    const { session, refreshToken } = await login();
    const res = await refresh(refreshToken);
    expect(res.statusCode).toBe(200);
    const next = refreshStore.tokens.get(res.json().tokens.refreshToken as string)!;
    expect(next.expiresAt.getTime()).toBeLessThanOrEqual(session.expiresAt.getTime());
  });

  it('deactivated user -> 401 and the session chain is revoked', async () => {
    const { refreshToken } = await login();
    user.isActive = false;
    const res = await refresh(refreshToken);
    expect(res.statusCode).toBe(401);
    expect(refreshStore.tokens.get(refreshToken)!.revoked).toBe(true);
  });

  it('refresh after invalidateSession -> 401', async () => {
    const { session, refreshToken } = await login();
    await sessionService.invalidateSession(session.id);
    const res = await refresh(refreshToken);
    expect(res.statusCode).toBe(401);
  });

  it('expired session -> 401 even though the refresh token is unexpired', async () => {
    const { session, refreshToken } = await login();
    sessionStore.sessions.get(session.id)!.expiresAt = new Date(Date.now() - 1000);
    expect((await refresh(refreshToken)).statusCode).toBe(401);
  });

  it('invalidateAllUserSessions revokes refresh tokens and denylists sids', async () => {
    const a = await login();
    const b = await login();
    await sessionService.invalidateAllUserSessions(user.id, TENANT);
    expect(refreshStore.tokens.get(a.refreshToken)!.revoked).toBe(true);
    expect(refreshStore.tokens.get(b.refreshToken)!.revoked).toBe(true);
    expect(await denylist.isRevoked('sid', a.session.id)).toBe(true);
    expect(await denylist.isRevoked('sid', b.session.id)).toBe(true);
    expect((await refresh(a.refreshToken)).statusCode).toBe(401);
  });
});
