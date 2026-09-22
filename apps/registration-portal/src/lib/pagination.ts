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
 * ## Why this is a literal and not an import
 *
 * The obvious form is `import { PAGINATION_DEFAULTS } from '@proctira/common'`, and
 * that is what `apps/web` does. It cannot be done here: this app sets
 * `transpilePackages: ['@proctira/i18n', '@proctira/common']` in `next.config`, which
 * makes webpack compile the package's TypeScript source instead of resolving its built
 * `dist`. That source barrel re-exports `./schemas/index.js`, and webpack cannot
 * resolve a `.js` specifier against a `.ts` file:
 *
 *   Module not found: Can't resolve './schemas/index.js'
 *
 * `apps/web` has no `transpilePackages`, so it resolves the compiled `dist` where the
 * `.js` files genuinely exist — which is why the same import works there and breaks
 * here. No other file in this app imports `@proctira/common`, so nothing had hit it.
 *
 * Drift is guarded by `pagination.test.ts`, which asserts this value equals
 * `PAGINATION_DEFAULTS.MAX_PAGE_SIZE`. Vitest resolves the package fine, so the check
 * lives where it can actually run.
 */

/**
 * Largest `pageSize` the gateway will accept on a list endpoint.
 *
 * Keep in sync with `PAGINATION_DEFAULTS.MAX_PAGE_SIZE`; `pagination.test.ts` fails if
 * this drifts.
 */
export const MAX_PUBLIC_PAGE_SIZE = 100;
