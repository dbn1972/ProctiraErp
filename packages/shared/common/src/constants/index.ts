/**
 * Shared constants and enums for the ProctiraERP platform.
 */

/**
 * Entity status values used across all domain entities.
 */
export enum EntityStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

/**
 * Standard error codes returned in API error responses.
 */
export enum ErrorCode {
  /** Request payload failed schema validation */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Requested resource was not found */
  NOT_FOUND = 'NOT_FOUND',
  /** Operation conflicts with existing state (e.g., duplicate) */
  CONFLICT = 'CONFLICT',
  /** Business rule violation */
  BUSINESS_RULE_ERROR = 'BUSINESS_RULE_ERROR',
  /** Authentication required or token invalid */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** Authenticated user lacks permission */
  FORBIDDEN = 'FORBIDDEN',
  /** Unexpected server error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** Rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  /** Service unavailable */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

/**
 * Student enrollment status values.
 */
export enum EnrollmentStatus {
  ENROLLED = 'ENROLLED',
  TRANSFERRED = 'TRANSFERRED',
  WITHDRAWN = 'WITHDRAWN',
  GRADUATED = 'GRADUATED',
}

/**
 * Attendance status values.
 */
export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  EXCUSED = 'EXCUSED',
  /** Present-partial: 0.5 weight in attendance % numerator (G-919). */
  EARLY_DEPARTURE = 'EARLY_DEPARTURE',
}

/**
 * Workflow state types.
 */
export enum WorkflowStateType {
  INITIAL = 'INITIAL',
  INTERMEDIATE = 'INTERMEDIATE',
  FINAL = 'FINAL',
}

/**
 * Default pagination values.
 */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

export {
  ERROR_CODE_REGISTRY,
  getErrorCodeDefinition,
  applyDeprecationHeaders,
  defaultSunsetDate,
} from './error-code-registry.js';
export type { ErrorCodeDefinition, DeprecationPolicy } from './error-code-registry.js';
