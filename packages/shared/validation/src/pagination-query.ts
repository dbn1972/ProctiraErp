import { PAGINATION_DEFAULTS } from '@proctira/common';
import type { Static } from '@sinclair/typebox';

import { PaginationSchema } from './schemas/pagination.js';
import { validateQuery, type ValidationResult } from './validator.js';

export type ParsedPagination = Static<typeof PaginationSchema>;

export type PaginationQueryValidation =
  | ValidationResult<ParsedPagination>
  | { success: true; skipped: true };

/**
 * Validates `page` / `pageSize` when either query param is present.
 * Skips validation when neither is supplied so handlers can apply their own defaults.
 */
export function validatePaginationQuery(
  query: Record<string, unknown>,
): PaginationQueryValidation {
  const hasPage = query['page'] !== undefined && query['page'] !== '';
  const hasPageSize = query['pageSize'] !== undefined && query['pageSize'] !== '';
  if (!hasPage && !hasPageSize) {
    return { success: true, skipped: true };
  }

  const input: Record<string, unknown> = {};
  if (hasPage) input['page'] = query['page'];
  if (hasPageSize) input['pageSize'] = query['pageSize'];
  return validateQuery(PaginationSchema, input);
}

/**
 * Resolves pagination for list handlers with platform defaults and max caps applied.
 */
export function resolvePaginationQuery(
  query: Record<string, unknown>,
): ValidationResult<ParsedPagination> {
  return validateQuery(PaginationSchema, {
    page: query['page'] ?? PAGINATION_DEFAULTS.PAGE,
    pageSize: query['pageSize'] ?? PAGINATION_DEFAULTS.PAGE_SIZE,
  });
}
