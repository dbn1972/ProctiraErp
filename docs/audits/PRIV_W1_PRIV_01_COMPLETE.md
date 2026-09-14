# PRIV — W1-PRIV-01 COMPLETE (immutable versioned consent lifecycle)

**Module / slice:** Parent portal consents + Students 360 consents  
**Branch:** `cursor/w1-priv-01-consent-complete-56c3`  
**Tip SHA:** `f7e04a4939894edee48eeeae2a0396744910904e`  
**Date (UTC):** 2026-09-14  
**Environment:** SQL contract + focused unit tests (live Postgres optional; not claimed here)

## Finding (PARTIAL residual)

`052_parent_consent_version.sql` required a policy/form `consent_version` string at write time, but:

1. `parent_consents` still **overwrote** status/decided_at on decide (silent historical mutation).
2. No withdraw/supersede **successor versions** with effective dating.
3. `student_consents` used `ON CONFLICT … DO UPDATE`, erasing prior grant history.

## Closed (COMPLETE)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Foundation | `db/sql/052_parent_consent_version.sql` | Policy version NOT NULL (unchanged) |
| Complete SQL | `db/sql/090_consent_lifecycle_append_only.sql` | Chain/version/supersedes/`valid_*`; body immutability + DELETE reject; student unique-overwrite removed |
| Fresh schema | `db/sql/010_parent_portal_schema.sql`, `035_students_360_schema.sql` | Columns aligned for new installs |
| Parent service | `packages/backend/parent-portal/src/parent-portal-service.ts` | Decide/withdraw/supersede append successors; `refuseConsentBodyMutation()` |
| Parent repo | in-memory + pg | `closeConsentValidTo` only; `listConsentVersions`; no body UPDATE API |
| Parent routes | `…/routes.ts` | `POST …/withdraw`, `POST …/supersede`, `GET …/history` |
| Students 360 | `…/students-360/store.ts` + service | `appendConsent` closes prior open window; history retained |
| Tests | parent-portal + student + tenant-isolation | Immutability guard, decide/withdraw/supersede, student history, static SQL |

## Invariants

1. **parent_consents:** body/status/version/identity immutable after INSERT; only `valid_to` may close/narrow. Decide / withdraw / supersede close the open row and INSERT a successor (`version+1`, `supersedes_id`, shared `consent_chain_id`).
2. **student_consents:** grant body immutable; kind versions are append-only; list returns open rows (`valid_to IS NULL`); history keeps priors.
3. **API:** no path mutates historical title/description/`consent_version`/status in place; service exposes an explicit refuse guard.

## Apply / verify

```bash
# apply numbered SQL through 089 (psql / apply-sql — not Prisma for cert path)
pnpm --filter @proctira/backend-parent-portal test
pnpm --filter @proctira/backend-student exec vitest run src/students-360/students-360.test.ts
pnpm --filter @proctira/tenant-isolation-tests exec vitest run --config vitest.config.ts src/unit/w1-priv-01-consent-lifecycle.test.ts
```

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Live Postgres negative proofs for 089 triggers not claimed in this pack (unit + static SQL contract only; live suite skipped without `DATABASE_URL`) | **Honest residual** |
| Parent consents UI may still only expose approve/deny (withdraw/supersede/history are API/service-complete) | **Accepted** — Done criteria are API/service + tests |
| Full DSAR export of consent history UI not in this slice | **Non-goal** |

## Sign-off

**Privacy claim:** Consent rows are append-only / versioned with withdraw/supersede effective dating; historical bodies cannot be silently overwritten.  
**Status:** W1-PRIV-01 **PARTIAL → COMPLETE** (with residuals above).
