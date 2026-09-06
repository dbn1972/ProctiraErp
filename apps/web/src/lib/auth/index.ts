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
  DEFAULT_TERMS_VERSION,
  DEFAULT_PRIVACY_VERSION,
  logout,
  verifyMfa,
  resendMfa,
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
} from './session';

export { sanitizeReturnTo } from './return-to';
