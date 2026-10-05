/**
 * PRC-M337: bounded list pages for staff admissions list endpoints.
 */
import { ValidationError } from '@proctira/common';

export const MAX_LIST_PAGE_SIZE = 200;

export interface ListPage {
  limit: number;
  offset: number;
}

/** Parse `?limit=&offset=`; default and max page size is {@link MAX_LIST_PAGE_SIZE}. */
export function parseListPage(query: unknown): ListPage {
  const q = (query ?? {}) as { limit?: unknown; offset?: unknown };
  const limit = q.limit === undefined || q.limit === '' ? MAX_LIST_PAGE_SIZE : Number(q.limit);
  const offset = q.offset === undefined || q.offset === '' ? 0 : Number(q.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_PAGE_SIZE) {
    throw new ValidationError('Invalid page size', [
      {
        field: 'limit',
        rule: 'range',
        message: `limit must be an integer between 1 and ${MAX_LIST_PAGE_SIZE}`,
      },
    ]);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new ValidationError('Invalid page offset', [
      { field: 'offset', rule: 'range', message: 'offset must be a non-negative integer' },
    ]);
  }
  return { limit, offset };
}

/** Store helper: fetch `limit + 1` rows and split into page + hasMore. */
export function toPageResult<T>(
  rows: T[],
  page: ListPage,
): { data: T[]; pagination: ListPage & { hasMore: boolean } } {
  return {
    data: rows.slice(0, page.limit),
    pagination: { ...page, hasMore: rows.length > page.limit },
  };
}

/** In-memory equivalent of `LIMIT page.limit + 1 OFFSET page.offset`. */
export function sliceForPage<T>(rows: T[], page?: ListPage): T[] {
  return page ? rows.slice(page.offset, page.offset + page.limit + 1) : rows;
}
