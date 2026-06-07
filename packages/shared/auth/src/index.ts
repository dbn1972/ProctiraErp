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

// Password strength scoring (Task 49.6)
export { scorePassword, scorePasswordDetails } from './scorePassword.js';
export type {
  PasswordRating,
  PasswordReason,
  PasswordReasonCode,
  PasswordScoreDetails,
} from './scorePassword.js';
