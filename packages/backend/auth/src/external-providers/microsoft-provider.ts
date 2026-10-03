/**
 * Microsoft OAuth2 Provider
 *
 * Implements Microsoft OAuth2 authentication using Microsoft Identity Platform (v2.0).
 * Supports both personal Microsoft accounts and Azure AD organizational accounts.
 */
import { OAuth2Provider, type HttpClient, type UserInfoExtractor } from './oauth2-provider.js';
import type { OAuth2ProviderConfig, ExternalUserProfile } from './types.js';

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
  /**
   * PRC-M589: Azure AD tenant (directory) ID. Required — the multi-tenant
   * aliases 'common' / 'organizations' / 'consumers' are refused so only the
   * school's own directory can sign in.
   */
  tenantId: string;
  /** Additional scopes beyond the defaults */
  additionalScopes?: string[];
}

/**
 * Extract user profile from Microsoft Graph /me response.
 */
export const extractMicrosoftUserInfo: UserInfoExtractor = (
  data: Record<string, unknown>,
): ExternalUserProfile => microsoftProfile(data, undefined);

/**
 * PRC-M589: stable identity is `tid:oid`; Graph `mail`/UPN are not verified
 * claims, so `emailVerified` is false and email-based linking is disabled.
 */
function microsoftProfile(
  data: Record<string, unknown>,
  directoryId: string | undefined,
): ExternalUserProfile {
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
    externalId: directoryId ? `${directoryId}:${id}` : id,
    email,
    displayName: displayName ?? email,
    firstName: givenName ?? undefined,
    lastName: surname ?? undefined,
    rawAttributes: data,
    emailVerified: false,
  };
}

/**
 * Create a Microsoft OAuth2 provider instance.
 */
export function createMicrosoftProvider(
  options: MicrosoftProviderOptions,
  httpClient?: HttpClient,
): OAuth2Provider {
  const tenant = options.tenantId?.trim();
  if (!tenant || ['common', 'organizations', 'consumers'].includes(tenant.toLowerCase())) {
    throw new Error(
      'Microsoft provider requires a specific Azure AD tenant ID (multi-tenant endpoints are refused)',
    );
  }
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

  return new OAuth2Provider(config, (data) => microsoftProfile(data, tenant), httpClient);
}
