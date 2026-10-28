/**
 * OAuth2 Provider Base Implementation
 *
 * Provides a generic OAuth2 authentication flow that can be used
 * for Google, Microsoft, and other OAuth2-compatible providers.
 */
import { createHash, randomBytes } from 'node:crypto';

import { v4 as uuidv4 } from 'uuid';

import {
  parsePendingAuthState,
  PENDING_AUTH_STATE_TTL_SECONDS,
  pendingAuthStateKey,
  resolvePendingAuthStateStore,
} from './pending-auth-state.js';
import type {
  ExternalAuthProvider,
  OAuth2ProviderConfig,
  AuthInitiationResult,
  AuthCallbackParams,
  ExternalUserProfile,
  PendingAuthStateStore,
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
const FETCH_TIMEOUT_MS = 10_000;

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
      // PRC-M588: never hang the login path on a slow IdP.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

  /** PRC-M589: replica-shared pending state (state -> tenant + PKCE verifier). */
  private readonly stateStore: PendingAuthStateStore;

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
    this.stateStore = resolvePendingAuthStateStore(
      config.stateStore,
      `OAuth2 provider '${config.providerId}'`,
    );
  }

  /**
   * Initiate the OAuth2 authorization code flow.
   * Returns the authorization URL to redirect the user to.
   */
  async initiateAuth(tenantId: string): Promise<AuthInitiationResult> {
    const state = uuidv4();
    // PRC-M589: PKCE (S256) binds the code to this login attempt.
    const codeVerifier = randomBytes(48).toString('base64url');
    await this.stateStore.put(
      pendingAuthStateKey(this.providerId, state),
      JSON.stringify({ tenantId, codeVerifier }),
      PENDING_AUTH_STATE_TTL_SECONDS,
    );

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
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

    // Validate state (CSRF protection). PRC-M589: single-use take from the
    // shared store, so any replica can complete the login exactly once.
    const storedState = parsePendingAuthState<{ tenantId: string; codeVerifier: string }>(
      await this.stateStore.take(pendingAuthStateKey(this.providerId, params.state)),
      ['tenantId', 'codeVerifier'],
    );
    if (!storedState) {
      throw new ExternalAuthError(
        'Invalid or expired state parameter',
        this.providerId,
        'OAUTH2_INVALID_STATE',
      );
    }

    // Verify tenant matches
    if (storedState.tenantId !== tenantId) {
      throw new ExternalAuthError(
        'Tenant mismatch in OAuth2 callback',
        this.providerId,
        'OAUTH2_TENANT_MISMATCH',
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await this.exchangeCode(params.code, storedState.codeVerifier);
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
  private async exchangeCode(code: string, codeVerifier: string): Promise<Record<string, unknown>> {
    const response = await this.httpClient.post(this.config.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
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
}
