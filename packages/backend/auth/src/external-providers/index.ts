/**
 * External Identity Provider Integration
 *
 * Provides OAuth2, OIDC, and SAML authentication support for the ProctiraERP platform.
 *
 * Architecture:
 * - ExternalAuthProvider interface: abstraction for all provider types
 * - ProviderRegistry: manages registered providers
 * - OAuth2Provider: generic OAuth2 implementation (used by Google, Microsoft)
 * - OIDCProvider: OpenID Connect with configurable discovery URL
 * - SAMLProvider: SAML 2.0 identity provider support
 * - ExternalAuthHandler: orchestrates the full flow (auth → resolve user → issue JWT)
 * - External Auth Routes: Fastify routes for initiating and handling callbacks
 */

// Types
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
  PendingAuthStateStore,
  AssertionReplayStore,
} from './types.js';
export { ExternalAuthError } from './types.js';

// PRC-M589: replica-safe pending login state
export {
  MemoryAssertionReplayStore,
  PENDING_AUTH_STATE_TTL_SECONDS,
  RedisAssertionReplayStore,
  resolveAssertionReplayStore,
  resolvePendingAuthStateStore,
  SAML_ASSERTION_REPLAY_TTL_SECONDS,
} from './pending-auth-state.js';
export type { RedisLikeForAssertionReplay } from './pending-auth-state.js';
// Provider Registry
export { ProviderRegistry } from './provider-registry.js';

// OAuth2 Provider
export { OAuth2Provider, FetchHttpClient } from './oauth2-provider.js';
export type { HttpClient, UserInfoExtractor } from './oauth2-provider.js';

// Google Provider
export { createGoogleProvider, extractGoogleUserInfo } from './google-provider.js';
export type { GoogleProviderOptions } from './google-provider.js';

// Microsoft Provider
export { createMicrosoftProvider, extractMicrosoftUserInfo } from './microsoft-provider.js';
export type { MicrosoftProviderOptions } from './microsoft-provider.js';

// OIDC Provider
export { OIDCProvider, createOIDCProvider } from './oidc-provider.js';

// SAML Provider
export { SAMLProvider, DefaultSAMLResponseParser, createSAMLProvider } from './saml-provider.js';
export type { SAMLResponseParser, SAMLParsedResponse } from './saml-provider.js';
export { NodeSamlResponseParser } from './node-saml-response-parser.js';
export type { NodeSamlResponseParserOptions } from './node-saml-response-parser.js';

// External Auth Handler
export { ExternalAuthHandler } from './external-auth-handler.js';
export type {
  ExternalIdentityLink,
  ExternalIdentityStore,
  ExternalAuthUserLookup,
  ExternalAuthHandlerConfig,
  ExternalAuthResult,
} from './external-auth-handler.js';

// External Auth Routes
export { registerExternalAuthRoutes } from './external-auth-routes.js';
export type { ExternalAuthRoutesOptions } from './external-auth-routes.js';
