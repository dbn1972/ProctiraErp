/**
 * Exhaustive list reads through the gateway (PRC-L074).
 *
 * Several detail-page clients asked for `pageSize=100` and returned only
 * `.data`, so the 101st assignment, appraisal, certification or enrolment was
 * silently dropped. The gateway caps `pageSize` at `MAX_API_PAGE_SIZE`
 * (see ./pagination.ts), so the only way to be complete is to follow
 * `meta.totalPages`.
 */
import { gatewayFetch, type GatewayRequestInit } from './gateway';
import { MAX_API_PAGE_SIZE } from './pagination';

/** Hard stop so a bad `totalPages` cannot turn into an unbounded loop. */
export const MAX_AUTO_PAGES = 50;

interface PagedBody<T> {
  data?: T[];
  meta?: { totalPages?: number };
}

/**
 * Read every page of a list endpoint. `path` must not carry `page` or `pageSize`.
 * Returns `[]` when the first page fails (matching the previous clients); if a
 * later page fails, the pages already read are returned rather than nothing.
 */
export async function gatewayFetchAllPages<T>(
  path: string,
  init: Omit<GatewayRequestInit, 'method' | 'throwOnError'> = {},
): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?';
  const items: T[] = [];
  for (let page = 1; page <= MAX_AUTO_PAGES; page += 1) {
    const result = await gatewayFetch<PagedBody<T>>(
      `${path}${separator}page=${page}&pageSize=${MAX_API_PAGE_SIZE}`,
      { ...init, method: 'GET', throwOnError: false },
    );
    if (!result.ok || !result.data) {
      // Still a denial-as-empty collapse (counted by list-result.drift.test.ts),
      // kept to preserve the callers' contract; converting them to fetchList is separate.
      if (page === 1) return [];
      break;
    }
    items.push(...(result.data.data ?? []));
    const totalPages = result.data.meta?.totalPages;
    if (!totalPages || page >= totalPages) break;
  }
  return items;
}
