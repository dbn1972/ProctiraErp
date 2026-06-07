/**
 * Unit tests for OAuth2Provider (including Google and Microsoft).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OAuth2Provider } from './oauth2-provider.js';
import type { HttpClient } from './oauth2-provider.js';
import type { OAuth2ProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';
import { createGoogleProvider, extractGoogleUserInfo } from './google-provider.js';
import { createMicrosoftProvider, extractMicrosoftUserInfo } from './microsoft-provider.js';

/** Mock HTTP client for testing */
class MockHttpClient implements HttpClient {
  public postResponses: Array<{ data: Record<string, unknown>; status: number }> = [];
  public getResponses: Array<{ data: Record<string, unknown>; status: number }> = [];
  public postCalls: Array<{ url: string; body: Record<string, string>; headers?: Record<string, string> }> = [];
  public getCalls: Array<{ url: string; headers?: Record<string, string> }> = [];

  async post(url: string, body: Record<string, string>, headers?: Record<string, string>): Promise<{ data: Record<string, unknown>; status: number }> {
    this.postCalls.push({ url, body, headers });
    return this.postResponses.shift() ?? { data: {}, status: 500 };
  }

  async get(url: string, headers?: Record<string, string>): Promise<{ data: Record<string, unknown>; status: number }> {
    this.getCalls.push({ url, headers });
    return this.getResponses.shift() ?? { data: {}, status: 500 };
  }
}

const baseConfig: OAuth2ProviderConfig = {
  type: 'oauth2',
  providerId: 'test-oauth2',
  displayName: 'Test OAuth2',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authorizationUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  userInfoUrl: 'https://auth.example.com/userinfo',
  scopes: ['openid', 'email', 'profile'],
  callbackUrl: 'https://app.example.com/auth/callback',
};

describe('OAuth2Provider', () => {
  let httpClient: MockHttpClient;
  let provider: OAuth2Provider;

  beforeEach(() => {
    httpClient = new MockHttpClient();
    provider = new OAuth2Provider(
      baseConfig,
      (data) => ({
        externalId: data['sub'] as string,
        email: data['email'] as string,
        displayName: data['name'] as string ?? data['email'] as string,
        rawAttributes: data,
      }),
      httpClient,
    );
  });

  describe('initiateAuth', () => {
    it('should return a redirect URL with correct parameters', async () => {
      const result = await provider.initiateAuth('tenant-1');

      expect(result.redirectUrl).toContain('https://auth.example.com/authorize');
      expect(result.redirectUrl).toContain('client_id=test-client-id');
      expect(result.redirectUrl).toContain('redirect_uri=');
      expect(result.redirectUrl).toContain('response_type=code');
      expect(result.redirectUrl).toContain('scope=openid+email+profile');
      expect(result.state).toBeDefined();
      expect(result.state.length).toBeGreaterThan(0);
    });

    it('should generate unique state for each request', async () => {
      const result1 = await provider.initiateAuth('tenant-1');
      const result2 = await provider.initiateAuth('tenant-1');

      expect(result1.state).not.toBe(result2.state);
    });
  });

  describe('handleCallback', () => {
    it('should exchange code for token and fetch user info', async () => {
      // First initiate to store state
      const initResult = await provider.initiateAuth('tenant-1');

      // Mock token exchange response
      httpClient.postResponses.push({
        data: { access_token: 'mock-access-token', token_type: 'Bearer' },
        status: 200,
      });

      // Mock user info response
      httpClient.getResponses.push({
        data: { sub: 'user-123', email: 'user@example.com', name: 'Test User' },
        status: 200,
      });

      const profile = await provider.handleCallback(
        { code: 'auth-code-123', state: initResult.state },
        'tenant-1',
      );

      expect(profile.externalId).toBe('user-123');
      expect(profile.email).toBe('user@example.com');
      expect(profile.displayName).toBe('Test User');

      // Verify token exchange was called correctly
      expect(httpClient.postCalls[0]!.url).toBe('https://auth.example.com/token');
      expect(httpClient.postCalls[0]!.body['code']).toBe('auth-code-123');
      expect(httpClient.postCalls[0]!.body['grant_type']).toBe('authorization_code');

      // Verify user info was called with access token
      expect(httpClient.getCalls[0]!.url).toBe('https://auth.example.com/userinfo');
      expect(httpClient.getCalls[0]!.headers?.['Authorization']).toBe('Bearer mock-access-token');
    });

    it('should throw on provider error in callback', async () => {
      await expect(
        provider.handleCallback(
          { error: 'access_denied', errorDescription: 'User denied access' },
          'tenant-1',
        ),
      ).rejects.toThrow(ExternalAuthError);
    });

    it('should throw on missing authorization code', async () => {
      await expect(
        provider.handleCallback({ state: 'some-state' }, 'tenant-1'),
      ).rejects.toThrow('Authorization code is missing');
    });

    it('should throw on missing state parameter', async () => {
      await expect(
        provider.handleCallback({ code: 'some-code' }, 'tenant-1'),
      ).rejects.toThrow('State parameter is missing');
    });

    it('should throw on invalid state (CSRF protection)', async () => {
      await expect(
        provider.handleCallback({ code: 'some-code', state: 'invalid-state' }, 'tenant-1'),
      ).rejects.toThrow('Invalid or expired state');
    });

    it('should throw on tenant mismatch', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      await expect(
        provider.handleCallback(
          { code: 'some-code', state: initResult.state },
          'tenant-2', // Different tenant
        ),
      ).rejects.toThrow('Tenant mismatch');
    });

    it('should throw on failed token exchange', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      httpClient.postResponses.push({ data: { error: 'invalid_grant' }, status: 400 });

      await expect(
        provider.handleCallback(
          { code: 'expired-code', state: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('Token exchange failed');
    });

    it('should throw when access token is missing from token response', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      httpClient.postResponses.push({ data: { token_type: 'Bearer' }, status: 200 });

      await expect(
        provider.handleCallback(
          { code: 'some-code', state: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('Failed to obtain access token');
    });

    it('should throw on failed user info request', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      httpClient.postResponses.push({
        data: { access_token: 'token', token_type: 'Bearer' },
        status: 200,
      });
      httpClient.getResponses.push({ data: {}, status: 401 });

      await expect(
        provider.handleCallback(
          { code: 'some-code', state: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('User info request failed');
    });
  });
});

describe('Google Provider', () => {
  describe('extractGoogleUserInfo', () => {
    it('should extract profile from Google userinfo response', () => {
      const data = {
        sub: 'google-123',
        email: 'user@gmail.com',
        name: 'John Doe',
        given_name: 'John',
        family_name: 'Doe',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
        email_verified: true,
      };

      const profile = extractGoogleUserInfo(data);

      expect(profile.externalId).toBe('google-123');
      expect(profile.email).toBe('user@gmail.com');
      expect(profile.displayName).toBe('John Doe');
      expect(profile.firstName).toBe('John');
      expect(profile.lastName).toBe('Doe');
      expect(profile.avatarUrl).toBe('https://lh3.googleusercontent.com/photo.jpg');
    });

    it('should throw when sub is missing', () => {
      expect(() => extractGoogleUserInfo({ email: 'user@gmail.com' })).toThrow(
        'missing required fields',
      );
    });

    it('should throw when email is missing', () => {
      expect(() => extractGoogleUserInfo({ sub: '123' })).toThrow(
        'missing required fields',
      );
    });

    it('should use email as displayName when name is missing', () => {
      const profile = extractGoogleUserInfo({ sub: '123', email: 'user@gmail.com' });
      expect(profile.displayName).toBe('user@gmail.com');
    });
  });

  describe('createGoogleProvider', () => {
    it('should create a provider with correct configuration', () => {
      const httpClient = new MockHttpClient();
      const provider = createGoogleProvider(
        {
          clientId: 'google-client-id',
          clientSecret: 'google-secret',
          callbackUrl: 'https://app.example.com/auth/google/callback',
        },
        httpClient,
      );

      expect(provider.providerId).toBe('google');
      expect(provider.type).toBe('oauth2');
      expect(provider.displayName).toBe('Google');
    });
  });
});

describe('Microsoft Provider', () => {
  describe('extractMicrosoftUserInfo', () => {
    it('should extract profile from Microsoft Graph /me response', () => {
      const data = {
        id: 'ms-user-456',
        mail: 'user@outlook.com',
        displayName: 'Jane Smith',
        givenName: 'Jane',
        surname: 'Smith',
        userPrincipalName: 'jane@contoso.com',
      };

      const profile = extractMicrosoftUserInfo(data);

      expect(profile.externalId).toBe('ms-user-456');
      expect(profile.email).toBe('user@outlook.com');
      expect(profile.displayName).toBe('Jane Smith');
      expect(profile.firstName).toBe('Jane');
      expect(profile.lastName).toBe('Smith');
    });

    it('should fall back to userPrincipalName when mail is null', () => {
      const data = {
        id: 'ms-user-789',
        mail: null,
        userPrincipalName: 'user@contoso.onmicrosoft.com',
        displayName: 'Bob',
      };

      const profile = extractMicrosoftUserInfo(data);
      expect(profile.email).toBe('user@contoso.onmicrosoft.com');
    });

    it('should throw when id is missing', () => {
      expect(() => extractMicrosoftUserInfo({ mail: 'user@outlook.com' })).toThrow(
        'missing required fields',
      );
    });
  });

  describe('createMicrosoftProvider', () => {
    it('should create a provider with correct configuration', () => {
      const httpClient = new MockHttpClient();
      const provider = createMicrosoftProvider(
        {
          clientId: 'ms-client-id',
          clientSecret: 'ms-secret',
          callbackUrl: 'https://app.example.com/auth/microsoft/callback',
        },
        httpClient,
      );

      expect(provider.providerId).toBe('microsoft');
      expect(provider.type).toBe('oauth2');
      expect(provider.displayName).toBe('Microsoft');
    });

    it('should support custom tenant ID', () => {
      const httpClient = new MockHttpClient();
      const provider = createMicrosoftProvider(
        {
          clientId: 'ms-client-id',
          clientSecret: 'ms-secret',
          callbackUrl: 'https://app.example.com/auth/microsoft/callback',
          tenantId: 'my-org-tenant-id',
        },
        httpClient,
      );

      expect(provider.providerId).toBe('microsoft');
    });
  });
});
