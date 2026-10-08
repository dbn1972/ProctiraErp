/**
 * @proctira/common - Shared types, interfaces, constants, schemas, and exceptions
 * for the ProctiraERP Unified Platform.
 */

// Interfaces
export type {
  PaginationOptions,
  PaginatedResult,
  FieldError,
  ApiError,
} from './interfaces/index.js';

// Schemas
export { FieldErrorSchema, ApiErrorSchema } from './schemas/index.js';
export type { FieldErrorType, ApiErrorType } from './schemas/index.js';

// Constants & Enums
export {
  EntityStatus,
  ErrorCode,
  EnrollmentStatus,
  AttendanceStatus,
  WorkflowStateType,
  PAGINATION_DEFAULTS,
  ERROR_CODE_REGISTRY,
  getErrorCodeDefinition,
  applyDeprecationHeaders,
  defaultSunsetDate,
} from './constants/index.js';
export type { ErrorCodeDefinition, DeprecationPolicy } from './constants/index.js';

// Exceptions
export {
  AppError,
  ValidationError,
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ForbiddenError,
} from './exceptions/index.js';

// PRC-H004: canonical school-scope rule (gateway hook + per-handler record checks)
export {
  BOARD_TENANT_ADMIN_ROLE_IDS,
  assertInstitutionInScope,
  isBoardOrTenantAdminPrincipal,
  isSchoolBoundPrincipal,
  principalInstitutions,
  principalRoleIds,
} from './institution-scope.js';
export type { InstitutionScopePrincipal } from './institution-scope.js';
// G-104 / PRC-M395: canonical platform-admin role ids (gateway + domain packages)
export { PLATFORM_ADMIN_ROLE_IDS, hasPlatformAdminRole } from './platform-admin-roles.js';
// Utilities
export { CircuitBreaker, CircuitState, CircuitBreakerError } from './circuit-breaker.js';
export type { CircuitBreakerOptions } from './circuit-breaker.js';

export {
  majorUnitsToCents,
  centsToMajorUnits,
  assertMajorMatchesCents,
  pgIntegerCents,
  pgOptionalIntegerCents,
  pgNumericMajorToCents,
  majorUnitsNumberFromCents,
} from './money/cents.js';
export type { MajorUnitsToCentsOptions } from './money/cents.js';

// W1-ARCH-08: fail-closed production provider mode (sandbox opt-in only)
export {
  readProviderModeEnv,
  resolveProviderDeliveryMode,
  isSandboxProvidersExplicitlyAllowed,
} from './provider-mode-policy.js';
export type { ProviderDeliveryMode, ProviderModeEnv } from './provider-mode-policy.js';

// PRC-L579: shared NODE_ENV interpretation for fail-closed guards
export { isProductionLike, isProductionNodeEnv, normalizeNodeEnv } from './node-env.js';

// PRC-C003 / PRC-M618 / g7_platform-001/002: shared SSRF-safe fetch for tenant-controlled URLs
export {
  SsrfError,
  safeFetch,
  assertPublicHttpsUrl,
  assertPublicHttpsUrlDefault,
  isDisallowedAddress,
} from './safe-fetch.js';
export type { SafeFetchOptions } from './safe-fetch.js';

// W1-ARCH-07: ordered SIGINT/SIGTERM shutdown (HTTP → resources → exit)
export {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  registerGracefulShutdown,
  resolveShutdownTimeoutMs,
  runShutdownSteps,
} from './graceful-shutdown.js';
export type {
  GracefulShutdownHandle,
  GracefulShutdownLogger,
  RegisterGracefulShutdownOptions,
  ShutdownStep,
} from './graceful-shutdown.js';
