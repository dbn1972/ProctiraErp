import { PAGINATION_DEFAULTS } from '@proctira/common';
import { Type, type TObject } from '@sinclair/typebox';

/**
 * Pagination query parameters schema.
 * Provides page and pageSize with sensible defaults and limits.
 */
export const PaginationSchema: TObject = Type.Object({
  page: Type.Number({
    minimum: 1,
    default: PAGINATION_DEFAULTS.PAGE,
    description: 'Page number (1-based)',
  }),
  pageSize: Type.Number({
    minimum: 1,
    maximum: PAGINATION_DEFAULTS.MAX_PAGE_SIZE,
    default: PAGINATION_DEFAULTS.PAGE_SIZE,
    description: `Number of items per page (max ${PAGINATION_DEFAULTS.MAX_PAGE_SIZE})`,
  }),
});
