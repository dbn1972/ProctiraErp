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
  meta?: { totalPages?: number; totalItems?: number };
}

/** Every row read, the list's total, and whether fewer rows were read than exist. */
export interface AllPagesResult<T> {
  items: T[];
  /** `meta.totalItems` from the gateway, never less than `items.length`. */
  totalItems: number;
  /** True when `items` holds fewer rows than `totalItems` (a later page failed, or the page cap). */
  truncated: boolean;
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
  return (await gatewayFetchAllPagesWithTotal<T>(path, init)).items;
}

/**
 * T-D2: {@link gatewayFetchAllPages} plus the list's total, so a list screen can
 * print the real count and say "Showing N of M" when it holds fewer rows.
 *
 * A first-page failure is `{ items: [], totalItems: 0, truncated: false }`: still a
 * denial-as-empty collapse, kept to preserve the callers' contract (converting them
 * to `fetchList` is separate). A later-page failure keeps the pages already read.
 */
export async function gatewayFetchAllPagesWithTotal<T>(
  path: string,
  init: Omit<GatewayRequestInit, 'method' | 'throwOnError'> = {},
): Promise<AllPagesResult<T>> {
  const separator = path.includes('?') ? '&' : '?';
  const items: T[] = [];
  let reportedTotal = 0;
  for (let page = 1; page <= MAX_AUTO_PAGES; page += 1) {
    const result = await gatewayFetch<PagedBody<T>>(
      `${path}${separator}page=${page}&pageSize=${MAX_API_PAGE_SIZE}`,
      { ...init, method: 'GET', throwOnError: false },
    );
    if (!result.ok || !result.data) {
      if (page === 1) return { items, totalItems: 0, truncated: false };
      break;
    }
    items.push(...(result.data.data ?? []));
    reportedTotal = result.data.meta?.totalItems ?? reportedTotal;
    const totalPages = result.data.meta?.totalPages;
    if (!totalPages || page >= totalPages) break;
  }
  const totalItems = Math.max(reportedTotal, items.length);
  return { items, totalItems, truncated: items.length < totalItems };
}
