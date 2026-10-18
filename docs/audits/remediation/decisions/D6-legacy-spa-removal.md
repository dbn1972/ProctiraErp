# Decision D6 — Delete the legacy Vite SPA

**Decided by:** owner · **Status:** ACCEPTED

## Decision
Remove the legacy, unmounted Vite single-page app entirely. The Next.js app is
the one and only web client. The legacy SPA (old `App.tsx`, route-registry,
`features/*` dead pages, `featureRegistry` runtime-import, legacy `vite.config.ts`
test block) is dead code that is not reachable from the mounted Next.js app and
cannot be verified; it only generates audit findings for code that never runs.

## Scope
- Delete the unmounted SPA source, its route registry, and the legacy
  `vite.config.ts`/SPA-only test scaffolding that exist solely to serve it.
- Do NOT remove anything the Next.js app imports. Verify reachability before
  deleting each file (a file existing is not proof it is used; a file being
  unreachable from the Next.js entrypoints is proof it is dead).
- `vitest.config.ts` and real Next.js tests stay.

## Findings this unblocks
~45 "legacy SPA / tooling removal" findings in the decision register, including
the "weak client gating / dead code" cluster (e.g. PRC-L414, L415, L078, L259,
L408, L441) and the SPA-only residual of PRC-L435 (disbursement currency).
These are closed by REMOVAL: if the code is deleted, the finding is resolved
(the vulnerable/placeholder surface no longer exists). Mark each such finding
FULLY_CLOSED with evidence = "resolved by legacy SPA removal (Decision D6), PR #".

## Guardrail
This is a deletion with a large blast radius. It must go through its own PR with
a full Next.js build + the complete web/E2E suite green, proving nothing the
live app needs was removed. Any file whose reachability is ambiguous stays until
proven dead.

## Dispositions summary (recorded after FEAT-001/FEAT-002)

The App-Router reachability proof (plan.md §A, Phase 2) identified **110**
proven-dead production files that FEAT-001/FEAT-002 removed (2 SPA entrypoints —
`App.tsx` + `RootRouter.tsx` — plus 108 `features/**` files). **10** `features/**`
files are LIVE (imported directly by `app/**`) and were KEPT. `featureRegistry.ts`
was **refactored, not deleted** (its `lazyImport` field and SPA-only helpers were
dropped) because the live `CommandPalette` consumes its navigation metadata
(`scope`/`requiredPermissions`/`id`/`label`/`routePrefix`).

Per-finding dispositions recorded in `CANONICAL_LEDGER.csv` (authoritative table:
plan.md §D), evidence string `resolved by legacy SPA removal (Decision D6), PR #<n>`:

- **FULLY_CLOSED — 36** app-web SPA findings whose subject lived entirely in deleted
  code: L414, L441, L415, L416, L417, L419, L420, L422, L423, L425, L426, L427, L429,
  L430, L431, L432, L433, L437, L535, L536, L537, L538, L539, L540, L541, L542, L543,
  L259, L261, L067, M061, M143, M580, M581, M582, M615.
- **keep-PARTIAL — 8** findings whose SPA residual is removed but a live surface
  remains: L435, L436, L270, L534, L240, L263, L407, M144.
- **unchanged OPEN — 9** findings whose root cause is a live module or backend work,
  not resolved by deletion. 4 are app-web and carry a D6 note (L078, L408, L421, L439);
  the remaining 5 are tracked elsewhere per plan.md §D.

Backend "unmounted package" rows caught by the keyword net (survey/theme/plugin/
custom-field/data-warehouse/install/policy/notification/auth-backend and the latent-auth
rows) are **out of scope and untouched** — they mean backend packages not mounted in
the gateway, which deleting the web SPA does not resolve.
