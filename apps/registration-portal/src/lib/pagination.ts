/**
 * Gateway pagination ceiling for the public registration portal.
 *
 * `apps/api-gateway/src/plugins/pagination-cap.ts` validates `page`/`pageSize` on
 * every GET in a root-level `preHandler`, before any domain handler runs, against
 * `PAGINATION_DEFAULTS.MAX_PAGE_SIZE`. `GET /registrations/institutions` is mounted on
 * that same gateway app, so the public school finder is subject to it.
 *
 * The school-finder page and the map both requested `pageSize: 200`, which the hook
 * rejected with `400 VALIDATION_ERROR`. Unlike the `apps/web` clients — which swallow
 * a non-ok result into `[]` — this client throws, so the page fell back to its
 * `initialError` state: a visible failure rather than a silent one, but the public map
 * was still broken.
 *
 * Re-exported from the shared constant rather than written as a literal so the client
 * cannot drift from the gateway.
 */
import { PAGINATION_DEFAULTS } from '@proctira/common';

/** Largest `pageSize` the gateway will accept on a list endpoint. */
export const MAX_PUBLIC_PAGE_SIZE = PAGINATION_DEFAULTS.MAX_PAGE_SIZE;
