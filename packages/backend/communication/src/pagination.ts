/**
 * PRC-M191: bounded list pagination for communication list routes.
 * `cursor` is an opaque offset token; stores fetch `limit + 1` rows to know
 * whether a next page exists.
 */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE: PageRequest = { limit: DEFAULT_PAGE_LIMIT, offset: 0 };

/** Parse `?limit=&cursor=`; returns null when either value is invalid (caller -> 400). */
export function parsePageQuery(query: unknown): PageRequest | null {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = DEFAULT_PAGE_LIMIT;
  let offset = 0;
  if (q.limit !== undefined) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) return null;
    limit = n;
  }
  if (q.cursor !== undefined) {
    const raw = String(q.cursor);
    if (!/^\d{1,9}$/.test(raw)) return null;
    offset = Number(raw);
  }
  return { limit, offset };
}

/** Trim a `limit + 1` fetch into a page. */
export function toPage<T>(rows: T[], page: PageRequest): Page<T> {
  const hasMore = rows.length > page.limit;
  return {
    data: hasMore ? rows.slice(0, page.limit) : rows,
    nextCursor: hasMore ? String(page.offset + page.limit) : null,
  };
}

/** In-memory helper: slice already-sorted rows to `limit + 1`. */
export function sliceForPage<T>(rows: T[], page: PageRequest): T[] {
  return rows.slice(page.offset, page.offset + page.limit + 1);
}

export const PAGE_QUERY_KEYS = ['limit', 'cursor'] as const;
