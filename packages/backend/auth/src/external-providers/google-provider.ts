/**
 * Google OAuth2 Provider
 *
 * Implements Google OAuth2 authentication using Google's OAuth 2.0 endpoints.
 * Extracts user profile from Google's userinfo endpoint.
 */
import type { OAuth2ProviderConfig, ExternalUserProfile } from './types.js';
import { OAuth2Provider, type HttpClient, type UserInfoExtractor } from './oauth2-provider.js';

/** Google OAuth2 authorization endpoint */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Google OAuth2 token endpoint */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google userinfo endpoint */
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Default scopes for Google OAuth2 */
const GOOGLE_DEFAULT_SCOPES = ['openid', 'email', 'profile'];

/**
 * Configuration options for creating a Google OAuth2 provider.
 */
export interface GoogleProviderOptions {
  /** Google OAuth2 client ID */
  clientId: string;
  /** Google OAuth2 client secret */
  clientSecret: string;
  /** Callback URL for Google auth */
  callbackUrl: string;
  /** Additional scopes beyond the defaults */
  additionalScopes?: string[];
}

/**
 * Extract user profile from Google's userinfo response.
 */
export const extractGoogleUserInfo: UserInfoExtractor = (
  data: Record<string, unknown>,
): ExternalUserProfile => {
  const sub = data['sub'] as string | undefined;
  const email = data['email'] as string | undefined;
  const name = data['name'] as string | undefined;
  const givenName = data['given_name'] as string | undefined;
  const familyName = data['family_name'] as string | undefined;
  const picture = data['picture'] as string | undefined;

  if (!sub || !email) {
    throw new Error('Google userinfo response missing required fields (sub, email)');
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
};

/**
 * Create a Google OAuth2 provider instance.
 */
export function createGoogleProvider(
  options: GoogleProviderOptions,
  httpClient?: HttpClient,
): OAuth2Provider {
  const scopes = [...GOOGLE_DEFAULT_SCOPES, ...(options.additionalScopes ?? [])];

  const config: OAuth2ProviderConfig = {
    type: 'oauth2',
    providerId: 'google',
    displayName: 'Google',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    userInfoUrl: GOOGLE_USERINFO_URL,
    scopes,
    callbackUrl: options.callbackUrl,
  };

  return new OAuth2Provider(config, extractGoogleUserInfo, httpClient);
}
