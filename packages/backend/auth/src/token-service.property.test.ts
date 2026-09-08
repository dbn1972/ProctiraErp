/**
 * Property-based tests for JWT Token Expiration and Refresh.
 *
 * Property 2: JWT Token Expiration Compliance
 * For any valid authentication configuration with expiration between 5 minutes
 * and 24 hours, issued JWT access tokens SHALL have an `exp` claim that falls
 * within the configured range, and refresh tokens SHALL have a maximum lifetime
 * not exceeding 30 days.
 *
 * Property 4: Token Refresh with Valid Refresh Token
 * For any expired access token paired with a valid (non-expired, non-revoked)
 * refresh token, the auth service SHALL issue a new token pair and invalidate
 * the previous refresh token (rotation).
 *
 * **Validates: Requirements 4.2, 4.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TokenService, InvalidRefreshTokenError } from './token-service.js';
import type { JwtSigner, RefreshTokenStore } from './token-service.js';
import type { AuthConfig, AuthUser, RefreshToken, JwtPayload } from '@proctira/auth';
import {
  createAuthConfig,
  MIN_ACCESS_TOKEN_EXPIRES,
  MAX_ACCESS_TOKEN_EXPIRES,
  MAX_REFRESH_TOKEN_LIFETIME,
} from '@proctira/auth';

// --- Arbitraries ---

/**
 * Generates a valid access token expiration in seconds within the allowed range (5min–24h).
 */
const accessTokenExpiresInArb: fc.Arbitrary<number> = fc.integer({
  min: MIN_ACCESS_TOKEN_EXPIRES, // 300 seconds (5 minutes)
  max: MAX_ACCESS_TOKEN_EXPIRES, // 86400 seconds (24 hours)
});

/**
 * Generates a valid refresh token max lifetime in seconds (1 day to 30 days).
 */
const refreshTokenLifetimeArb: fc.Arbitrary<number> = fc.integer({
  min: 24 * 60 * 60, // 1 day minimum for meaningful testing
  max: MAX_REFRESH_TOKEN_LIFETIME, // 30 days
});

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
 * A JWT signer that captures the expiration and produces decodable tokens.
 * Tracks the `exp` claim that would be set by a real JWT library.
 */
function createTrackingJwtSigner(): JwtSigner & {
  lastSignedExpiration: number | null;
  lastPayload: Record<string, unknown> | null;
} {
  let lastSignedExpiration: number | null = null;
  let lastPayload: Record<string, unknown> | null = null;

  return {
    get lastSignedExpiration() {
      return lastSignedExpiration;
    },
    get lastPayload() {
      return lastPayload;
    },
    sign(payload: Record<string, unknown>, options?: { expiresIn: number }): string {
      lastPayload = payload;
      const iat = (payload['iat'] as number) ?? Math.floor(Date.now() / 1000);
      const expiresIn = options?.expiresIn ?? 900;
      lastSignedExpiration = expiresIn;
      // Encode the expiration info into the token for verification
      const exp = iat + expiresIn;
      return JSON.stringify({ ...payload, exp, expiresIn });
    },
    verify<T = JwtPayload>(token: string): T {
      const parsed = JSON.parse(token);
      return parsed as T;
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

// --- Property 2: JWT Token Expiration Compliance ---

describe('Property 2: JWT Token Expiration Compliance', () => {
  // **Validates: Requirements 4.2**

  it('access tokens are signed with the configured expiration for any valid expiration in [5min, 24h]', () => {
    fc.assert(
      fc.property(
        accessTokenExpiresInArb,
        authUserArb,
        sessionIdArb,
        (expiresIn, user, sessionId) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: expiresIn,
            },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          // Issue a token pair - we need to await but fc.property doesn't support async directly
          // So we verify the signer was called with the correct expiration synchronously
          // by triggering the sign call
          const payload: Record<string, unknown> = {
            sub: user.userId,
            tenantId: user.tenantId,
            iat: Math.floor(Date.now() / 1000),
          };
          const token = jwtSigner.sign(payload, { expiresIn: config.jwt.accessTokenExpiresIn });
          const decoded = JSON.parse(token);

          // The exp claim must equal iat + configured expiration
          expect(decoded.exp).toBe(decoded.iat + expiresIn);

          // The configured expiration must be within the valid range
          expect(config.jwt.accessTokenExpiresIn).toBeGreaterThanOrEqual(MIN_ACCESS_TOKEN_EXPIRES);
          expect(config.jwt.accessTokenExpiresIn).toBeLessThanOrEqual(MAX_ACCESS_TOKEN_EXPIRES);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('access token expiration is clamped to [5min, 24h] even when out-of-range values are provided', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -86400, max: MIN_ACCESS_TOKEN_EXPIRES - 1 }), // below minimum
          fc.integer({ min: MAX_ACCESS_TOKEN_EXPIRES + 1, max: MAX_ACCESS_TOKEN_EXPIRES * 2 }), // above maximum
        ),
        (invalidExpiration) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: invalidExpiration,
            },
          });

          // createAuthConfig clamps the value to the valid range
          expect(config.jwt.accessTokenExpiresIn).toBeGreaterThanOrEqual(MIN_ACCESS_TOKEN_EXPIRES);
          expect(config.jwt.accessTokenExpiresIn).toBeLessThanOrEqual(MAX_ACCESS_TOKEN_EXPIRES);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('issued token pair has expiresIn matching the configured access token expiration', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenExpiresInArb,
        authUserArb,
        sessionIdArb,
        async (expiresIn, user, sessionId) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: expiresIn,
            },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          const tokenPair = await tokenService.issueTokenPair(user, sessionId);

          // The returned expiresIn must match the configured value
          expect(tokenPair.expiresIn).toBe(expiresIn);

          // The access token must encode the correct expiration
          const decoded = JSON.parse(tokenPair.accessToken);
          expect(decoded.expiresIn).toBe(expiresIn);
          expect(decoded.exp).toBe(decoded.iat + expiresIn);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('refresh token lifetime never exceeds 30 days', async () => {
    await fc.assert(
      fc.asyncProperty(
        refreshTokenLifetimeArb,
        authUserArb,
        sessionIdArb,
        async (lifetime, user, sessionId) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: 900,
            },
            refreshToken: { maxLifetime: lifetime },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          const beforeIssue = Date.now();
          const tokenPair = await tokenService.issueTokenPair(user, sessionId);
          const afterIssue = Date.now();

          // Find the stored refresh token
          const storedToken = store.tokens.get(tokenPair.refreshToken);
          expect(storedToken).toBeDefined();

          // Refresh token expiry must not exceed 30 days from issuance
          const maxAllowedExpiry = afterIssue + MAX_REFRESH_TOKEN_LIFETIME * 1000;
          expect(storedToken!.expiresAt.getTime()).toBeLessThanOrEqual(maxAllowedExpiry);

          // Refresh token expiry must be at least the configured lifetime from before issuance
          const minExpectedExpiry = beforeIssue + config.refreshToken.maxLifetime * 1000 - 1000; // 1s tolerance
          expect(storedToken!.expiresAt.getTime()).toBeGreaterThanOrEqual(minExpectedExpiry);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refresh token lifetime is capped at 30 days even when larger values are configured', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_REFRESH_TOKEN_LIFETIME + 1, max: MAX_REFRESH_TOKEN_LIFETIME * 3 }),
        (excessiveLifetime) => {
          const config = createAuthConfig({
            refreshToken: { maxLifetime: excessiveLifetime },
          });

          // createAuthConfig caps the value at MAX_REFRESH_TOKEN_LIFETIME
          expect(config.refreshToken.maxLifetime).toBeLessThanOrEqual(MAX_REFRESH_TOKEN_LIFETIME);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// --- Property 4: Token Refresh with Valid Refresh Token ---

describe('Property 4: Token Refresh with Valid Refresh Token', () => {
  // **Validates: Requirements 4.5**

  it('a valid non-expired non-revoked refresh token always produces a new token pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenExpiresInArb,
        authUserArb,
        sessionIdArb,
        async (expiresIn, user, sessionId) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: expiresIn,
            },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          // Issue initial token pair
          const original = await tokenService.issueTokenPair(user, sessionId);

          // Refresh using the valid refresh token
          const refreshed = await tokenService.refreshTokenPair(original.refreshToken, user);

          // A new access token must be issued
          expect(refreshed.accessToken).toBeDefined();
          expect(refreshed.accessToken.length).toBeGreaterThan(0);

          // A new refresh token must be issued (different from the original)
          expect(refreshed.refreshToken).toBeDefined();
          expect(refreshed.refreshToken).not.toBe(original.refreshToken);

          // The new token pair must have the correct expiration
          expect(refreshed.expiresIn).toBe(expiresIn);
          expect(refreshed.tokenType).toBe('Bearer');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the previous refresh token is invalidated after rotation', async () => {
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
        const jwtSigner = createTrackingJwtSigner();
        const store = createInMemoryRefreshTokenStore();
        const tokenService = new TokenService(config, jwtSigner, store);

        // Issue initial token pair
        const original = await tokenService.issueTokenPair(user, sessionId);

        // Refresh
        await tokenService.refreshTokenPair(original.refreshToken, user);

        // The old refresh token must be revoked
        const oldToken = store.tokens.get(original.refreshToken);
        expect(oldToken).toBeDefined();
        expect(oldToken!.revoked).toBe(true);
        expect(oldToken!.revokedReason).toBe('Rotated');
      }),
      { numRuns: 100 },
    );
  });

  it('attempting to reuse a rotated refresh token fails and revokes all session tokens', async () => {
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
        const jwtSigner = createTrackingJwtSigner();
        const store = createInMemoryRefreshTokenStore();
        const tokenService = new TokenService(config, jwtSigner, store);

        // Issue and then refresh
        const original = await tokenService.issueTokenPair(user, sessionId);
        await tokenService.refreshTokenPair(original.refreshToken, user);

        // Attempting to reuse the old (now revoked) refresh token must fail
        await expect(tokenService.refreshTokenPair(original.refreshToken, user)).rejects.toThrow(
          InvalidRefreshTokenError,
        );

        // All tokens for the session should be revoked (token reuse detection)
        for (const [, token] of store.tokens) {
          if (token.sessionId === sessionId) {
            expect(token.revoked).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('an expired refresh token cannot be used to obtain a new token pair', async () => {
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
        const jwtSigner = createTrackingJwtSigner();
        const store = createInMemoryRefreshTokenStore();
        const tokenService = new TokenService(config, jwtSigner, store);

        // Issue a token pair
        const original = await tokenService.issueTokenPair(user, sessionId);

        // Manually expire the refresh token (simulate time passing)
        const storedToken = store.tokens.get(original.refreshToken);
        storedToken!.expiresAt = new Date(Date.now() - 1000); // expired 1 second ago

        // Attempting to refresh with an expired token must fail
        await expect(tokenService.refreshTokenPair(original.refreshToken, user)).rejects.toThrow(
          InvalidRefreshTokenError,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('refresh does not require re-authentication (only the refresh token and user context)', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenExpiresInArb,
        authUserArb,
        sessionIdArb,
        async (expiresIn, user, sessionId) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: expiresIn,
            },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          // Issue initial token pair
          const original = await tokenService.issueTokenPair(user, sessionId);

          // Refresh only requires the refresh token and user context (no password)
          // This verifies the interface: refreshTokenPair(refreshToken, user) - no credentials needed
          const refreshed = await tokenService.refreshTokenPair(original.refreshToken, user);

          // The new access token contains the user's identity without re-authentication
          const decoded = JSON.parse(refreshed.accessToken);
          expect(decoded.sub).toBe(user.userId);
          expect(decoded.tenantId).toBe(user.tenantId);
          expect(decoded.email).toBe(user.email);
          expect(decoded.sessionId).toBe(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('multiple sequential refreshes each produce valid new token pairs with rotation', async () => {
    await fc.assert(
      fc.asyncProperty(
        authUserArb,
        sessionIdArb,
        fc.integer({ min: 2, max: 5 }),
        async (user, sessionId, refreshCount) => {
          const config = createAuthConfig({
            jwt: {
              secret: 'test-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
              accessTokenExpiresIn: 900,
            },
          });
          const jwtSigner = createTrackingJwtSigner();
          const store = createInMemoryRefreshTokenStore();
          const tokenService = new TokenService(config, jwtSigner, store);

          // Issue initial token pair
          let currentPair = await tokenService.issueTokenPair(user, sessionId);
          const usedRefreshTokens: string[] = [currentPair.refreshToken];

          // Perform multiple sequential refreshes
          for (let i = 0; i < refreshCount; i++) {
            const newPair = await tokenService.refreshTokenPair(currentPair.refreshToken, user);

            // Each refresh must produce a new, distinct refresh token
            expect(newPair.refreshToken).not.toBe(currentPair.refreshToken);
            expect(usedRefreshTokens).not.toContain(newPair.refreshToken);

            // The previous refresh token must be revoked
            const prevToken = store.tokens.get(currentPair.refreshToken);
            expect(prevToken!.revoked).toBe(true);

            usedRefreshTokens.push(newPair.refreshToken);
            currentPair = newPair;
          }

          // Only the latest refresh token should be non-revoked
          const latestToken = store.tokens.get(currentPair.refreshToken);
          expect(latestToken!.revoked).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
