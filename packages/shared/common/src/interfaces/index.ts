/**
 * Core TypeScript interfaces for the ProctiraERP platform.
 */

/**
 * Options for paginated queries.
 */
export interface PaginationOptions {
  /** Page number (1-based) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Field to sort by */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated result wrapper for list endpoints.
 */
export interface PaginatedResult<T> {
  /** Array of items for the current page */
  data: T[];
  /** Pagination metadata */
  meta: {
    /** Current page number (1-based) */
    page: number;
    /** Number of items per page */
    pageSize: number;
    /** Total number of items across all pages */
    totalItems: number;
    /** Total number of pages */
    totalPages: number;
  };
}

/**
 * Field-level validation error detail.
 */
export interface FieldError {
  /** JSON path to the field (e.g., "body.email") */
  field: string;
  /** The validation rule that failed (e.g., "required", "format") */
  rule: string;
  /** Human-readable error message */
  message: string;
}

/**
 * Structured API error response.
 */
export interface ApiError {
  /** Machine-readable error code (e.g., "VALIDATION_ERROR", "NOT_FOUND") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** HTTP status code */
  statusCode: number;
  /** Array of field-level errors (for validation failures) */
  errors?: FieldError[];
}
