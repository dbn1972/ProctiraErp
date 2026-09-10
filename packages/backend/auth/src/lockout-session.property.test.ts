/**
 * Property-based tests for Account Lockout and Session Invalidation.
 *
 * Property 5: Account Lockout on Consecutive Failures
 * For any configurable threshold N, exactly N consecutive failures within the
 * window triggers lockout. The failure counter resets after a successful authentication.
 *
 * Property 7: Session Invalidation on Logout or Token Revocation
 * After logout or token revocation, all session tokens are invalidated.
 * For any expired or revoked refresh token, a refresh attempt SHALL reject
 * and invalidate all tokens for that session.
 *
 * **Validates: Requirements 4.6, 4.8, 4.9**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { createAuthConfig } from '@proctira/auth';
import type { AuthConfig, AuthUser, Session } from '@proctira/auth';

import { AccountLockoutService } from './lockout-service.js';
import { InMemoryLockoutStore } from './lockout-store.js';
import { TokenService, InvalidRefreshTokenError } from './token-service.js';
import type { JwtSigner, RefreshTokenStore } from './token-service.js';
import type { RefreshToken, JwtPayload } from '@proctira/auth';
import { SessionService } from './session-service.js';
import type { SessionStore } from './session-service.js';

// --- Arbitraries ---

/**
 * Generates a configurable lockout threshold between 1 and 10.
 */
const lockoutThresholdArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });

/**
 * Generates a configurable lockout window in seconds (1 minute to 30 minutes).
 */
const lockoutWindowArb: fc.Arbitrary<number> = fc.integer({ min: 60, max: 1800 });

/**
 * Generates a configurable lockout duration in seconds (60s to 86400s = 1min to 24h).
 */
const lockoutDurationArb: fc.Arbitrary<number> = fc.integer({ min: 60, max: 86400 });

/**
 * Generates a valid user ID.
 */
const userIdArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Generates a valid tenant ID.
 */
const tenantIdArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Generates a valid AuthUser with random but valid fields.
 */
const authUserArb: fc.Arbitrary<AuthUser> = fc.record({
  userId: fc.uuid(),
  tenantId: fc.uuid(),
  email: fc.emailAddress(),
  displayName: fc.stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
    { minLength: 2, maxLength: 30 },
  ),
  roles: fc.array(
    fc.record({
      roleId: fc.uuid(),
      roleName: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
        minLength: 3,
        maxLength: 15,
      }),
      areaId: fc.uuid(),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  areas: fc.array(
    fc.record({
      areaId: fc.uuid(),
      level: fc.integer({ min: 1, max: 10 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  institutions: fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
});

/**
 * Generates a valid session ID.
 */
const sessionIdArb: fc.Arbitrary<string> = fc.uuid();

// --- Test Infrastructure ---

/**
 * A JWT signer that produces decodable tokens for testing.
 */
function createTestJwtSigner(): JwtSigner {
  return {
    sign(payload: Record<string, unknown>, options?: { expiresIn: number }): string {
      const iat = (payload['iat'] as number) ?? Math.floor(Date.now() / 1000);
      const expiresIn = options?.expiresIn ?? 900;
      const exp = iat + expiresIn;
      return JSON.stringify({ ...payload, exp, expiresIn });
    },
    verify<T = JwtPayload>(token: string): T {
      return JSON.parse(token) as T;
    },
  };
}

/**
 * In-memory refresh token store for property testing.
 */
function createInMemoryRefreshTokenStore(): RefreshTokenStore & {
  tokens: Map<string, RefreshToken>;
} {
  const tokens = new Map<string, RefreshToken>();

  return {
    tokens,
    async create(input) {
      const token: RefreshToken = {
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...input,
        createdAt: new Date(),
      };
      tokens.set(input.token, token);
      return token;
    },
    async findByToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async revoke(token: string, reason: string, replacedByToken?: string) {
      const stored = tokens.get(token);
      if (stored) {
        stored.revoked = true;
        stored.revokedAt = new Date();
        stored.revokedReason = reason;
        if (replacedByToken) {
          stored.replacedByToken = replacedByToken;
        }
      }
    },
    async revokeAllForSession(sessionId: string, reason: string) {
      for (const [, token] of tokens) {
        if (token.sessionId === sessionId) {
          token.revoked = true;
          token.revokedAt = new Date();
          token.revokedReason = reason;
        }
      }
    },
    async revokeAllForUser(userId: string, tenantId: string, reason: string) {
      for (const [, token] of tokens) {
        if (token.userId === userId && token.tenantId === tenantId) {
          token.revoked = true;
          token.revokedAt = new Date();
          token.revokedReason = reason;
        }
      }
    },
  };
}

/**
 * In-memory session store for property testing.
 */
function createInMemorySessionStore(): SessionStore & { sessions: Map<string, Session> } {
  const sessions = new Map<string, Session>();

  return {
    sessions,
    async create(session: Session) {
      sessions.set(session.id, session);
      return session;
    },
    async findById(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async updateLastActivity(sessionId: string, timestamp: Date) {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastActivityAt = timestamp;
      }
    },
    async invalidate(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) {
        session.isActive = false;
        session.invalidatedAt = new Date();
      }
    },
    async invalidateAllForUser(userId: string, tenantId: string) {
      for (const [, session] of sessions) {
        if (session.userId === userId && session.tenantId === tenantId && session.isActive) {
          session.isActive = false;
          session.invalidatedAt = new Date();
        }
      }
    },
    async findActiveByUser(userId: string, tenantId: string) {
      const result: Session[] = [];
      for (const [, session] of sessions) {
        if (session.userId === userId && session.tenantId === tenantId && session.isActive) {
          result.push(session);
        }
      }
      return result;
    },
  };
}

// --- Property 5: Account Lockout on Consecutive Failures ---

describe('Property 5: Account Lockout on Consecutive Failures', () => {
  // **Validates: Requirements 4.6**

  it('exactly N consecutive failures within the window triggers lockout for any threshold N', async () => {
    await fc.assert(
      fc.asyncProperty(
        lockoutThresholdArb,
        lockoutWindowArb,
        lockoutDurationArb,
        userIdArb,
        tenantIdArb,
        async (threshold, windowSeconds, durationSeconds, userId, tenantId) => {
          const config = createAuthConfig({
            lockout: {
              maxAttempts: threshold,
              windowSeconds,
              durationSeconds,
            },
          });
          const store = new InMemoryLockoutStore();
          const service = new AccountLockoutService(config, store);

          // Record (threshold - 1) failures: account should NOT be locked
          for (let i = 0; i < threshold - 1; i++) {
            const status = await service.recordFailure(userId, tenantId);
            expect(status.isLocked).toBe(false);
            expect(status.remainingAttempts).toBe(threshold - (i + 1));
          }

          // The Nth failure should trigger lockout
          const lockoutStatus = await service.recordFailure(userId, tenantId);
          expect(lockoutStatus.isLocked).toBe(true);
          expect(lockoutStatus.expiresAt).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('failure counter resets after a successful authentication', async () => {
    await fc.assert(
      fc.asyncProperty(
        lockoutThresholdArb,
        lockoutWindowArb,
        lockoutDurationArb,
        userIdArb,
        tenantIdArb,
        fc.integer({ min: 1, max: 9 }),
        async (
          threshold,
          windowSeconds,
          durationSeconds,
          userId,
          tenantId,
          failuresBeforeSuccess,
        ) => {
          // Ensure failuresBeforeSuccess is less than threshold
          const actualFailures = Math.min(failuresBeforeSuccess, threshold - 1);

          const config = createAuthConfig({
            lockout: {
              maxAttempts: threshold,
              windowSeconds,
              durationSeconds,
            },
          });
          const store = new InMemoryLockoutStore();
          const service = new AccountLockoutService(config, store);

          // Record some failures (less than threshold)
          for (let i = 0; i < actualFailures; i++) {
            await service.recordFailure(userId, tenantId);
          }

          // Successful authentication resets the counter
          await service.resetOnSuccess(userId, tenantId);

          // After reset, remaining attempts should be back to full threshold
          const status = await service.isAccountLocked(userId, tenantId);
          expect(status.isLocked).toBe(false);
          expect(status.remainingAttempts).toBe(threshold);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after reset, it takes exactly N new failures to trigger lockout again', async () => {
    await fc.assert(
      fc.asyncProperty(
        lockoutThresholdArb,
        lockoutWindowArb,
        lockoutDurationArb,
        userIdArb,
        tenantIdArb,
        async (threshold, windowSeconds, durationSeconds, userId, tenantId) => {
          const config = createAuthConfig({
            lockout: {
              maxAttempts: threshold,
              windowSeconds,
              durationSeconds,
            },
          });
          const store = new InMemoryLockoutStore();
          const service = new AccountLockoutService(config, store);

          // Record some failures then reset
          for (let i = 0; i < threshold - 1; i++) {
            await service.recordFailure(userId, tenantId);
          }
          await service.resetOnSuccess(userId, tenantId);

          // After reset, (threshold - 1) failures should NOT lock
          for (let i = 0; i < threshold - 1; i++) {
            const status = await service.recordFailure(userId, tenantId);
            expect(status.isLocked).toBe(false);
          }

          // The Nth failure after reset should trigger lockout
          const lockoutStatus = await service.recordFailure(userId, tenantId);
          expect(lockoutStatus.isLocked).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lockout duration matches the configured duration', async () => {
    await fc.assert(
      fc.asyncProperty(
        lockoutThresholdArb,
        lockoutDurationArb,
        userIdArb,
        tenantIdArb,
        async (threshold, durationSeconds, userId, tenantId) => {
          const config = createAuthConfig({
            lockout: {
              maxAttempts: threshold,
              windowSeconds: 1800,
              durationSeconds,
            },
          });
          const store = new InMemoryLockoutStore();
          const service = new AccountLockoutService(config, store);

          const beforeLock = Date.now();

          // Trigger lockout
          for (let i = 0; i < threshold; i++) {
            await service.recordFailure(userId, tenantId);
          }

          const afterLock = Date.now();

          const status = await service.isAccountLocked(userId, tenantId);
          expect(status.isLocked).toBe(true);

          // Lockout expiry should be approximately now + durationSeconds
          const minExpiry = beforeLock + durationSeconds * 1000;
          const maxExpiry = afterLock + durationSeconds * 1000;
          expect(status.expiresAt!.getTime()).toBeGreaterThanOrEqual(minExpiry - 100);
          expect(status.expiresAt!.getTime()).toBeLessThanOrEqual(maxExpiry + 100);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lockout for one user does not affect another user in the same tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        lockoutThresholdArb,
        fc.tuple(userIdArb, userIdArb).filter(([a, b]) => a !== b),
        tenantIdArb,
        async (threshold, [userId1, userId2], tenantId) => {
          const config = createAuthConfig({
            lockout: {
              maxAttempts: threshold,
              windowSeconds: 1800,
              durationSeconds: 900,
            },
          });
          const store = new InMemoryLockoutStore();
          const service = new AccountLockoutService(config, store);

          // Lock user1
          for (let i = 0; i < threshold; i++) {
            await service.recordFailure(userId1, tenantId);
          }

          // user1 should be locked
          const status1 = await service.isAccountLocked(userId1, tenantId);
          expect(status1.isLocked).toBe(true);

          // user2 should NOT be locked
          const status2 = await service.isAccountLocked(userId2, tenantId);
          expect(status2.isLocked).toBe(false);
          expect(status2.remainingAttempts).toBe(threshold);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 7: Session Invalidation on Logout or Token Revocation ---

describe('Property 7: Session Invalidation on Logout or Token Revocation', () => {
  // **Validates: Requirements 4.8, 4.9**

  it('after logout, the session is invalidated and refresh tokens are revoked', async () => {
    await fc.assert(
      fc.asyncProperty(authUserArb, sessionIdArb, async (user, sessionId) => {
        const config = createAuthConfig({
          jwt: {
            secret: 'test-secret',
            issuer: 'test-issuer',
            audience: 'test-audience',
            accessTokenExpiresIn: 900,
          },
        });
        const jwtSigner = createTestJwtSigner();
        const refreshStore = createInMemoryRefreshTokenStore();
        const sessionStore = createInMemorySessionStore();
        const tokenService = new TokenService(config, jwtSigner, refreshStore);
        const sessionService = new SessionService(config, sessionStore);

        // Create a session and issue tokens
        const session = await sessionService.createSession(user.userId, user.tenantId);
        const tokenPair = await tokenService.issueTokenPair(user, session.id);

        // Verify session is active before logout
        const validatedBefore = await sessionService.validateSession(session.id);
        expect(validatedBefore).not.toBeNull();
        expect(validatedBefore!.isActive).toBe(true);

        // Perform logout: invalidate session and revoke all session tokens
        await sessionService.invalidateSession(session.id);
        await tokenService.revokeAllSessionTokens(session.id, 'User logout');

        // Session should be invalidated
        const validatedAfter = await sessionService.validateSession(session.id);
        expect(validatedAfter).toBeNull();

        // Refresh token should be revoked
        const storedRefreshToken = refreshStore.tokens.get(tokenPair.refreshToken);
        expect(storedRefreshToken).toBeDefined();
        expect(storedRefreshToken!.revoked).toBe(true);
        expect(storedRefreshToken!.revokedReason).toBe('User logout');
      }),
      { numRuns: 100 },
    );
  });

  it('after logout, attempting to refresh with the revoked token fails', async () => {
    await fc.assert(
      fc.asyncProperty(authUserArb, async (user) => {
        const config = createAuthConfig({
          jwt: {
            secret: 'test-secret',
            issuer: 'test-issuer',
            audience: 'test-audience',
            accessTokenExpiresIn: 900,
          },
        });
        const jwtSigner = createTestJwtSigner();
        const refreshStore = createInMemoryRefreshTokenStore();
        const sessionStore = createInMemorySessionStore();
        const tokenService = new TokenService(config, jwtSigner, refreshStore);
        const sessionService = new SessionService(config, sessionStore);

        // Create session and issue tokens
        const session = await sessionService.createSession(user.userId, user.tenantId);
        const tokenPair = await tokenService.issueTokenPair(user, session.id);

        // Logout
        await sessionService.invalidateSession(session.id);
        await tokenService.revokeAllSessionTokens(session.id, 'User logout');

        // Attempting to refresh with the revoked token must fail
        await expect(tokenService.refreshTokenPair(tokenPair.refreshToken, user)).rejects.toThrow(
          InvalidRefreshTokenError,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('expired refresh token triggers rejection and invalidation of all session tokens', async () => {
    await fc.assert(
      fc.asyncProperty(authUserArb, sessionIdArb, async (user, sessionId) => {
        const config = createAuthConfig({
          jwt: {
            secret: 'test-secret',
            issuer: 'test-issuer',
            audience: 'test-audience',
            accessTokenExpiresIn: 900,
          },
        });
        const jwtSigner = createTestJwtSigner();
        const refreshStore = createInMemoryRefreshTokenStore();
        const tokenService = new TokenService(config, jwtSigner, refreshStore);

        // Issue a token pair
        const tokenPair = await tokenService.issueTokenPair(user, sessionId);

        // Issue a second token pair for the same session (simulating a refresh)
        const secondPair = await tokenService.issueTokenPair(user, sessionId);

        // Manually expire the first refresh token
        const storedToken = refreshStore.tokens.get(tokenPair.refreshToken);
        storedToken!.expiresAt = new Date(Date.now() - 1000);

        // Attempting to refresh with the expired token must fail
        await expect(tokenService.refreshTokenPair(tokenPair.refreshToken, user)).rejects.toThrow(
          InvalidRefreshTokenError,
        );

        // All tokens for that session should be revoked
        for (const [, token] of refreshStore.tokens) {
          if (token.sessionId === sessionId) {
            expect(token.revoked).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('revoked refresh token triggers rejection and invalidation of all session tokens', async () => {
    await fc.assert(
      fc.asyncProperty(authUserArb, sessionIdArb, async (user, sessionId) => {
        const config = createAuthConfig({
          jwt: {
            secret: 'test-secret',
            issuer: 'test-issuer',
            audience: 'test-audience',
            accessTokenExpiresIn: 900,
          },
        });
        const jwtSigner = createTestJwtSigner();
        const refreshStore = createInMemoryRefreshTokenStore();
        const tokenService = new TokenService(config, jwtSigner, refreshStore);

        // Issue initial token pair and then refresh (creating a rotated token)
        const original = await tokenService.issueTokenPair(user, sessionId);
        const refreshed = await tokenService.refreshTokenPair(original.refreshToken, user);

        // The original refresh token is now revoked (rotated)
        // Attempting to reuse it should fail and invalidate all session tokens
        await expect(tokenService.refreshTokenPair(original.refreshToken, user)).rejects.toThrow(
          InvalidRefreshTokenError,
        );

        // All tokens for the session should be revoked (including the new one)
        for (const [, token] of refreshStore.tokens) {
          if (token.sessionId === sessionId) {
            expect(token.revoked).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('multiple sessions for the same user are all invalidated on invalidateAllUserSessions', async () => {
    await fc.assert(
      fc.asyncProperty(authUserArb, fc.integer({ min: 2, max: 5 }), async (user, sessionCount) => {
        const config = createAuthConfig({
          jwt: {
            secret: 'test-secret',
            issuer: 'test-issuer',
            audience: 'test-audience',
            accessTokenExpiresIn: 900,
          },
        });
        const sessionStore = createInMemorySessionStore();
        const sessionService = new SessionService(config, sessionStore);

        // Create multiple sessions
        const sessions: Session[] = [];
        for (let i = 0; i < sessionCount; i++) {
          const session = await sessionService.createSession(user.userId, user.tenantId);
          sessions.push(session);
        }

        // All sessions should be active
        const activeBefore = await sessionService.getActiveSessions(user.userId, user.tenantId);
        expect(activeBefore).toHaveLength(sessionCount);

        // Invalidate all sessions for the user
        await sessionService.invalidateAllUserSessions(user.userId, user.tenantId);

        // All sessions should now be invalidated
        for (const session of sessions) {
          const validated = await sessionService.validateSession(session.id);
          expect(validated).toBeNull();
        }

        // No active sessions should remain
        const activeAfter = await sessionService.getActiveSessions(user.userId, user.tenantId);
        expect(activeAfter).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });
});
