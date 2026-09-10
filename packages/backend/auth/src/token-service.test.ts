/**
 * Unit tests for TokenService - JWT issuance, refresh token rotation, revocation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenService, InvalidRefreshTokenError } from './token-service.js';
import type { JwtSigner, RefreshTokenStore } from './token-service.js';
import type { AuthConfig, AuthUser, RefreshToken, JwtPayload } from '@proctira/auth';
import { createAuthConfig } from '@proctira/auth';

// Mock JWT signer
function createMockJwtSigner(): JwtSigner {
  const signFn = vi.fn((payload: Record<string, unknown>, options?: { expiresIn: number }) => {
    return `mock-jwt-${payload['sub']}-exp${options?.expiresIn ?? 900}`;
  });

  const verifyFn = vi.fn((token: string) => {
    // Extract sub from token format: mock-jwt-{sub}-exp{expiresIn}
    const match = token.match(/^mock-jwt-(.+)-exp\d+$/);
    const sub = match ? match[1] : 'unknown';
    return {
      sub,
      tenantId: 'tenant-1',
      email: 'test@example.com',
      displayName: 'Test User',
      roles: [],
      areas: [],
      institutions: [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      jti: 'mock-jti',
      sessionId: 'session-1',
    } as JwtPayload;
  });

  return {
    sign: signFn,
    verify: verifyFn as unknown as JwtSigner['verify'],
  };
}

// Mock refresh token store
function createMockRefreshTokenStore(): RefreshTokenStore & { tokens: Map<string, RefreshToken> } {
  const tokens = new Map<string, RefreshToken>();

  return {
    tokens,
    create: vi.fn(async (input) => {
      const token: RefreshToken = {
        id: `rt-${Date.now()}`,
        ...input,
        createdAt: new Date(),
      };
      tokens.set(input.token, token);
      return token;
    }),
    findByToken: vi.fn(async (token: string) => {
      return tokens.get(token) ?? null;
    }),
    revoke: vi.fn(async (token: string, reason: string, replacedByToken?: string) => {
      const stored = tokens.get(token);
      if (stored) {
        stored.revoked = true;
        stored.revokedAt = new Date();
        stored.revokedReason = reason;
        if (replacedByToken) {
          stored.replacedByToken = replacedByToken;
        }
      }
    }),
    revokeAllForSession: vi.fn(async (sessionId: string, reason: string) => {
      for (const [, token] of tokens) {
        if (token.sessionId === sessionId) {
          token.revoked = true;
          token.revokedAt = new Date();
          token.revokedReason = reason;
        }
      }
    }),
    revokeAllForUser: vi.fn(async (userId: string, tenantId: string, reason: string) => {
      for (const [, token] of tokens) {
        if (token.userId === userId && token.tenantId === tenantId) {
          token.revoked = true;
          token.revokedAt = new Date();
          token.revokedReason = reason;
        }
      }
    }),
  };
}

function createTestUser(): AuthUser {
  return {
    userId: 'user-123',
    tenantId: 'tenant-1',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [{ roleId: 'role-1', roleName: 'admin', areaId: 'area-1' }],
    areas: [{ areaId: 'area-1', level: 1 }],
    institutions: ['inst-1'],
  };
}

describe('TokenService', () => {
  let config: AuthConfig;
  let jwtSigner: JwtSigner;
  let refreshTokenStore: ReturnType<typeof createMockRefreshTokenStore>;
  let tokenService: TokenService;

  beforeEach(() => {
    config = createAuthConfig({
      jwt: {
        secret: 'test-secret',
        issuer: 'test-issuer',
        audience: 'test-audience',
        accessTokenExpiresIn: 900, // 15 minutes
      },
      refreshToken: { maxLifetime: 30 * 24 * 60 * 60 }, // 30 days
    });
    jwtSigner = createMockJwtSigner();
    refreshTokenStore = createMockRefreshTokenStore();
    tokenService = new TokenService(config, jwtSigner, refreshTokenStore);
  });

  describe('issueTokenPair', () => {
    it('should issue an access token and refresh token', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const result = await tokenService.issueTokenPair(user, sessionId);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900);
      expect(result.tokenType).toBe('Bearer');
    });

    it('should sign the JWT with correct payload', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      await tokenService.issueTokenPair(user, sessionId);

      expect(jwtSigner.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-123',
          tenantId: 'tenant-1',
          email: 'test@example.com',
          displayName: 'Test User',
          roles: user.roles,
          areas: user.areas,
          institutions: user.institutions,
          sessionId: 'session-1',
        }),
        { expiresIn: 900 },
      );
    });

    it('should store the refresh token in the database', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const result = await tokenService.issueTokenPair(user, sessionId, '192.168.1.1');

      expect(refreshTokenStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          token: result.refreshToken,
          userId: 'user-123',
          tenantId: 'tenant-1',
          sessionId: 'session-1',
          revoked: false,
          createdByIp: '192.168.1.1',
        }),
      );
    });

    it('should set refresh token expiry based on config', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      await tokenService.issueTokenPair(user, sessionId);

      const createCall = (refreshTokenStore.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const expiresAt = createCall.expiresAt as Date;
      const expectedExpiry = Date.now() + config.refreshToken.maxLifetime * 1000;

      // Allow 5 second tolerance
      expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
    });
  });

  describe('refreshTokenPair', () => {
    it('should rotate the refresh token and issue a new pair', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      // First, issue a token pair
      const original = await tokenService.issueTokenPair(user, sessionId);

      // Now refresh
      const refreshed = await tokenService.refreshTokenPair(original.refreshToken, user);

      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.refreshToken).toBeDefined();
      expect(refreshed.refreshToken).not.toBe(original.refreshToken);
      expect(refreshed.expiresIn).toBe(900);
      expect(refreshed.tokenType).toBe('Bearer');
    });

    it('should revoke the old refresh token on rotation', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const original = await tokenService.issueTokenPair(user, sessionId);
      await tokenService.refreshTokenPair(original.refreshToken, user);

      // Old token should be revoked
      const oldToken = refreshTokenStore.tokens.get(original.refreshToken);
      expect(oldToken?.revoked).toBe(true);
      expect(oldToken?.revokedReason).toBe('Rotated');
    });

    it('should throw InvalidRefreshTokenError for non-existent token', async () => {
      const user = createTestUser();

      await expect(tokenService.refreshTokenPair('non-existent-token', user)).rejects.toThrow(
        InvalidRefreshTokenError,
      );
    });

    it('should throw InvalidRefreshTokenError for revoked token and revoke all session tokens', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const original = await tokenService.issueTokenPair(user, sessionId);

      // Revoke the token
      await tokenService.revokeRefreshToken(original.refreshToken, 'Manual revocation');

      // Try to use revoked token
      await expect(tokenService.refreshTokenPair(original.refreshToken, user)).rejects.toThrow(
        InvalidRefreshTokenError,
      );

      // All session tokens should be revoked
      expect(refreshTokenStore.revokeAllForSession).toHaveBeenCalledWith(
        sessionId,
        'Token reuse detected',
      );
    });

    it('should throw InvalidRefreshTokenError for expired token', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const original = await tokenService.issueTokenPair(user, sessionId);

      // Manually expire the token
      const storedToken = refreshTokenStore.tokens.get(original.refreshToken);
      if (storedToken) {
        storedToken.expiresAt = new Date(Date.now() - 1000); // expired 1 second ago
      }

      await expect(tokenService.refreshTokenPair(original.refreshToken, user)).rejects.toThrow(
        InvalidRefreshTokenError,
      );
    });

    it('should throw InvalidRefreshTokenError for tenant mismatch', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const original = await tokenService.issueTokenPair(user, sessionId);

      // Try to refresh with different tenant
      const differentTenantUser = { ...user, tenantId: 'different-tenant' };

      await expect(
        tokenService.refreshTokenPair(original.refreshToken, differentTenantUser),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should revoke a specific refresh token', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      const pair = await tokenService.issueTokenPair(user, sessionId);
      await tokenService.revokeRefreshToken(pair.refreshToken, 'Test revocation');

      expect(refreshTokenStore.revoke).toHaveBeenCalledWith(pair.refreshToken, 'Test revocation');
    });
  });

  describe('revokeAllSessionTokens', () => {
    it('should revoke all tokens for a session', async () => {
      const user = createTestUser();
      const sessionId = 'session-1';

      await tokenService.issueTokenPair(user, sessionId);
      await tokenService.issueTokenPair(user, sessionId);

      await tokenService.revokeAllSessionTokens(sessionId, 'Logout');

      expect(refreshTokenStore.revokeAllForSession).toHaveBeenCalledWith(sessionId, 'Logout');
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should revoke all tokens for a user in a tenant', async () => {
      const user = createTestUser();

      await tokenService.revokeAllUserTokens(user.userId, user.tenantId, 'Security reset');

      expect(refreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        user.userId,
        user.tenantId,
        'Security reset',
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify and decode a valid access token', () => {
      const result = tokenService.verifyAccessToken('mock-jwt-user-123-exp900');

      expect(result.sub).toBe('user-123');
      expect(result.tenantId).toBe('tenant-1');
    });
  });
});
