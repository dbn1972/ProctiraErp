/**
 * Microsoft OAuth2 Provider
 *
 * Implements Microsoft OAuth2 authentication using Microsoft Identity Platform (v2.0).
 * Supports both personal Microsoft accounts and Azure AD organizational accounts.
 */
import type { OAuth2ProviderConfig, ExternalUserProfile } from './types.js';
import { OAuth2Provider, type HttpClient, type UserInfoExtractor } from './oauth2-provider.js';

/** Microsoft OAuth2 authorization endpoint (common tenant for multi-tenant) */
const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

/** Microsoft OAuth2 token endpoint */
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/** Microsoft Graph userinfo endpoint */
const MICROSOFT_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

/** Default scopes for Microsoft OAuth2 */
const MICROSOFT_DEFAULT_SCOPES = ['openid', 'email', 'profile', 'User.Read'];

/**
 * Configuration options for creating a Microsoft OAuth2 provider.
 */
export interface MicrosoftProviderOptions {
  /** Microsoft OAuth2 client ID (Application ID) */
  clientId: string;
  /** Microsoft OAuth2 client secret */
  clientSecret: string;
  /** Callback URL for Microsoft auth */
  callbackUrl: string;
  /** Azure AD tenant ID (use 'common' for multi-tenant, 'organizations' for work accounts only) */
  tenantId?: string;
  /** Additional scopes beyond the defaults */
  additionalScopes?: string[];
}

/**
 * Extract user profile from Microsoft Graph /me response.
 */
export const extractMicrosoftUserInfo: UserInfoExtractor = (
  data: Record<string, unknown>,
): ExternalUserProfile => {
  const id = data['id'] as string | undefined;
  const mail = data['mail'] as string | undefined;
  const userPrincipalName = data['userPrincipalName'] as string | undefined;
  const displayName = data['displayName'] as string | undefined;
  const givenName = data['givenName'] as string | undefined;
  const surname = data['surname'] as string | undefined;

  const email = mail ?? userPrincipalName;

  if (!id || !email) {
    throw new Error(
      'Microsoft userinfo response missing required fields (id, mail/userPrincipalName)',
    );
  }

  return {
    externalId: id,
    email,
    displayName: displayName ?? email,
    firstName: givenName ?? undefined,
    lastName: surname ?? undefined,
    rawAttributes: data,
  };
};

/**
 * Create a Microsoft OAuth2 provider instance.
 */
export function createMicrosoftProvider(
  options: MicrosoftProviderOptions,
  httpClient?: HttpClient,
): OAuth2Provider {
  const tenant = options.tenantId ?? 'common';
  const scopes = [...MICROSOFT_DEFAULT_SCOPES, ...(options.additionalScopes ?? [])];

  const authUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const config: OAuth2ProviderConfig = {
    type: 'oauth2',
    providerId: 'microsoft',
    displayName: 'Microsoft',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorizationUrl: authUrl,
    tokenUrl: tokenUrl,
    userInfoUrl: MICROSOFT_USERINFO_URL,
    scopes,
    callbackUrl: options.callbackUrl,
  };

  return new OAuth2Provider(config, extractMicrosoftUserInfo, httpClient);
}
