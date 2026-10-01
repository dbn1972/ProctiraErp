import { PAGINATION_DEFAULTS, type FieldError } from '@proctira/common';
import type { Static } from '@sinclair/typebox';

import { PaginationSchema } from './schemas/pagination.js';
import { validateQuery, type ValidationResult } from './validator.js';

export type ParsedPagination = Static<typeof PaginationSchema>;

export type PaginationQueryValidation =
  ValidationResult<typeof PaginationSchema> | { success: true; skipped: true };

/**
 * TypeBox `Value.Convert` truncates '1.5' (and 1.5) to 1 for Integer schemas, so
 * reject non-integer values before conversion (PRC-L359).
 */
function nonIntegerErrors(input: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];
  for (const [field, value] of Object.entries(input)) {
    const ok =
      typeof value === 'number'
        ? Number.isInteger(value)
        : typeof value === 'string' && /^[+-]?\d+$/.test(value.trim());
    if (!ok) {
      errors.push({ field, rule: 'integer', message: `${field} must be an integer` });
    }
  }
  return errors;
}

function validateIntegers(
  input: Record<string, unknown>,
): ValidationResult<typeof PaginationSchema> {
  const errors = nonIntegerErrors(input);
  if (errors.length > 0) return { success: false, errors };
  return validateQuery(PaginationSchema, input);
}

/**
 * Validates `page` / `pageSize` when either query param is present.
 * Skips validation when neither is supplied so handlers can apply their own defaults.
 */
export function validatePaginationQuery(query: Record<string, unknown>): PaginationQueryValidation {
  const hasPage = query['page'] !== undefined && query['page'] !== '';
  const hasPageSize = query['pageSize'] !== undefined && query['pageSize'] !== '';
  if (!hasPage && !hasPageSize) {
    return { success: true, skipped: true };
  }

  const input: Record<string, unknown> = {};
  if (hasPage) input['page'] = query['page'];
  if (hasPageSize) input['pageSize'] = query['pageSize'];
  return validateIntegers(input);
}

/**
 * Resolves pagination for list handlers with platform defaults and max caps applied.
 */
export function resolvePaginationQuery(
  query: Record<string, unknown>,
): ValidationResult<typeof PaginationSchema> {
  return validateIntegers({
    page: query['page'] ?? PAGINATION_DEFAULTS.PAGE,
    pageSize: query['pageSize'] ?? PAGINATION_DEFAULTS.PAGE_SIZE,
  });
}
