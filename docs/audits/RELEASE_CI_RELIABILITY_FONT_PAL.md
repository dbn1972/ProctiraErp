# Enterprise release / ops checklist

**Slice / PR:** CI reliability — self-hosted Inter + PAL plan lookup cache  
**Branch / tip SHA:** `cursor/ci-reliability-font-pal-86dd` (tip recorded at commit)  
**Base branch:** `main`  
**Date (UTC):** 2026-09-27

Copy of `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md`.

---

## 1. Pre-merge

| Check                                               | Pass | Evidence                                                                                                 |
| --------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| Tip CI all required checks SUCCESS on **this** SHA  | ☐    | Verified in the PR before squash. Not claimed from this file.                                            |
| Migrations listed + apply order                     | ☑    | None. App-only.                                                                                          |
| External providers: sandbox honesty or live secrets | ☑    | Removes the build-time dependency on fonts.googleapis.com. No new live secrets.                          |
| Feature flags / kill switches (if any)              | ☑    | None.                                                                                                    |
| Deploy path understood (or N/A docs-only)           | ☑    | App-only (`apps/web`, `apps/public-website`). Next image rebuild picks up local fonts. No schema deploy. |
| No secrets / large binary dumps in commit           | ☑    | OFL-licensed Inter woff2 only (latin subsets).                                                           |
| Scoreboard / audits updated                         | ☑    | This note. No Wave scoreboard claim.                                                                     |

## 2. Merge

| Action                               | Done |
| ------------------------------------ | ---- |
| PR ready (not stale draft)           | ☐    |
| Merge strategy noted (squash/rebase) | ☑    | Squash only after CI Aggregate (Required) and the E2E aggregator are SUCCESS on the same tip. |
| Main tip CI watched after merge      | ☐    |

## 3. Rollback

| Scenario        | Plan / owner                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| App regression  | Revert the squash commit. Fonts fall back to the previous `next/font/google` loader; PAL reads return to `revalidate: 0`. |
| Bad migration   | N/A — no migration.                                                                                                       |
| Provider outage | Fonts are self-hosted. A Google Fonts outage no longer fails `next build`.                                                |

## 4. Sign-off

**Ship claim:** ☐ Not ready until tip CI (CI Aggregate and E2E aggregator) is SUCCESS on the squash commit.

**False-claim ban:** ☑ Tip SHA + Done-when cited — no Wave‑N / N/N COMPLETE claim from docs-only or stale ledger

**Waivers:** None. Local evidence only: web + public-website `tsc`, eslint on edited sources (pre-existing brand-string warnings in web metadata), prettier, vitest `gateway.test.ts` + `font-stack.test.ts`, `next build` for both apps with no `fonts.googleapis.com` / `fonts.gstatic.com` URLs in the build output.
