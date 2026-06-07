# Bundle Budget Baseline (Requirement 39 AC 1)

This file records the per-route initial-chunk gzip sizes captured from
`apps/web/.next/` when the `pnpm check:bundle` gate first landed (task 55.2 /
Design §J). It is a human-readable companion to `check-bundle-baseline.json`
and exists to make regression-by-regression review easy: the budget trend for
each named route should bend down over time, never up.

## How to refresh

```bash
pnpm --filter @proctira/web build
pnpm check:bundle --baseline
```

Both this file (manually) and `check-bundle-baseline.json` (auto-written) are
updated. The gate itself does not consult the baseline — it is informational
only — so refreshing the baseline never changes pass/fail behaviour.

## Current baseline

Captured on the build at `apps/web/.next/BUILD_ID` from the date in
`check-bundle-baseline.json`. All three named routes from Requirement 39 AC 1
are present in the App Router build and clear the 500 KB gzip budget.

| Route             | Initial chunks | Gzip total | Headroom to budget |
| ----------------- | -------------- | ---------- | ------------------ |
| `/auth/signin`    | 12             | 216.05 KB  | 295.95 KB          |
| `/app/dashboard`  | 10             | 125.39 KB  | 386.61 KB          |
| `/app/attendance` | 14             | 237.00 KB  | 275.00 KB          |

The budget is **500 KB gzip** per route (Requirement 39 AC 1).

## Route → Next.js manifest mapping

The script translates the requirement-level route names into the App Router
manifest keys that produce them. The mapping is the single source of truth
when the directory structure of `apps/web/src/app` changes; update
`DEFAULT_ROUTES` in `tools/scripts/check-bundle.mjs` and refresh the baseline.

| Requirement route | Next.js manifest keys                                            |
| ----------------- | ---------------------------------------------------------------- |
| `/auth/signin`    | `/layout`, `/(auth)/layout`, `/(auth)/login/page`                |
| `/app/dashboard`  | `/layout`, `/(dashboard)/layout`, `/(dashboard)/page`            |
| `/app/attendance` | `/layout`, `/(dashboard)/layout`, `/(dashboard)/attendance/page` |

## What "initial chunks" means

For each route the script:

1. Reads `.next/app-build-manifest.json`.
2. Looks up every chunk listed for the route's layout chain (root layout +
   route-group layout + the page itself). This mirrors what Next.js actually
   loads on first paint: layouts are not bundled into the page entry, they
   ship as their own chunks above it.
3. Deduplicates chunks shared between layouts and the page (otherwise a chunk
   used by two layout entries would inflate the budget without affecting the
   wire size; the browser only downloads each chunk once).
4. Reads each chunk file from `.next/static/`, gzips with `zlib.gzipSync`
   (level 9, matching the `apps/web/scripts/precompress.mjs` post-build
   step), and sums the result.

The `.next/build-manifest.json` (Pages Router) is read for diagnostic context
but does not contribute chunks — the unified app is App-Router-only.

## Routes that are not (yet) present

If a route's manifest keys do not resolve in the build, the script emits a
warning rather than failing the build (Requirement 39 AC 1 only binds routes
that actually exist in the current build). When new routes land, refresh this
document so the baseline tracks them.
