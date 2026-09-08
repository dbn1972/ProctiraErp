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

// JWT-only actor extraction (G-102 — never trust x-user-id / x-actor headers)
export { getActor } from './get-actor.js';
export type { Actor, ActorRequest } from './get-actor.js';

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
export type { LockoutStore, LockoutStatus, FailedAttempt, AccountLockout } from './lockout-service.js';
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
