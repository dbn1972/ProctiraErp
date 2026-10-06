/**
 * Unit tests for OIDCProvider.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
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

  async post(
    url: string,
    body: Record<string, string>,
    _headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }> {
    this.postCalls.push({ url, body });
    return this.postResponses.shift() ?? { data: {}, status: 500 };
  }

  async get(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }> {
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

// PRC-M588: real RS256 ID tokens verified against a mocked JWKS.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', kty: 'RSA' }] };
function signIdToken(payload: Record<string, unknown>, alg = 'RS256'): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid: 'k1' })).toString('base64url');
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig =
    alg === 'RS256'
      ? sign('RSA-SHA256', Buffer.from(`${h}.${b}`), privateKey).toString('base64url')
      : '';
  return `${h}.${b}.${sig}`;
}
function claims(nonce: string, extra: Record<string, unknown> = {}) {
  return {
    iss: 'https://idp.example.com',
    aud: 'oidc-client-id',
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: 'oidc-user-123',
    email: 'user@company.com',
    nonce,
    ...extra,
  };
}

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

      await expect(provider.getDiscoveryDocument()).rejects.toThrow('missing required endpoints');
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
      const idToken = signIdToken({ ...claims(initResult.nonce!), ...idTokenPayload });
      httpClient.getResponses.push({ data: jwks, status: 200 });
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

    it('rejects a token response without an ID token (no unverified userinfo fallback)', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
      const initResult = await provider.initiateAuth('tenant-1');
      httpClient.postResponses.push({
        data: { access_token: 'oidc-access-token', token_type: 'Bearer' },
        status: 200,
      });
      await expect(
        provider.handleCallback({ code: 'c', state: initResult.state }, 'tenant-1'),
      ).rejects.toMatchObject({ code: 'OIDC_MISSING_ID_TOKEN' });
    });

    describe('PRC-M588 ID token validation', () => {
      async function callbackWith(build: (nonce: string) => string) {
        httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
        const init = await provider.initiateAuth('tenant-1');
        httpClient.getResponses.push({ data: jwks, status: 200 });
        httpClient.postResponses.push({
          data: { access_token: 'a', id_token: build(init.nonce!), token_type: 'Bearer' },
          status: 200,
        });
        return provider.handleCallback({ code: 'c', state: init.state }, 'tenant-1');
      }
      it.each([
        ['wrong aud', (n: string) => signIdToken(claims(n, { aud: 'someone-else' }))],
        ['wrong nonce', () => signIdToken(claims('not-the-nonce'))],
        ['wrong iss', (n: string) => signIdToken(claims(n, { iss: 'https://evil.example' }))],
        ['expired', (n: string) => signIdToken(claims(n, { exp: 1000 }))],
        ['alg none', (n: string) => signIdToken(claims(n), 'none')],
        ['wrong azp', (n: string) => signIdToken(claims(n, { azp: 'other-client' }))],
        [
          'tampered payload',
          (n: string) => {
            const [h, , sig] = signIdToken(claims(n)).split('.');
            const forged = Buffer.from(
              JSON.stringify(claims(n, { email: 'admin@company.com' })),
            ).toString('base64url');
            return `${h}.${forged}.${sig}`;
          },
        ],
      ])('rejects %s', async (_label, build) => {
        await expect(callbackWith(build)).rejects.toMatchObject({ code: 'OIDC_INVALID_ID_TOKEN' });
      });

      it('rejects a discovery document whose issuer is not the configured one', async () => {
        httpClient.getResponses.push({
          data: { ...discoveryDocument, issuer: 'https://evil.example' },
          status: 200,
        });
        await expect(provider.getDiscoveryDocument()).rejects.toMatchObject({
          code: 'OIDC_DISCOVERY_ISSUER_MISMATCH',
        });
      });
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
      await expect(provider.handleCallback({ state: 'some-state' }, 'tenant-1')).rejects.toThrow(
        'Authorization code is missing',
      );
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
        provider.handleCallback({ code: 'code', state: initResult.state }, 'tenant-2'),
      ).rejects.toThrow('Tenant mismatch');
    });

    it('should throw on failed token exchange', async () => {
      httpClient.getResponses.push({ data: discoveryDocument, status: 200 });
      const initResult = await provider.initiateAuth('tenant-1');

      httpClient.postResponses.push({ data: { error: 'invalid_grant' }, status: 400 });

      await expect(
        provider.handleCallback({ code: 'bad-code', state: initResult.state }, 'tenant-1'),
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
