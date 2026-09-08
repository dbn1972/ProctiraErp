/**
 * OAuth2 Provider Base Implementation
 *
 * Provides a generic OAuth2 authentication flow that can be used
 * for Google, Microsoft, and other OAuth2-compatible providers.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  ExternalAuthProvider,
  OAuth2ProviderConfig,
  AuthInitiationResult,
  AuthCallbackParams,
  ExternalUserProfile,
} from './types.js';
import { ExternalAuthError } from './types.js';

/**
 * Interface for making HTTP requests (allows testing without real HTTP calls).
 */
export interface HttpClient {
  post(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }>;
  get(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }>;
}

/**
 * Simple fetch-based HTTP client implementation.
 */
export class FetchHttpClient implements HttpClient {
  async post(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(body).toString(),
    });
    const data = (await response.json()) as Record<string, unknown>;
    return { data, status: response.status };
  }

  async get(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ data: Record<string, unknown>; status: number }> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...headers },
    });
    const data = (await response.json()) as Record<string, unknown>;
    return { data, status: response.status };
  }
}

/**
 * Function to extract user profile from provider-specific user info response.
 * Each OAuth2 provider may return user info in a different format.
 */
export type UserInfoExtractor = (data: Record<string, unknown>) => ExternalUserProfile;

/**
 * Generic OAuth2 provider implementation.
 * Handles the authorization code flow for any OAuth2-compatible provider.
 */
export class OAuth2Provider implements ExternalAuthProvider {
  readonly providerId: string;
  readonly type = 'oauth2' as const;
  readonly displayName: string;

  private readonly config: OAuth2ProviderConfig;
  private readonly httpClient: HttpClient;
  private readonly extractUserInfo: UserInfoExtractor;

  // Store state tokens for CSRF validation (in production, use Redis/DB)
  private readonly pendingStates = new Map<string, { tenantId: string; createdAt: number }>();

  constructor(
    config: OAuth2ProviderConfig,
    extractUserInfo: UserInfoExtractor,
    httpClient?: HttpClient,
  ) {
    this.config = config;
    this.providerId = config.providerId;
    this.displayName = config.displayName;
    this.extractUserInfo = extractUserInfo;
    this.httpClient = httpClient ?? new FetchHttpClient();
  }

  /**
   * Initiate the OAuth2 authorization code flow.
   * Returns the authorization URL to redirect the user to.
   */
  async initiateAuth(tenantId: string): Promise<AuthInitiationResult> {
    const state = uuidv4();

    // Store state for CSRF validation
    this.pendingStates.set(state, { tenantId, createdAt: Date.now() });

    // Clean up old states (older than 10 minutes)
    this.cleanupStates();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    const redirectUrl = `${this.config.authorizationUrl}?${params.toString()}`;

    return { redirectUrl, state };
  }

  /**
   * Handle the OAuth2 callback.
   * Exchanges the authorization code for tokens and fetches user info.
   */
  async handleCallback(params: AuthCallbackParams, tenantId: string): Promise<ExternalUserProfile> {
    // Check for provider errors
    if (params.error) {
      throw new ExternalAuthError(
        params.errorDescription ?? `OAuth2 error: ${params.error}`,
        this.providerId,
        'OAUTH2_PROVIDER_ERROR',
      );
    }

    // Validate required parameters
    if (!params.code) {
      throw new ExternalAuthError(
        'Authorization code is missing from callback',
        this.providerId,
        'OAUTH2_MISSING_CODE',
      );
    }

    if (!params.state) {
      throw new ExternalAuthError(
        'State parameter is missing from callback',
        this.providerId,
        'OAUTH2_MISSING_STATE',
      );
    }

    // Validate state (CSRF protection)
    const storedState = this.pendingStates.get(params.state);
    if (!storedState) {
      throw new ExternalAuthError(
        'Invalid or expired state parameter',
        this.providerId,
        'OAUTH2_INVALID_STATE',
      );
    }

    // Remove used state
    this.pendingStates.delete(params.state);

    // Verify tenant matches
    if (storedState.tenantId !== tenantId) {
      throw new ExternalAuthError(
        'Tenant mismatch in OAuth2 callback',
        this.providerId,
        'OAUTH2_TENANT_MISMATCH',
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await this.exchangeCode(params.code);
    const accessToken = tokenResponse['access_token'] as string;

    if (!accessToken) {
      throw new ExternalAuthError(
        'Failed to obtain access token from provider',
        this.providerId,
        'OAUTH2_TOKEN_EXCHANGE_FAILED',
      );
    }

    // Fetch user info
    const userInfo = await this.fetchUserInfo(accessToken);

    return userInfo;
  }

  /**
   * Exchange authorization code for access token.
   */
  private async exchangeCode(code: string): Promise<Record<string, unknown>> {
    const response = await this.httpClient.post(this.config.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.callbackUrl,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (response.status !== 200) {
      throw new ExternalAuthError(
        `Token exchange failed with status ${response.status}`,
        this.providerId,
        'OAUTH2_TOKEN_EXCHANGE_FAILED',
      );
    }

    return response.data;
  }

  /**
   * Fetch user info from the provider's user info endpoint.
   */
  private async fetchUserInfo(accessToken: string): Promise<ExternalUserProfile> {
    const response = await this.httpClient.get(this.config.userInfoUrl, {
      Authorization: `Bearer ${accessToken}`,
    });

    if (response.status !== 200) {
      throw new ExternalAuthError(
        `User info request failed with status ${response.status}`,
        this.providerId,
        'OAUTH2_USERINFO_FAILED',
      );
    }

    return this.extractUserInfo(response.data);
  }

  /**
   * Clean up expired state tokens (older than 10 minutes).
   */
  private cleanupStates(): void {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [state, data] of this.pendingStates.entries()) {
      if (data.createdAt < tenMinutesAgo) {
        this.pendingStates.delete(state);
      }
    }
  }
}
