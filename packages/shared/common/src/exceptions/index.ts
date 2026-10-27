/**
 * Typed exception classes for the ProctiraERP platform.
 * All exceptions extend AppError which provides structured error information.
 */
import { ErrorCode } from '../constants/index.js';
import type { FieldError } from '../interfaces/index.js';

/**
 * Base application error class.
 * All domain-specific exceptions extend this class.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly errors?: FieldError[];

  constructor(message: string, code: string, statusCode: number, errors?: FieldError[]) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize the error to a structured API error response.
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.errors && this.errors.length > 0 ? { errors: this.errors } : {}),
    };
  }
}

/**
 * Thrown when request payload validation fails.
 * HTTP 400 - Bad Request
 */
export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', errors: FieldError[] = []) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, errors);
  }
}

/**
 * Thrown when an operation conflicts with existing state (e.g., duplicate resource).
 * HTTP 409 - Conflict
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, ErrorCode.CONFLICT, 409);
  }
}

/**
 * Thrown when a requested resource is not found.
 * HTTP 404 - Not Found
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, ErrorCode.NOT_FOUND, 404);
  }
}

/**
 * Thrown when a business rule is violated.
 * HTTP 422 - Unprocessable Entity
 */
export class BusinessRuleError extends AppError {
  constructor(message: string = 'Business rule violation') {
    super(message, ErrorCode.BUSINESS_RULE_ERROR, 422);
  }
}

/**
 * Thrown when the caller is authenticated but lacks permission.
 * HTTP 403 - Forbidden
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

/**
 * PRC-L135: thrown when a request has no verified identity (e.g. a JWT with no `sub`
 * claim). Callers must never substitute a sentinel actor id (such as 'anonymous') and
 * proceed — this forces a fail-closed 401 instead. Code matches the existing inline
 * 'UNAUTHENTICATED' convention used by workflow/case-routes.ts, workflow/routes.ts and
 * assessment/report-card-routes.ts.
 * HTTP 401 - Unauthorized (unauthenticated).
 */
export class UnauthenticatedError extends AppError {
  constructor(message: string = 'Authentication is required') {
    super(message, 'UNAUTHENTICATED', 401);
  }
}
