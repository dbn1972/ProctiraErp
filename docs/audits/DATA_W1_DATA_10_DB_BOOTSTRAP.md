# DATA — W1-DATA-10 database role bootstrap (fresh install)

**Module / slice:** Postgres runtime / migrator role provisioning  
**Branch / tip:** `cursor/aud-w1-data-10-db-bootstrap-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static contract + optional live superuser (`BOOTSTRAP_DATABASE_URL`)

## Finding

Fresh installation still depended on **externally pre-created** database roles
(`proctira` / `proctira_app`). Operators (and CI) had to hand-write `CREATE ROLE`
before Prisma / `apply-sql.sh`. Local compose had a one-shot `docker-init` copy,
but non-compose and managed-Postgres first boots lacked a documented, wired
bootstrap path.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Canonical SQL | `db/bootstrap/01_runtime_roles.sql` | Idempotent `CREATE ROLE` + `GRANT CONNECT` / `USAGE`; no passwords |
| Wrapper | `tools/scripts/bootstrap-db-roles.sh` | Passwords from env; optional DB + extensions; migrator attribute pin |
| Apply wiring | `tools/scripts/apply-sql.sh` | Runs bootstrap when `BOOTSTRAP_DATABASE_URL` is set |
| Onboard wiring | `tools/scripts/setup-live-db-and-onboard.sh` | Same |
| Compose | `docker-compose.yml` + `db/docker-init/02_local_passwords.sql` | Mounts canonical SQL; local passwords only |
| CI | `.github/workflows/ci.yml`, `e2e-backend-ready.yml` | Provision via bootstrap script (no inline `CREATE ROLE`) |
| Docs | `db/bootstrap/README.md`, `db/README.md`, `.env.example` | Operator path |
| Tests | `db-role-bootstrap.test.ts`, `bootstrap-db-roles.test.ts` | Static + dry-run + optional live |

## Invariants

1. Fresh install requires only a **superuser / CREATEROLE** connection URL — not hand-written role DDL.
2. Bootstrap SQL is **idempotent** (`IF NOT EXISTS` / skip CREATE when present).
3. Passwords are set only via env (`MIGRATOR_PASSWORD` / `APP_ROLE_PASSWORD`), never committed in canonical SQL.
4. `proctira_app` remains `NOSUPERUSER` `NOBYPASSRLS` `NOCREATEDB` `NOCREATEROLE`.
5. Local compose does **not** demote `POSTGRES_USER=proctira` (migrator pin is opt-in via `BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1`).

## Apply / verify

```bash
BOOTSTRAP_DATABASE_URL=postgresql://postgres:SECRET@host:5432/postgres \
MIGRATOR_PASSWORD=… APP_ROLE_PASSWORD=… \
BOOTSTRAP_DB_NAME=proctira BOOTSTRAP_EXTENSIONS=1 \
BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1 \
  bash tools/scripts/bootstrap-db-roles.sh

# static
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/db-role-bootstrap.test.ts
pnpm exec vitest run tools/scripts/__tests__/bootstrap-db-roles.test.ts
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Superuser (or CREATEROLE) connection is still required once per cluster | **Accepted** — Postgres cannot create LOGIN roles without privilege |
| `proctira_backup` / other optional ops roles not created here | **Out of scope** (see `docs/BACKUP_RESTORE.md`) |
| Staging/prod ExternalSecret must still map pods to `proctira_app` | **Closed** — see `docs/audits/DATA_W1_DATA_01_COMPLETE.md` (deploy + CI runtime-role gate) |
| Existing volumes that never ran docker-init still need one bootstrap run | **By design** — script is idempotent for that repair |

## Rollback

Forward-fix only: do not drop `proctira` / `proctira_app` in production.
Remove bootstrap mounts from compose only if reverting the entire role-split posture.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).
