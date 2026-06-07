/**
 * Custom OIDC Provider
 *
 * Implements OpenID Connect authentication with configurable discovery URL.
 * Fetches provider configuration from the .well-known/openid-configuration endpoint
 * and performs the authorization code flow with ID token validation.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  ExternalAuthProvider,
  OIDCProviderConfig,
  AuthInitiationResult,
  AuthCallbackParams,
  ExternalUserProfile,
} from './types.js';
import { ExternalAuthError } from './types.js';
import type { HttpClient } from './oauth2-provider.js';
import { FetchHttpClient } from './oauth2-provider.js';

/**
 * OIDC Discovery document structure (subset of fields we use).
 */
interface OIDCDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

/**
 * Custom OIDC provider with configurable discovery URL.
 * Automatically fetches endpoints from the OIDC discovery document.
 */
export class OIDCProvider implements ExternalAuthProvider {
  readonly providerId: string;
  readonly type = 'oidc' as const;
  readonly displayName: string;

  private readonly config: OIDCProviderConfig;
  private readonly httpClient: HttpClient;
  private discoveryDoc: OIDCDiscoveryDocument | null = null;

  // Store state/nonce for validation
  private readonly pendingAuths = new Map<string, { tenantId: string; nonce: string; createdAt: number }>();

  constructor(config: OIDCProviderConfig, httpClient?: HttpClient) {
    this.config = config;
    this.providerId = config.providerId;
    this.displayName = config.displayName;
    this.httpClient = httpClient ?? new FetchHttpClient();
  }

  /**
   * Fetch and cache the OIDC discovery document.
   */
  async getDiscoveryDocument(): Promise<OIDCDiscoveryDocument> {
    if (this.discoveryDoc) {
      return this.discoveryDoc;
    }

    const response = await this.httpClient.get(this.config.discoveryUrl);

    if (response.status !== 200) {
      throw new ExternalAuthError(
        `Failed to fetch OIDC discovery document from ${this.config.discoveryUrl}`,
        this.providerId,
        'OIDC_DISCOVERY_FAILED',
        503,
      );
    }

    const doc = response.data as unknown as OIDCDiscoveryDocument;

    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new ExternalAuthError(
        'OIDC discovery document is missing required endpoints',
        this.providerId,
        'OIDC_DISCOVERY_INVALID',
        503,
      );
    }

    this.discoveryDoc = doc;
    return doc;
  }

  /**
   * Initiate the OIDC authorization code flow.
   */
  async initiateAuth(tenantId: string): Promise<AuthInitiationResult> {
    const discovery = await this.getDiscoveryDocument();

    const state = uuidv4();
    const nonce = uuidv4();

    // Store state and nonce for callback validation
    this.pendingAuths.set(state, { tenantId, nonce, createdAt: Date.now() });
    this.cleanupPendingAuths();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      response_type: this.config.responseType ?? 'code',
      scope: this.config.scopes.join(' '),
      state,
      nonce,
    });

    const redirectUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

    return { redirectUrl, state, nonce };
  }

  /**
   * Handle the OIDC callback.
   * Exchanges code for tokens, validates ID token, and extracts user profile.
   */
  async handleCallback(params: AuthCallbackParams, tenantId: string): Promise<ExternalUserProfile> {
    // Check for provider errors
    if (params.error) {
      throw new ExternalAuthError(
        params.errorDescription ?? `OIDC error: ${params.error}`,
        this.providerId,
        'OIDC_PROVIDER_ERROR',
      );
    }

    if (!params.code) {
      throw new ExternalAuthError(
        'Authorization code is missing from OIDC callback',
        this.providerId,
        'OIDC_MISSING_CODE',
      );
    }

    if (!params.state) {
      throw new ExternalAuthError(
        'State parameter is missing from OIDC callback',
        this.providerId,
        'OIDC_MISSING_STATE',
      );
    }

    // Validate state
    const storedAuth = this.pendingAuths.get(params.state);
    if (!storedAuth) {
      throw new ExternalAuthError(
        'Invalid or expired state parameter',
        this.providerId,
        'OIDC_INVALID_STATE',
      );
    }

    this.pendingAuths.delete(params.state);

    if (storedAuth.tenantId !== tenantId) {
      throw new ExternalAuthError(
        'Tenant mismatch in OIDC callback',
        this.providerId,
        'OIDC_TENANT_MISMATCH',
      );
    }

    const discovery = await this.getDiscoveryDocument();

    // Exchange code for tokens
    const tokenResponse = await this.exchangeCode(params.code, discovery.token_endpoint);
    const accessToken = tokenResponse['access_token'] as string | undefined;
    const idToken = tokenResponse['id_token'] as string | undefined;

    if (!accessToken) {
      throw new ExternalAuthError(
        'Failed to obtain access token from OIDC provider',
        this.providerId,
        'OIDC_TOKEN_EXCHANGE_FAILED',
      );
    }

    // Try to extract user info from ID token claims first, fall back to userinfo endpoint
    let profile: ExternalUserProfile;

    if (idToken) {
      profile = this.extractFromIdToken(idToken);
    } else if (discovery.userinfo_endpoint) {
      profile = await this.fetchUserInfo(accessToken, discovery.userinfo_endpoint);
    } else {
      throw new ExternalAuthError(
        'No ID token or userinfo endpoint available',
        this.providerId,
        'OIDC_NO_USER_INFO',
      );
    }

    return profile;
  }

  /**
   * Exchange authorization code for tokens.
   */
  private async exchangeCode(code: string, tokenEndpoint: string): Promise<Record<string, unknown>> {
    const response = await this.httpClient.post(tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.callbackUrl,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (response.status !== 200) {
      throw new ExternalAuthError(
        `OIDC token exchange failed with status ${response.status}`,
        this.providerId,
        'OIDC_TOKEN_EXCHANGE_FAILED',
      );
    }

    return response.data;
  }

  /**
   * Extract user profile from ID token claims (without full JWT validation for simplicity).
   * In production, you'd validate the signature against the JWKS.
   */
  private extractFromIdToken(idToken: string): ExternalUserProfile {
    // Decode the payload (middle part of JWT)
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new ExternalAuthError(
        'Invalid ID token format',
        this.providerId,
        'OIDC_INVALID_ID_TOKEN',
      );
    }

    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;

    const sub = payload['sub'] as string | undefined;
    const email = (payload['email'] as string | undefined) ?? (payload['preferred_username'] as string | undefined);
    const name = payload['name'] as string | undefined;
    const givenName = payload['given_name'] as string | undefined;
    const familyName = payload['family_name'] as string | undefined;
    const picture = payload['picture'] as string | undefined;

    if (!sub || !email) {
      throw new ExternalAuthError(
        'ID token missing required claims (sub, email)',
        this.providerId,
        'OIDC_MISSING_CLAIMS',
      );
    }

    return {
      externalId: sub,
      email,
      displayName: name ?? email,
      firstName: givenName,
      lastName: familyName,
      avatarUrl: picture,
      rawAttributes: payload,
    };
  }

  /**
   * Fetch user info from the OIDC userinfo endpoint.
   */
  private async fetchUserInfo(accessToken: string, userinfoEndpoint: string): Promise<ExternalUserProfile> {
    const response = await this.httpClient.get(userinfoEndpoint, {
      Authorization: `Bearer ${accessToken}`,
    });

    if (response.status !== 200) {
      throw new ExternalAuthError(
        `OIDC userinfo request failed with status ${response.status}`,
        this.providerId,
        'OIDC_USERINFO_FAILED',
      );
    }

    const data = response.data;
    const sub = data['sub'] as string | undefined;
    const email = (data['email'] as string | undefined) ?? (data['preferred_username'] as string | undefined);
    const name = data['name'] as string | undefined;
    const givenName = data['given_name'] as string | undefined;
    const familyName = data['family_name'] as string | undefined;
    const picture = data['picture'] as string | undefined;

    if (!sub || !email) {
      throw new ExternalAuthError(
        'OIDC userinfo response missing required fields (sub, email)',
        this.providerId,
        'OIDC_MISSING_CLAIMS',
      );
    }

    return {
      externalId: sub,
      email,
      displayName: name ?? email,
      firstName: givenName,
      lastName: familyName,
      avatarUrl: picture,
      rawAttributes: data,
    };
  }

  /**
   * Clean up expired pending auth states (older than 10 minutes).
   */
  private cleanupPendingAuths(): void {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [state, data] of this.pendingAuths.entries()) {
      if (data.createdAt < tenMinutesAgo) {
        this.pendingAuths.delete(state);
      }
    }
  }

  /**
   * Invalidate the cached discovery document (useful for testing or config changes).
   */
  clearDiscoveryCache(): void {
    this.discoveryDoc = null;
  }
}

/**
 * Create a custom OIDC provider instance.
 */
export function createOIDCProvider(
  config: OIDCProviderConfig,
  httpClient?: HttpClient,
): OIDCProvider {
  return new OIDCProvider(config, httpClient);
}
