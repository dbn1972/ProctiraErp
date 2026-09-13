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
} from './money/cents.js';
