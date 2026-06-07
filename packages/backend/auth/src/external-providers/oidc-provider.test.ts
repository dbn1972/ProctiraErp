/**
 * Unit tests for OIDCProvider.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OIDCProvider } from './oidc-provider.js';
import type { HttpClient } from './oauth2-provider.js';
import type { OIDCProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';

/** Mock HTTP client for testing */
class MockHttpClient implements HttpClient {
  public postResponses: Array<{ data: Record<string, unknown>; status: number }> = [];
  public getResponses: Array<{ data: Record<string, unknown>; status: number }> = [];
  public postCalls: Array<{ url: string; body: Record<string, string> }> = [];
  public getCalls: Array<{ url: string; headers?: Record<string, string> }> = [];

  async post(url: string, body: Record<string, string>, _headers?: Record<string, string>): Promise<{ data: Record<string, unknown>; status: number }> {
    this.postCalls.push({ url, body });
    return this.postResponses.shift() ?? { data: {}, status: 500 };
  }

  async get(url: string, headers?: Record<string, string>): Promise<{ data: Record<string, unknown>; status: number }> {
    this.getCalls.push({ url, headers });
    return this.getResponses.shift() ?? { data: {}, status: 500 };
  }
}

const discoveryDocument = {
  issuer: 'https://idp.example.com',
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
  scopes_supported: ['openid', 'email', 'profile'],
  response_types_supported: ['code'],
};

const oidcConfig: OIDCProviderConfig = {
  type: 'oidc',
  providerId: 'custom-oidc',
  displayName: 'Custom OIDC Provider',
  clientId: 'oidc-client-id',
  clientSecret: 'oidc-client-secret',
  discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
  scopes: ['openid', 'email', 'profile'],
  callbackUrl: 'https://app.example.com/auth/oidc/callback',
};

describe('OIDCProvider', () => {
  let httpClient: MockHttpClient;
  let provider: OIDCProvider;

  beforeEach(() => {
    httpClient = new MockHttpClient();
    provider = new OIDCProvider(oidcConfig, httpClient);
  });

  describe('getDiscoveryDocument', () => {
    it('should fetch and return the discovery document', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      const doc = await provider.getDiscoveryDocument();

      expect(doc.issuer).toBe('https://idp.example.com');
      expect(doc.authorization_endpoint).toBe('https://idp.example.com/authorize');
      expect(doc.token_endpoint).toBe('https://idp.example.com/token');
      expect(httpClient.getCalls[0]!.url).toBe(oidcConfig.discoveryUrl);
    });

    it('should cache the discovery document', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      await provider.getDiscoveryDocument();
      await provider.getDiscoveryDocument();

      // Should only fetch once
      expect(httpClient.getCalls).toHaveLength(1);
    });

    it('should throw on failed discovery fetch', async () => {
      httpClient.getResponses.push({ data: {}, status: 503 });

      await expect(provider.getDiscoveryDocument()).rejects.toThrow(ExternalAuthError);
    });

    it('should throw on invalid discovery document', async () => {
      httpClient.getResponses.push({ data: { issuer: 'test' }, status: 200 });

      await expect(provider.getDiscoveryDocument()).rejects.toThrow(
        'missing required endpoints',
      );
    });
  });

  describe('initiateAuth', () => {
    it('should return redirect URL from discovery endpoint', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      const result = await provider.initiateAuth('tenant-1');

      expect(result.redirectUrl).toContain('https://idp.example.com/authorize');
      expect(result.redirectUrl).toContain('client_id=oidc-client-id');
      expect(result.redirectUrl).toContain('response_type=code');
      expect(result.redirectUrl).toContain('scope=openid+email+profile');
      expect(result.redirectUrl).toContain('nonce=');
      expect(result.state).toBeDefined();
      expect(result.nonce).toBeDefined();
    });
  });

  describe('handleCallback', () => {
    it('should exchange code and extract profile from ID token', async () => {
      // Setup discovery
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      // Initiate to store state
      const initResult = await provider.initiateAuth('tenant-1');

      // Mock token exchange with ID token
      const idTokenPayload = {
        sub: 'oidc-user-123',
        email: 'user@company.com',
        name: 'OIDC User',
        given_name: 'OIDC',
        family_name: 'User',
      };
      const idToken = `header.${Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url')}.signature`;

      httpClient.postResponses.push({
        data: { access_token: 'oidc-access-token', id_token: idToken, token_type: 'Bearer' },
        status: 200,
      });

      const profile = await provider.handleCallback(
        { code: 'oidc-auth-code', state: initResult.state },
        'tenant-1',
      );

      expect(profile.externalId).toBe('oidc-user-123');
      expect(profile.email).toBe('user@company.com');
      expect(profile.displayName).toBe('OIDC User');
      expect(profile.firstName).toBe('OIDC');
      expect(profile.lastName).toBe('User');
    });

    it('should fall back to userinfo endpoint when no ID token', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      const initResult = await provider.initiateAuth('tenant-1');

      // Token response without ID token
      httpClient.postResponses.push({
        data: { access_token: 'oidc-access-token', token_type: 'Bearer' },
        status: 200,
      });

      // Userinfo response
      httpClient.getResponses.push({
        data: { sub: 'oidc-user-456', email: 'user2@company.com', name: 'Another User' },
        status: 200,
      });

      const profile = await provider.handleCallback(
        { code: 'oidc-auth-code', state: initResult.state },
        'tenant-1',
      );

      expect(profile.externalId).toBe('oidc-user-456');
      expect(profile.email).toBe('user2@company.com');
    });

    it('should throw on provider error', async () => {
      await expect(
        provider.handleCallback(
          { error: 'invalid_request', errorDescription: 'Bad request' },
          'tenant-1',
        ),
      ).rejects.toThrow(ExternalAuthError);
    });

    it('should throw on missing code', async () => {
      await expect(
        provider.handleCallback({ state: 'some-state' }, 'tenant-1'),
      ).rejects.toThrow('Authorization code is missing');
    });

    it('should throw on invalid state', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      await expect(
        provider.handleCallback({ code: 'code', state: 'invalid' }, 'tenant-1'),
      ).rejects.toThrow('Invalid or expired state');
    });

    it('should throw on tenant mismatch', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
      const initResult = await provider.initiateAuth('tenant-1');

      await expect(
        provider.handleCallback(
          { code: 'code', state: initResult.state },
          'tenant-2',
        ),
      ).rejects.toThrow('Tenant mismatch');
    });

    it('should throw on failed token exchange', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
      const initResult = await provider.initiateAuth('tenant-1');

      httpClient.postResponses.push({ data: { error: 'invalid_grant' }, status: 400 });

      await expect(
        provider.handleCallback(
          { code: 'bad-code', state: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('token exchange failed');
    });
  });

  describe('clearDiscoveryCache', () => {
    it('should force re-fetch of discovery document', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });

      await provider.getDiscoveryDocument();
      provider.clearDiscoveryCache();
      await provider.getDiscoveryDocument();

      expect(httpClient.getCalls).toHaveLength(2);
    });
  });
});
