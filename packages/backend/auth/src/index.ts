/**
 * @proctira/backend-auth - Authentication service for the ProctiraERP platform.
 *
 * Provides:
 * - Fastify auth plugin with @fastify/jwt
 * - Local credential authentication with bcrypt
 * - Token service (JWT issuance, refresh rotation, revocation)
 * - Session service (creation, validation, invalidation)
 * - Account lockout service (failure tracking, lockout, auto-unlock)
 * - RBAC plugin with route-level permission checks
 * - PostgreSQL stores for refresh tokens and sessions
 * - Auth routes (login, refresh, logout, me)
 */

// Auth Plugin
export { authPlugin } from './auth-plugin.js';
export type { AuthPluginOptions } from './auth-plugin.js';

// RBAC Plugin
export { rbacPlugin } from './rbac-plugin.js';
export type { RbacPluginOptions } from './rbac-plugin.js';

// RBAC Evaluator (re-exports from @proctira/auth)
export {
  evaluatePermission,
  hasPermission,
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
  DEFAULT_ROLES,
} from './rbac-evaluator.js';
export type {
  Permission,
  PermissionAction,
  RoleDefinition,
  AreaNode,
  ResourceContext,
  PermissionEvaluationResult,
  AreaHierarchyResolver,
} from './rbac-evaluator.js';

// Local Auth
export { hashPassword, verifyPassword } from './local-auth.js';

// Token Service
export { TokenService, InvalidRefreshTokenError } from './token-service.js';
export type { JwtSigner, RefreshTokenStore } from './token-service.js';

// Session Service
export { SessionService } from './session-service.js';
export type { SessionStore } from './session-service.js';

// Account Lockout Service
export { AccountLockoutService } from './lockout-service.js';
export type {
  LockoutStore,
  LockoutStatus,
  FailedAttempt,
  AccountLockout,
} from './lockout-service.js';
export { InMemoryLockoutStore } from './lockout-store.js';

// PostgreSQL Stores
export { PrismaRefreshTokenStore } from './refresh-token-store.js';
export { PrismaSessionStore } from './session-store.js';

// Routes
export { registerAuthRoutes } from './routes.js';
export type { AuthRoutesOptions, UserLookup } from './routes.js';

// External Identity Providers (OAuth2, OIDC, SAML)
export {
  // Types
  ExternalAuthError,
  // Registry
  ProviderRegistry,
  // Providers
  OAuth2Provider,
  FetchHttpClient,
  createGoogleProvider,
  extractGoogleUserInfo,
  createMicrosoftProvider,
  extractMicrosoftUserInfo,
  OIDCProvider,
  createOIDCProvider,
  SAMLProvider,
  DefaultSAMLResponseParser,
  createSAMLProvider,
  // Handler
  ExternalAuthHandler,
  // Routes
  registerExternalAuthRoutes,
} from './external-providers/index.js';

export type {
  ExternalProviderType,
  ExternalUserProfile,
  AuthInitiationResult,
  AuthCallbackParams,
  OAuth2ProviderConfig,
  OIDCProviderConfig,
  SAMLProviderConfig,
  ExternalProviderConfig,
  ExternalAuthProvider,
  HttpClient,
  UserInfoExtractor,
  GoogleProviderOptions,
  MicrosoftProviderOptions,
  SAMLResponseParser,
  SAMLParsedResponse,
  ExternalIdentityLink,
  ExternalIdentityStore,
  ExternalAuthUserLookup,
  ExternalAuthHandlerConfig,
  ExternalAuthResult,
  ExternalAuthRoutesOptions,
} from './external-providers/index.js';

// Optional Keycloak IdP (env-gated at gateway; local JWT remains default)
export { keycloakAuthPlugin } from './keycloak/plugin.js';
export type { KeycloakAuthPluginOptions } from './keycloak/plugin.js';
export { registerKeycloakAuthRoutes } from './keycloak/routes.js';
export type { KeycloakRouteConfig } from './keycloak/routes.js';
export {
  KEYCLOAK_PROVIDER,
  KeycloakIdentityError,
  InMemoryKeycloakIdentityStore,
  identityInputFromClaims,
  linkKeycloakIdentity,
} from './keycloak/identity.js';
export type {
  KeycloakIdentityInput,
  KeycloakIdentityStore,
  LinkedKeycloakUser,
} from './keycloak/identity.js';
export {
  KEYCLOAK_REALM_ROLES,
  extractKeycloakRoleNames,
  keycloakRoleCatalog,
  mapKeycloakRoles,
} from './keycloak/roles.js';
export type { KeycloakRealmRole } from './keycloak/roles.js';
export {
  KeycloakJwksClient,
  KeycloakTokenError,
  decodeJwt,
  loadKeycloakAuthConfig,
  verifyKeycloakAccessToken,
  verifyRs256,
} from './keycloak/verify.js';
export type { KeycloakAccessClaims, KeycloakAuthConfig } from './keycloak/verify.js';

// Invites (in-memory by default)
export {
  InviteUserInputSchema,
  InviteUserResponseSchema,
  validateInviteUserInput,
  createUserInviteRepository,
  InviteService,
  InMemoryUserInviteRepository,
  registerInviteAndTenantDirectoryRoutes,
} from './invite/index.js';
export type {
  InviteUserInput,
  InviteUserResponse,
  InviteValidationError,
  InviteServiceOptions,
  InviteRoutesOptions,
  InviteRepositoryConfig,
  UserInviteRepository,
  UserInviteEntity,
  InviteStatus,
  InviteEmailSender,
} from './invite/index.js';

// MFA OTP (in-memory store; Twilio SMS when TWILIO_* set — not claimed live without secrets)
export {
  OtpService,
  InMemoryOtpChallengeStore,
  hashOtpCode,
  generateOtpCode,
  OtpValidationError,
  OtpAuthError,
} from './otp-service.js';
export type {
  OtpChallengeRecord,
  OtpChallengeStore,
  OtpServiceOptions,
  SendOtpResult,
  VerifyOtpResult,
} from './otp-service.js';
export { registerMfaRoutes } from './mfa-routes.js';
export type { MfaRoutesOptions } from './mfa-routes.js';
export { ConsoleSmsProvider, TwilioSmsProvider, createSmsProviderFromEnv } from './sms-provider.js';
export type { SmsMessage, SmsProvider, TwilioSmsProviderOptions } from './sms-provider.js';
