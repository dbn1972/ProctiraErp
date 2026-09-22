/**
 * Gateway pagination limits.
 *
 * ## Where the cap actually comes from
 *
 * `apps/api-gateway/src/plugins/pagination-cap.ts` registers a **root-level
 * `preHandler`** that validates `page`/`pageSize` on every GET before any domain
 * handler runs, via `validatePaginationQuery()` →
 * `PAGINATION_DEFAULTS.MAX_PAGE_SIZE`. Requests above it are rejected with:
 *
 *   400 VALIDATION_ERROR — "pageSize must be at most 100"
 *
 * Because it is a gateway-wide hook rather than a per-route schema, the ceiling is
 * the same for students, staff, institutions, attendance, examinations, lms and
 * registrations regardless of what their own schemas say. Two domain schemas are in
 * fact unreachable above 100 — `SkillListQuerySchema` declares `maximum: 200` and the
 * data-warehouse list schema `maximum: 1000` — so do not trust a route schema alone.
 *
 * The plugin's own header explains why it exists: many domain routes parse
 * `pageSize` with `Number(query.pageSize) || 20`, which bypasses schema maximums.
 * `packages/backend/institution/src/schemas.ts` is one of those — it declares
 * `maximum: 100` but the list handler never validates against it.
 *
 * `MAX_API_PAGE_SIZE` is re-exported from the same shared constant the gateway uses,
 * deliberately not a literal `100`, so the client cannot drift from the server.
 *
 * ## Why this needed a helper at all
 *
 * The list clients in this directory use `throwOnError: false` and `return []` on a
 * non-ok result, so an over-sized `pageSize` did not surface as an error — it
 * rendered as *no data*. 15 call sites asked for 200 or 500. Observed consequences:
 *
 *   • the dashboard reported "INSTITUTIONS 0" while the API returned 6
 *   • attendance, examinations and LMS pages showed empty states
 *
 * Clamping inside the clients rather than at each call site means a new caller
 * cannot reintroduce it by asking for more than the gateway allows.
 */
import { PAGINATION_DEFAULTS } from '@proctira/common';

/** The gateway's hard ceiling, from the same constant the gateway enforces. */
export const MAX_API_PAGE_SIZE = PAGINATION_DEFAULTS.MAX_PAGE_SIZE;

/** Default when a caller does not specify one. Matches the previous `?? 50`. */
export const DEFAULT_API_PAGE_SIZE = 50;

/**
 * Clamp a requested page size into the range the gateway accepts.
 *
 * A non-finite positive (`Infinity`) is treated as "as much as allowed" and clamps
 * to the maximum, not to the default — otherwise asking for everything would return
 * fewer rows than asking for a large finite number.
 *
 * **This returns one page.** Callers that must be exhaustive have to paginate;
 * returning the first page is better than returning nothing, but it is still a
 * partial answer. Anything building a complete picker or a total count must not rely
 * on this — see `listInstitutionsPage()` for a count that survives past 100.
 */
export function clampPageSize(requested?: number): number {
  if (requested === undefined || Number.isNaN(requested)) return DEFAULT_API_PAGE_SIZE;
  if (requested === Number.POSITIVE_INFINITY) return MAX_API_PAGE_SIZE;
  if (!Number.isFinite(requested)) return DEFAULT_API_PAGE_SIZE;
  const n = Math.floor(requested);
  if (n < 1) return 1;
  return Math.min(n, MAX_API_PAGE_SIZE);
}
