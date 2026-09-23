/**
 * A list read that says *why* it has no rows.
 *
 * ## The problem this exists for
 *
 * 206 call sites across 28 files follow this shape:
 *
 *     const result = await gatewayFetch<{ data: T[] }>('/x', { throwOnError: false });
 *     return result.data?.data ?? [];
 *
 * `throwOnError: false` is deliberate — a dashboard should not white-screen because one
 * panel's upstream is down. But collapsing the outcome to `T[]` throws away the only
 * thing that distinguishes four completely different situations:
 *
 *   • 200 with no rows ....... there is genuinely nothing to show
 *   • 401 ..................... the session expired
 *   • 403 ..................... this role is not permitted to see it
 *   • 5xx / network ........... the service is unavailable
 *
 * All four render as "No records found". That is not a cosmetic problem. A 193-page
 * capture of a live deployment could not tell a permission boundary from an empty table
 * without opening each page's network log, and 42 pages showed an empty state whose
 * cause was unknown. Worse, it hides authorization drift: when the web guard and a
 * backend service disagree about a role, the user sees an empty list rather than a
 * denial, so the disagreement never gets reported.
 *
 * ## What this does
 *
 * {@link fetchList} returns a discriminated result instead of a bare array, and logs
 * server-side when a list read fails. Callers that have not migrated keep working
 * unchanged — this is additive.
 *
 * The migration is deliberately incremental: `list-result.drift.test.ts` records how
 * many of the collapsing call sites remain, so the pattern cannot spread while the
 * conversion proceeds.
 */
import { gatewayFetch, type GatewayRequestInit } from './gateway';

/** Why a list read produced no rows. */
export type ListFailureKind =
  /** 401 — no session, or it expired. */
  | 'unauthenticated'
  /** 403 — authenticated, but this role may not see this collection. */
  | 'denied'
  /** 404 — the collection itself does not exist upstream. */
  | 'missing'
  /** 5xx, a network error, or an unrecognised status. */
  | 'unavailable';

export type ListResult<T> =
  | { ok: true; items: T[] }
  | {
      ok: false;
      kind: ListFailureKind;
      /** HTTP status, or 0 for a network-level failure. */
      status: number;
      /** Upstream error code when the gateway supplied one. */
      code?: string;
    };

/** Map a transport outcome onto the four cases a screen has to tell apart. */
export function classifyListFailure(status: number): ListFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'denied';
  if (status === 404) return 'missing';
  return 'unavailable';
}

/**
 * Read a paginated collection, preserving the reason for an empty result.
 *
 * Accepts both envelope shapes in use: `{ data: T[] }` and a bare `T[]`. A 204 or a
 * missing body is an *empty success*, not a failure — the gateway uses 204 for
 * "nothing applies here".
 */
export async function fetchList<T>(
  path: string,
  init: Omit<GatewayRequestInit, 'throwOnError'> = {},
): Promise<ListResult<T>> {
  const result = await gatewayFetch<{ data?: T[] } | T[]>(path, {
    ...init,
    throwOnError: false,
  });

  if (!result.ok) {
    const kind = classifyListFailure(result.status);
    // The whole point: a failed list read must leave a trace. Without this the only
    // record of a 403 was the absence of rows on the page.
    // eslint-disable-next-line no-console
    console.error(
      `[list] ${path} failed: ${kind} (status ${result.status}${
        result.error?.code ? `, ${result.error.code}` : ''
      })`,
    );
    const failure: ListResult<T> = { ok: false, kind, status: result.status };
    return result.error?.code ? { ...failure, code: result.error.code } : failure;
  }

  const payload = result.data;
  if (Array.isArray(payload)) return { ok: true, items: payload };
  return { ok: true, items: payload?.data ?? [] };
}

/**
 * Collapse a result back to an array, for callers that have not migrated yet.
 *
 * Named to be conspicuous at the call site: choosing this is choosing to render a
 * denial as an empty table.
 */
export function itemsOrEmpty<T>(result: ListResult<T>): T[] {
  return result.ok ? result.items : [];
}
