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

/** Picks `page` / `pageSize`, dropping undefined and blank ('' / whitespace) values. */
function stripBlankPagination(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['page', 'pageSize'] as const) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Validates `page` / `pageSize` when either query param is present.
 * Skips validation when neither is supplied so handlers can apply their own defaults;
 * blank values are treated as absent and receive the schema defaults.
 */
export function validatePaginationQuery(query: Record<string, unknown>): PaginationQueryValidation {
  // PRC-L360: an empty string counts as "sent but blank" -> stripped, then defaulted,
  // so `?pageSize=` resolves to the platform default instead of skipping validation.
  const sent = query['page'] !== undefined || query['pageSize'] !== undefined;
  if (!sent) {
    return { success: true, skipped: true };
  }
  return validateIntegers(stripBlankPagination(query));
}

/**
 * Resolves pagination for list handlers with platform defaults and max caps applied.
 */
export function resolvePaginationQuery(
  query: Record<string, unknown>,
): ValidationResult<typeof PaginationSchema> {
  const input = stripBlankPagination(query);
  return validateIntegers({
    page: input['page'] ?? PAGINATION_DEFAULTS.PAGE,
    pageSize: input['pageSize'] ?? PAGINATION_DEFAULTS.PAGE_SIZE,
  });
}
