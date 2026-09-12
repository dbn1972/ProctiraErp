/**
 * Auth module public API.
 * Re-exports authentication utilities used by the web app.
 *
 * Note: server-only helpers (getSession, requireSession, authenticatedFetch)
 * are exported from `./server` and must be imported directly from there
 * (not via this barrel) so that client components don't accidentally pull
 * in `next/headers`.
 */
export {
  AUTH_COOKIES,
  AUTH_ENDPOINTS,
  OAUTH_PROVIDERS,
  decodeTokenPayload,
  isTokenExpired,
  getOAuthAuthorizeUrl,
  signIn,
  signOut,
  signUp,
  fetchSignupRoles,
  fetchSession,
  DEFAULT_TERMS_VERSION,
  DEFAULT_PRIVACY_VERSION,
  logout,
  verifyMfa,
  refreshAccessToken,
  requestPasswordReset,
  resetPassword,
} from './session';

export type {
  OAuthProvider,
  OAuthProviderConfig,
  SignInResult,
  SignupRole,
  SignUpRequest,
  SignUpResult,
  TermsAcceptancePayload,
  TokenPayload,
  ClientSessionSnapshot,
} from './session';

export {
  authUserFromTokenPayload,
  rolesFromTokenPayload,
  scopeFromTokenPayload,
  normaliseAuthRole,
} from './auth-user';
export type { AuthUserFromToken, AuthUserScope, AuthScopeLevel } from './auth-user';
export { sanitizeReturnTo } from './return-to';
