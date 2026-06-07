/**
 * Unit tests for ExternalAuthHandler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExternalAuthHandler } from './external-auth-handler.js';
import type { ExternalIdentityStore, ExternalAuthUserLookup, ExternalIdentityLink } from './external-auth-handler.js';
import { ProviderRegistry } from './provider-registry.js';
import { ExternalAuthError } from './types.js';
import type { ExternalAuthProvider, AuthInitiationResult, AuthCallbackParams, ExternalUserProfile } from './types.js';
import type { AuthUser, AuthConfig, TokenPair } from '@proctira/auth';
import { TokenService } from '../token-service.js';
import type { JwtSigner, RefreshTokenStore } from '../token-service.js';
import { SessionService } from '../session-service.js';
import type { SessionStore } from '../session-service.js';
import type { Session, RefreshToken } from '@proctira/auth';

// --- Mock implementations ---

class MockProvider implements ExternalAuthProvider {
  readonly providerId = 'mock-provider';
  readonly type = 'oauth2' as const;
  readonly displayName = 'Mock Provider';

  public initiateResult: AuthInitiationResult = { redirectUrl: 'https://mock.com/auth', state: 'mock-state' };
  public callbackResult: ExternalUserProfile = {
    externalId: 'ext-user-1',
    email: 'external@example.com',
    displayName: 'External User',
    firstName: 'External',
    lastName: 'User',
    rawAttributes: {},
  };
  public callbackError: Error | null = null;

  async initiateAuth(_tenantId: string): Promise<AuthInitiationResult> {
    return this.initiateResult;
  }

  async handleCallback(_params: AuthCallbackParams, _tenantId: string): Promise<ExternalUserProfile> {
    if (this.callbackError) throw this.callbackError;
    return this.callbackResult;
  }
}

class MockIdentityStore implements ExternalIdentityStore {
  public links: ExternalIdentityLink[] = [];

  async findByExternalId(providerId: string, externalId: string, tenantId: string): Promise<ExternalIdentityLink | null> {
    return this.links.find(
      (l) => l.providerId === providerId && l.externalId === externalId && l.tenantId === tenantId,
    ) ?? null;
  }

  async findByEmail(email: string, tenantId: string): Promise<ExternalIdentityLink | null> {
    return this.links.find((l) => l.email === email && l.tenantId === tenantId) ?? null;
  }

  async create(link: Omit<ExternalIdentityLink, 'createdAt' | 'lastUsedAt'>): Promise<ExternalIdentityLink> {
    const full: ExternalIdentityLink = { ...link, createdAt: new Date(), lastUsedAt: new Date() };
    this.links.push(full);
    return full;
  }

  async updateLastUsed(_providerId: string, _externalId: string, _tenantId: string): Promise<void> {
    // no-op for tests
  }
}

class MockUserLookup implements ExternalAuthUserLookup {
  public users: AuthUser[] = [];
  public createdUsers: AuthUser[] = [];

  async findById(userId: string, tenantId: string): Promise<AuthUser | null> {
    return this.users.find((u) => u.userId === userId && u.tenantId === tenantId) ?? null;
  }

  async findByEmail(email: string, tenantId: string): Promise<AuthUser | null> {
    return this.users.find((u) => u.email === email && u.tenantId === tenantId) ?? null;
  }

  async createFromExternalProfile(profile: ExternalUserProfile, tenantId: string, _providerId: string): Promise<AuthUser> {
    const user: AuthUser = {
      userId: `new-user-${Date.now()}`,
      tenantId,
      email: profile.email,
      displayName: profile.displayName,
      roles: [],
      areas: [],
      institutions: [],
    };
    this.createdUsers.push(user);
    this.users.push(user);
    return user;
  }
}

class MockJwtSigner implements JwtSigner {
  sign(payload: Record<string, unknown>, _options?: { expiresIn: number }): string {
    return `jwt.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;
  }
  verify<T>(_token: string): T {
    return {} as T;
  }
}

class MockRefreshTokenStore implements RefreshTokenStore {
  public tokens: RefreshToken[] = [];

  async create(token: Omit<RefreshToken, 'id' | 'createdAt'>): Promise<RefreshToken> {
    const full: RefreshToken = { ...token, id: `rt-${Date.now()}`, createdAt: new Date() };
    this.tokens.push(full);
    return full;
  }
  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.tokens.find((t) => t.token === token) ?? null;
  }
  async revoke(_token: string, _reason: string): Promise<void> {}
  async revokeAllForSession(_sessionId: string, _reason: string): Promise<void> {}
  async revokeAllForUser(_userId: string, _tenantId: string, _reason: string): Promise<void> {}
}

class MockSessionStore implements SessionStore {
  public sessions: Session[] = [];

  async create(session: Session): Promise<Session> {
    this.sessions.push(session);
    return session;
  }
  async findById(sessionId: string): Promise<Session | null> {
    return this.sessions.find((s) => s.id === sessionId) ?? null;
  }
  async updateLastActivity(_sessionId: string, _timestamp: Date): Promise<void> {}
  async invalidate(_sessionId: string): Promise<void> {}
  async invalidateAllForUser(_userId: string, _tenantId: string): Promise<void> {}
  async findActiveByUser(_userId: string, _tenantId: string): Promise<Session[]> { return []; }
}

// --- Tests ---

describe('ExternalAuthHandler', () => {
  let registry: ProviderRegistry;
  let mockProvider: MockProvider;
  let identityStore: MockIdentityStore;
  let userLookup: MockUserLookup;
  let tokenService: TokenService;
  let sessionService: SessionService;
  let handler: ExternalAuthHandler;

  const authConfig: AuthConfig = {
    jwt: { secret: 'test-secret', issuer: 'test', audience: 'test', accessTokenExpiresIn: 900 },
    refreshToken: { maxLifetime: 2592000 },
    session: { duration: 28800 },
    password: { saltRounds: 10 },
    lockout: { maxAttempts: 3, windowSeconds: 900, durationSeconds: 900 },
  };

  beforeEach(() => {
    registry = new ProviderRegistry();
    mockProvider = new MockProvider();
    registry.register(mockProvider);

    identityStore = new MockIdentityStore();
    userLookup = new MockUserLookup();

    const jwtSigner = new MockJwtSigner();
    const refreshTokenStore = new MockRefreshTokenStore();
    const sessionStore = new MockSessionStore();

    tokenService = new TokenService(authConfig, jwtSigner, refreshTokenStore);
    sessionService = new SessionService(authConfig, sessionStore);

    handler = new ExternalAuthHandler(
      registry,
      tokenService,
      sessionService,
      identityStore,
      userLookup,
      { autoProvisionUsers: true, linkByEmail: true },
    );
  });

  describe('initiateAuth', () => {
    it('should delegate to the provider and return redirect URL', async () => {
      const result = await handler.initiateAuth('mock-provider', 'tenant-1');

      expect(result.redirectUrl).toBe('https://mock.com/auth');
      expect(result.state).toBe('mock-state');
    });

    it('should throw for unknown provider', async () => {
      await expect(handler.initiateAuth('unknown', 'tenant-1')).rejects.toThrow(ExternalAuthError);
    });
  });

  describe('handleCallback', () => {
    it('should authenticate and issue tokens for existing linked user', async () => {
      // Setup: existing user with identity link
      const existingUser: AuthUser = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'external@example.com',
        displayName: 'External User',
        roles: [{ roleId: 'role-1', roleName: 'Teacher', areaId: 'area-1' }],
        areas: [{ areaId: 'area-1', level: 1 }],
        institutions: ['inst-1'],
      };
      userLookup.users.push(existingUser);

      identityStore.links.push({
        userId: 'user-1',
        tenantId: 'tenant-1',
        providerId: 'mock-provider',
        externalId: 'ext-user-1',
        email: 'external@example.com',
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      const result = await handler.handleCallback(
        'mock-provider',
        { code: 'auth-code', state: 'state' },
        'tenant-1',
        { userAgent: 'test-agent', ipAddress: '127.0.0.1' },
      );

      expect(result.user.userId).toBe('user-1');
      expect(result.user.email).toBe('external@example.com');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.session.id).toBeDefined();
      expect(result.isNewUser).toBe(false);
      expect(result.providerId).toBe('mock-provider');
    });

    it('should link by email when no external ID link exists', async () => {
      // Setup: existing user with matching email but no identity link
      const existingUser: AuthUser = {
        userId: 'user-2',
        tenantId: 'tenant-1',
        email: 'external@example.com',
        displayName: 'Existing User',
        roles: [],
        areas: [],
        institutions: [],
      };
      userLookup.users.push(existingUser);

      const result = await handler.handleCallback(
        'mock-provider',
        { code: 'auth-code', state: 'state' },
        'tenant-1',
      );

      expect(result.user.userId).toBe('user-2');
      expect(result.isNewUser).toBe(false);

      // Should have created an identity link
      expect(identityStore.links).toHaveLength(1);
      expect(identityStore.links[0]!.userId).toBe('user-2');
      expect(identityStore.links[0]!.externalId).toBe('ext-user-1');
    });

    it('should auto-provision new user when no match found', async () => {
      const result = await handler.handleCallback(
        'mock-provider',
        { code: 'auth-code', state: 'state' },
        'tenant-1',
      );

      expect(result.isNewUser).toBe(true);
      expect(result.user.email).toBe('external@example.com');
      expect(result.user.tenantId).toBe('tenant-1');

      // Should have created user and identity link
      expect(userLookup.createdUsers).toHaveLength(1);
      expect(identityStore.links).toHaveLength(1);
    });

    it('should throw when auto-provisioning is disabled and no user found', async () => {
      handler = new ExternalAuthHandler(
        registry,
        tokenService,
        sessionService,
        identityStore,
        userLookup,
        { autoProvisionUsers: false, linkByEmail: true },
      );

      await expect(
        handler.handleCallback('mock-provider', { code: 'code', state: 'state' }, 'tenant-1'),
      ).rejects.toThrow('No platform account found');
    });

    it('should propagate provider callback errors', async () => {
      mockProvider.callbackError = new ExternalAuthError(
        'Provider denied access',
        'mock-provider',
        'ACCESS_DENIED',
      );

      await expect(
        handler.handleCallback('mock-provider', { code: 'code', state: 'state' }, 'tenant-1'),
      ).rejects.toThrow('Provider denied access');
    });

    it('should throw for unknown provider', async () => {
      await expect(
        handler.handleCallback('unknown', { code: 'code', state: 'state' }, 'tenant-1'),
      ).rejects.toThrow(ExternalAuthError);
    });
  });

  describe('listProviders', () => {
    it('should return all registered providers', () => {
      const providers = handler.listProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]).toEqual({
        providerId: 'mock-provider',
        type: 'oauth2',
        displayName: 'Mock Provider',
      });
    });
  });
});
