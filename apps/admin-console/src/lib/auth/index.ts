/**
 * Public auth API for the admin console.
 * Server-only helpers (`getSession`, `requireSession`, `requireRole`) are
 * exported separately from `./server` to avoid pulling `next/headers` into
 * client bundles.
 */
export {
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABELS,
  AREA_ROLES,
  hasRole,
} from './roles';
export type { PlatformRole, AdminArea } from './roles';

export {
  decodeAdminToken,
  isAdminTokenExpired,
} from './session';
export type { AdminTokenPayload } from './session';

export {
  ADMIN_AUTH_COOKIES,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  clearCookieOptions,
  getAuthServiceUrl,
} from './cookies';
export type { AuthCookieOptions } from './cookies';

export { signIn, signOut, ADMIN_AUTH_ENDPOINTS } from './client';
export type { AdminSignInResult } from './client';
