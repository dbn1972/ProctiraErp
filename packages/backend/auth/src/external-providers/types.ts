/**
 * External Identity Provider Types
 *
 * Defines the abstraction layer for external authentication providers
 * (OAuth2, OIDC, SAML). New providers can be added by implementing
 * the ExternalAuthProvider interface.
 */

/**
 * Supported external provider types.
 */
export type ExternalProviderType = 'oauth2' | 'oidc' | 'saml';

/**
 * User profile returned by an external identity provider after successful authentication.
 */
export interface ExternalUserProfile {
  /** Provider-specific unique user identifier (e.g., Google sub, Microsoft oid) */
  externalId: string;
  /** User's email address */
  email: string;
  /** User's display name */
  displayName: string;
  /** User's first name (if available) */
  firstName?: string;
  /** User's last name (if available) */
  lastName?: string;
  /** URL to user's profile picture (if available) */
  avatarUrl?: string;
  /** Raw claims/attributes from the provider */
  rawAttributes: Record<string, unknown>;
}

/**
 * Result of initiating an external authentication flow.
 */
export interface AuthInitiationResult {
  /** URL to redirect the user to for authentication */
  redirectUrl: string;
  /** State parameter for CSRF protection */
  state: string;
  /** Nonce for OIDC (if applicable) */
  nonce?: string;
}

/**
 * Parameters received in the callback from the external provider.
 */
export interface AuthCallbackParams {
  /** Authorization code (OAuth2/OIDC) */
  code?: string;
  /** State parameter for CSRF validation */
  state?: string;
  /** Error from the provider */
  error?: string;
  /** Error description from the provider */
  errorDescription?: string;
  /** SAML response (base64 encoded) */
  samlResponse?: string;
  /** Relay state for SAML */
  relayState?: string;
}

/**
 * Configuration for an OAuth2 provider.
 */
export interface OAuth2ProviderConfig {
  type: 'oauth2';
  /** Unique provider identifier (e.g., 'google', 'microsoft') */
  providerId: string;
  /** Display name for the provider */
  displayName: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Authorization endpoint URL */
  authorizationUrl: string;
  /** Token endpoint URL */
  tokenUrl: string;
  /** User info endpoint URL */
  userInfoUrl: string;
  /** OAuth2 scopes to request */
  scopes: string[];
  /** Callback URL for this provider */
  callbackUrl: string;
}

/**
 * Configuration for an OIDC provider.
 */
export interface OIDCProviderConfig {
  type: 'oidc';
  /** Unique provider identifier */
  providerId: string;
  /** Display name for the provider */
  displayName: string;
  /** OIDC client ID */
  clientId: string;
  /** OIDC client secret */
  clientSecret: string;
  /** OIDC discovery URL (e.g., https://provider.com/.well-known/openid-configuration) */
  discoveryUrl: string;
  /** OIDC scopes to request */
  scopes: string[];
  /** Callback URL for this provider */
  callbackUrl: string;
  /** Response type (default: 'code') */
  responseType?: string;
}

/**
 * Configuration for a SAML identity provider.
 */
export interface SAMLProviderConfig {
  type: 'saml';
  /** Unique provider identifier */
  providerId: string;
  /** Display name for the provider */
  displayName: string;
  /** IdP SSO URL (where to send AuthnRequest) */
  entryPoint: string;
  /** IdP certificate for signature validation (PEM format) */
  idpCertificate: string;
  /** SP entity ID (our identifier) */
  issuer: string;
  /** Assertion Consumer Service URL (our callback) */
  callbackUrl: string;
  /** Name ID format */
  nameIdFormat?: string;
  /** Whether to sign AuthnRequests */
  signAuthnRequests?: boolean;
  /** SP private key for signing (PEM format) */
  privateKey?: string;
  /** SP certificate (PEM format) */
  certificate?: string;
  /** Attribute mapping from SAML attributes to profile fields */
  attributeMapping?: {
    email?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  };
}

/**
 * Union type for all provider configurations.
 */
export type ExternalProviderConfig = OAuth2ProviderConfig | OIDCProviderConfig | SAMLProviderConfig;

/**
 * Interface that all external auth providers must implement.
 * This abstraction allows new providers to be added easily.
 */
export interface ExternalAuthProvider {
  /** The provider's unique identifier */
  readonly providerId: string;
  /** The provider type */
  readonly type: ExternalProviderType;
  /** Display name for UI */
  readonly displayName: string;

  /**
   * Initiate the authentication flow.
   * Returns a URL to redirect the user to.
   */
  initiateAuth(tenantId: string): Promise<AuthInitiationResult>;

  /**
   * Handle the callback from the external provider.
   * Validates the response and extracts the user profile.
   *
   * @throws ExternalAuthError if validation fails
   */
  handleCallback(params: AuthCallbackParams, tenantId: string): Promise<ExternalUserProfile>;
}

/**
 * Error thrown when external authentication fails.
 */
export class ExternalAuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly providerId: string;

  constructor(
    message: string,
    providerId: string,
    code: string = 'EXTERNAL_AUTH_ERROR',
    statusCode: number = 401,
  ) {
    super(message);
    this.name = 'ExternalAuthError';
    this.code = code;
    this.providerId = providerId;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
