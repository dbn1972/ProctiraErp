# t02 — cross-tenant / IDOR fuzzing

Replaces every id in an endpoint's path, query and body with ids from another
tenant and with random / guessable ids, and asserts a clean refusal with **no
victim data and no state change**. Covers list filters and export/report routes
too. Full-inventory live sweep (the in-process cross-tenant specs elsewhere are
per-module); this one drives the running gateway.

## What it does

Harness (`tools/aitest/src/tracks/t02-cross-tenant-idor/`):

- `schema-sample.ts` — turns a TypeBox/JSON-Schema request schema into a minimal
  valid sample with id slots marked as placeholders.
- `body-hints.ts` + `gen-body-hints.ts` + `schema-text.ts` — the generator
  scans `validate(<Schema>, request.body|query)` next to each route
  registration in `packages/backend/*/src` and `apps/api-gateway/src`, loads the
  schema, and records the route's id fields and a sample body/query into the
  committed `body-hints.json`. Registrations use a `${prefix}` variable, so a
  hint is matched to an inventory route by shape + module token.
- `fixture-tables.ts` — maps an id field name to candidate fixture tables.
- `targets.ts` — builds the attack cases: for each id position, four id kinds
  (`foreign` = a victim-owned id, `random-uuid`, `sequential`, `nil-uuid`).
  Non-attacked ids are filled with the attacker's own ids so the request reaches
  the id-handling code; mutating routes get an attacker-filled body.
- `leak-index.ts` + `leak-detector.ts` — the oracle. A response leaks when it
  carries a record whose `tenantId` is the victim, a victim composite name /
  email, or the victim slug. (Reuses `assertNoForeignTenant` from
  `@proctira/tenant-isolation-tests/helpers`.)
- `expect.ts` — per-case verdict: refusal (401/403/404, or 400 for a malformed
  id) with no leak and no state change passes; a leak, a victim-tenant snapshot
  change, or a 500/501 fails. 502/503/504 (unavailable proxy upstream on this
  profile) and body-less 5xx on POST/PUT/PATCH are skipped as inconclusive.
- `harness.ts` + `idor.aitest.ts` — the live suite: the id sweep (both
  directions A↔S), list-filter probes, export/report routes, and tenant
  header/host tampering. State change is checked with one victim+attacker
  snapshot around the mutating phase, localised per route only when a diff
  appears.

### Oracle scope (known limitation)

The leak oracle keys on the victim tenant id stamped on records, victim PII, and
the victim slug. A 2xx that returns only the caller's own tenant data or a
generic default for an arbitrary id is not a leak. A purely numeric or
field-level leak in a record carrying **no** id / name / tenant marker is out of
scope; those APIs stamp `tenantId` on every row, so this is narrow.

## Run it

```bash
~/bin/server-guard.sh
pnpm --filter @proctira/aitest aitest run t02-cross-tenant-idor --unit t02-cross-tenant-idor        # weekly full
pnpm --filter @proctira/aitest aitest run t02-cross-tenant-idor-quick --unit t02-cross-tenant-idor  # nightly quick (GET path ids)
```

Regenerate the body hints after a route/schema change:

```bash
pnpm --filter @proctira/aitest exec tsx src/tracks/t02-cross-tenant-idor/gen-body-hints.ts
```

Unit tests (PR CI): `pnpm --filter @proctira/aitest test -- src/tracks/t02-cross-tenant-idor`.

## Cadence

- `t02-cross-tenant-idor-quick` — nightly. GET routes with path ids only, one
  direction (`AITEST_T02_SCOPE=get-path`); read-only, ~a few minutes.
- `t02-cross-tenant-idor` — weekly. Full sweep (path/query/body, both
  directions, lists, exports, header tampering), ~5–7 minutes on `core`.

Both run from `.github/workflows/aitest-scheduled.yml`.

## Pending fixes and patches

`pending-fixes.json` lists the case ids whose correct-behaviour assertion
currently fails, mapped to a finding id; a pending case is reported
`pending-fix`, not `fail`, so the committed suite asserts only correct
behaviour. `P/t02-cross-tenant-idor/patches/<finding id>.patch` removes the
entry; the restore step applies it once the fix merges, re-asserting the fix.
