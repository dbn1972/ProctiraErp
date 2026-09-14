# DATA — W1-DATA-01 runtime role COMPLETE

**Module / slice:** Postgres application runtime role (`proctira_app`)  
**Branch / tip:** `cursor/w1-data-01-runtime-role-gate-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static CI gate + deploy live probe against actual `DATABASE_URL` secret

## Finding (PARTIAL → COMPLETE)

Repo already defined the migrator vs runtime role split (`050_app_runtime_role.sql`,
bootstrap, live Vitest suites, CI suites as `proctira_app`). **Residual:** deploy
did not prove the *actual* runtime secret used by pods is non-owner /
non-superuser / non-BYPASSRLS. A mis-pointed ExternalSecret remote key could
still ship owner connections while CI stayed green on a synthetic URL.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Live gate | `tools/scripts/assert-runtime-database-role.{mjs,sh}` | Connects with runtime `DATABASE_URL`; fail-closed when required |
| Static gate | `tools/scripts/check-runtime-role-gate.mjs` | Asserts deploy/CI/ExternalSecret/Helm wiring |
| Deploy | `.github/workflows/deploy.yml` job `runtime-role-gate` | Required when `can-deploy`; uses GH secret and/or cluster Secret |
| CI | `.github/workflows/ci.yml` job `runtime-role-gate` → `ci-aggregate` | Always-on; skip fails closed |
| ExternalSecret | `infrastructure/k8s/overlays/{production,staging}/external-secret.yaml` | Documents `DATABASE_URL` → `proctira_app` |
| Helm | `proctira-platform/values.yaml`, `values-production.yaml` | Documents existingSecret / databaseUrl posture |
| Docs | `db/README.md`, this file | Operator + auditor evidence |
| Tests | `assert-runtime-database-role.test.mjs`, `check-runtime-role-gate.test.mjs`, aggregate cases | Unit + contract |

## Invariants

1. Production / `RUNTIME_ROLE_GATE_REQUIRED=1` **fails closed** when `DATABASE_URL` is unset and the cluster Secret cannot be resolved.
2. The login role of the runtime URL is **`proctira_app`** (override only via `RUNTIME_ROLE_EXPECTED`).
3. That role is **NOSUPERUSER** and **NOBYPASSRLS**.
4. That role **owns zero** `public` application tables (`relkind` `r`/`p`).
5. That role is **not a member** of any role that owns those tables (`pg_auth_members`).
6. ExternalSecret / Helm must point `DATABASE_URL` at `proctira_app` (never migrator / BYPASSRLS backup).
7. CI aggregate treats `runtime-role-gate` as **required** (not advisory).

## Apply / verify

```bash
# Static (required CI)
pnpm check:runtime-role-gate:test
pnpm check:runtime-role-gate

# Live against a known-good runtime URL (local / CI service container)
DATABASE_URL=postgresql://proctira_app:…@localhost:5432/proctira_test \
RUNTIME_ROLE_GATE_REQUIRED=1 \
  bash tools/scripts/assert-runtime-database-role.sh

# Deploy path resolves either:
#   - GitHub environment secret DATABASE_URL (mirrors ExternalSecret remote key), or
#   - kubectl Secret proctira-secrets / proctira-prod-secrets key DATABASE_URL
```

## ExternalSecret / Helm operator contract

| Surface | Requirement |
| ------- | ----------- |
| `proctira/production/database-url` (and staging twin) | `postgresql://proctira_app:…@…/…` |
| Helm `secrets.databaseUrl` / `existingSecret` | Same URL semantics; chart does not rewrite the user |
| `BACKUP_DATABASE_URL` | Separate BYPASSRLS role — **never** mount as app `DATABASE_URL` |
| Migrator | `MIGRATOR_DATABASE_URL` only (Prisma / `apply-sql.sh`) |

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Gate cannot invent network reachability if kubeconfig / DB firewall blocks the runner | **Accepted** — fail closed; operators fix connectivity or mirror URL into GH env secret |
| Role rename away from `proctira_app` needs `RUNTIME_ROLE_EXPECTED` | **Accepted** — default remains `proctira_app` |
| Historical clusters still on owner `DATABASE_URL` will fail deploy until rotated | **By design** — that is the finding being closed |

## Rollback

Removing `deploy.yml` `runtime-role-gate` or dropping it from `ci-aggregate` re-opens PARTIAL. Forward-fix: keep the assert script and ExternalSecret comments even if a temporary `RUNTIME_ROLE_EXPECTED` override is needed during a controlled rename.

## Sign-off

**Data claim:** Certified — PARTIAL residual closed by required deploy + CI gates against the actual runtime secret contract.
