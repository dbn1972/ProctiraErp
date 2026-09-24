/**
 * A list read that says *why* it has no rows.
 *
 * ## The problem this exists for
 *
 * 126 reads across the app follow this shape:
 *
 *     const result = await gatewayFetch<{ data: T[] }>('/x', { throwOnError: false });
 *     return result.data?.data ?? [];
 *
 * `throwOnError: false` is deliberate — a dashboard should not white-screen because one
 * panel's upstream is down. Collapsing the outcome to `T[]` is the defect: it throws away
 * the only thing that distinguishes four completely different situations.
 *
 *   • 200 with no rows ....... there is genuinely nothing to show
 *   • 401 ..................... the session expired
 *   • 403 / 422 ............... this role is not permitted to see it
 *   • 5xx / network ........... the service is unavailable
 *
 * All four render as "No records found". That is not cosmetic. A 193-page capture of a
 * live deployment could not tell a permission boundary from an empty table without
 * opening each page's network log, and 42 pages showed an empty state whose cause was
 * unknown. Worse, it hides authorization drift: when a web guard and a backend service
 * disagree about a role, the user sees an empty list rather than a denial, so the
 * disagreement is never reported.
 *
 * ## What this does
 *
 * {@link fetchList} returns a discriminated result instead of a bare array, and logs
 * server-side when a list read fails. Callers that have not migrated keep working
 * unchanged — this is additive.
 *
 * The migration is incremental: `list-result.drift.test.ts` pins how many collapsing
 * reads remain, so the pattern cannot spread while the conversion proceeds.
 */
import { gatewayFetch, type GatewayRequestInit } from './gateway';

/** Why a list read produced no rows. */
export type ListFailureKind =
  /** 401 — no session, or it expired. */
  | 'unauthenticated'
  /** 403 or 422 — authenticated, but this role may not see this collection. */
  | 'denied'
  /** 404 — nothing is served at this path for this tenant or environment. */
  | 'missing'
  /** 5xx, a network error, or an unrecognised status. */
  | 'unavailable';

/** Pagination envelope, when the endpoint returns one. */
export interface ListMeta {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
}

export type ListResult<T> =
  | { ok: true; items: T[]; meta?: ListMeta }
  | {
      ok: false;
      kind: ListFailureKind;
      /** HTTP status, or 0 for a network-level failure. */
      status: number;
      /** Upstream error code when the gateway supplied one. */
      code?: string;
      /**
       * The gateway's `requestId` from the error body, when present.
       *
       * Carried so the panel can show a user something support can search for. The
       * gateway has always logged a request id and returned it as a header, but no client
       * read the header — so the only thing a user could quote was the status code, which
       * identifies a class of failure rather than the one that happened to them.
       */
      requestId?: string;
    };

/**
 * Map a transport outcome onto the four cases a screen has to tell apart.
 *
 * 422 is `denied`, not `unavailable`: `listPhiAccessLogs` in `./health` already treats
 * `401 | 403 | 422` as an access denial, and having two conventions for the same status
 * in the same layer is how the original confusion started.
 */
export function classifyListFailure(status: number): ListFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403 || status === 422) return 'denied';
  if (status === 404) return 'missing';
  return 'unavailable';
}

/**
 * Reduce a request path to a template, for logging.
 *
 * The interpolated path is not safe to log: the call sites this helper is aimed at build
 * paths like `/students/${id}/consents` and `/health/phi-access?studentId=…`, so the raw
 * value puts student identifiers into server logs. Numeric and uuid-shaped segments
 * become `:id` and the query string is dropped, which keeps the route identifiable
 * without naming a child.
 */
export function redactPath(path: string): string {
  const [withoutQuery] = path.split('?');
  return (withoutQuery ?? path)
    .split('/')
    .map((segment) =>
      /^[0-9]+$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
        ? ':id'
        : segment,
    )
    .join('/');
}

/**
 * Read a paginated collection, preserving the reason for an empty result.
 *
 * Accepts both envelope shapes in use — `{ data: T[], meta? }` and a bare `T[]`. A 204 or
 * a missing body is an *empty success*, not a failure: the gateway uses 204 for "nothing
 * applies here".
 */
export async function fetchList<T>(
  path: string,
  init: Omit<GatewayRequestInit, 'throwOnError'> = {},
): Promise<ListResult<T>> {
  const result = await gatewayFetch<{ data?: T[]; meta?: ListMeta } | T[]>(path, {
    ...init,
    throwOnError: false,
  });

  if (!result.ok) {
    const kind = classifyListFailure(result.status);
    // The whole point: a failed list read must leave a trace. Without this the only
    // record of a 403 was the absence of rows on the page.
    //
    // An expired token is routine, so it is a warning rather than an error; a denial or
    // an unavailable service is not.
    const line =
      `[list] ${redactPath(path)} failed: ${kind} (status ${result.status}` +
      `${result.error?.code ? `, ${result.error.code}` : ''})`;
    // eslint-disable-next-line no-console
    if (kind === 'unauthenticated') console.warn(line);
    // eslint-disable-next-line no-console
    else console.error(line);

    const failure: ListResult<T> = { ok: false, kind, status: result.status };
    const withCode = result.error?.code ? { ...failure, code: result.error.code } : failure;
    const requestId = readRequestId(result.error?.details);
    return requestId ? { ...withCode, requestId } : withCode;
  }

  const payload = result.data;
  if (Array.isArray(payload)) return { ok: true, items: payload };
  // Guard the inner envelope: a `{ data: { … } }` body would otherwise be returned as
  // `T[]` and throw on the caller's first `.length` or `.filter`.
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return payload?.meta ? { ok: true, items, meta: payload.meta } : { ok: true, items };
}

/**
 * Pull `requestId` out of the gateway error body.
 *
 * `gatewayFetch` puts the whole parsed body on `error.details`, so the id arrives here
 * without any change to the transport. Guarded rather than cast: `details` is `unknown`
 * and is `null` whenever the failure was a network reject or a non-JSON response.
 */
function readRequestId(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as { requestId?: unknown }).requestId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
