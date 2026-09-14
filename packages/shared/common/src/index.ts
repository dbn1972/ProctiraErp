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

// Utilities
export { CircuitBreaker, CircuitState, CircuitBreakerError } from './circuit-breaker.js';
export type { CircuitBreakerOptions } from './circuit-breaker.js';

export {
  majorUnitsToCents,
  centsToMajorUnits,
  assertMajorMatchesCents,
  pgIntegerCents,
  pgOptionalIntegerCents,
} from './money/cents.js';

// W1-ARCH-08: fail-closed production provider mode (sandbox opt-in only)
export {
  readProviderModeEnv,
  resolveProviderDeliveryMode,
  isSandboxProvidersExplicitlyAllowed,
} from './provider-mode-policy.js';
export type { ProviderDeliveryMode, ProviderModeEnv } from './provider-mode-policy.js';

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
