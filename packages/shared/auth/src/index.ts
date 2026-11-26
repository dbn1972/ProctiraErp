/**
 * @proctira/auth - Auth types, configuration, and shared utilities
 * for the ProctiraERP Unified Platform.
 */

// Types
export type {
  AuthUser,
  JwtPayload,
  TokenPair,
  RefreshToken,
  Session,
  RoleAssignment,
  AreaScope,
  AuthCredentials,
  AuthResult,
  LoginRequest,
  RefreshRequest,
  LogoutRequest,
  LogoutResponse,
} from './types.js';

// Configuration
export {
  createAuthConfig,
  MIN_ACCESS_TOKEN_EXPIRES,
  MAX_ACCESS_TOKEN_EXPIRES,
  DEFAULT_ACCESS_TOKEN_EXPIRES,
  MAX_REFRESH_TOKEN_LIFETIME,
  DEFAULT_REFRESH_TOKEN_LIFETIME,
  MIN_SESSION_DURATION,
  MAX_SESSION_DURATION,
  DEFAULT_SESSION_DURATION,
  DEFAULT_SALT_ROUNDS,
  MIN_JWT_SECRET_LENGTH,
  isProductionLike,
} from './config.js';
export type { AuthConfig } from './config.js';

// RBAC
export {
  evaluatePermission,
  hasPermission,
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
  DEFAULT_ROLES,
} from './rbac.js';
export type {
  Permission,
  PermissionAction,
  RoleDefinition,
  AreaNode,
  ResourceContext,
  PermissionEvaluationResult,
  AreaHierarchyResolver,
} from './rbac.js';

// JWKS access-token verification for BFF/console shells (PRC-L254, PRC-L202)
export {
  createJwksVerifier,
  decodeJwtUnverified,
  loadJwksVerifierConfig,
  resolveShellTokenVerification,
  verifyShellAccessToken,
  JwksTokenError,
  __resetShellTokenVerifierCache,
} from './jwks-verifier.js';
export type {
  JwksVerifier,
  JwksVerifierConfig,
  JwksTokenErrorCode,
  ShellTokenResult,
  ShellTokenVerification,
  VerifiedJwtClaims,
  VerifyOptions,
} from './jwks-verifier.js';
// Hostel / transport staff grants shared by the gateway and web registries (H-D2, T-O1)
export {
  applyCampusDomainRoleGrants,
  CAMPUS_BASE_READ_ROLE_IDS,
  CAMPUS_DOMAIN_ROLE_GRANTS,
  CAMPUS_READ_ONLY_ROLE_IDS,
  HOSTEL_STAFF_ROLE_IDS,
  TRANSPORT_STAFF_ROLE_IDS,
} from './campus-domain-roles.js';
export type { CampusDomainRoleGrant } from './campus-domain-roles.js';
// Finance role fees grants shared by the gateway and web registries (F-D3)
export {
  applyFeesDomainRoleGrants,
  FEES_BASE_READ_ROLE_IDS,
  FEES_DOMAIN_ROLE_GRANTS,
  FEES_READ_ONLY_ROLE_IDS,
  FEES_STAFF_ROLE_IDS,
} from './fees-domain-roles.js';
// Registrar admissions grants shared by the gateway and web registries (UATENV-D19)
export {
  ADMISSIONS_DOMAIN_ROLE_GRANTS,
  ADMISSIONS_LOOKUP_GRANTS,
  ADMISSIONS_STAFF_ROLE_IDS,
  applyAdmissionsDomainRoleGrants,
  applyAdmissionsLookupReadGrants,
} from './admissions-domain-roles.js';
// Role-id spelling normalisation against the role catalogue (PRC-M015)
export { canonicalRoleId, ROLE_ID_SYNONYMS } from './role-catalogue.js';
// Password strength scoring (Task 49.6)
export { scorePassword, scorePasswordDetails } from './scorePassword.js';
export type {
  PasswordRating,
  PasswordReason,
  PasswordReasonCode,
  PasswordScoreDetails,
} from './scorePassword.js';
