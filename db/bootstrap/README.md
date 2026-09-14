# Database role bootstrap (W1-DATA-10)

Fresh ProctiraERP installs need two PostgreSQL LOGIN roles before Prisma migrate
or `tools/scripts/apply-sql.sh` can establish the production RLS posture:

| Role | Purpose | Attributes |
| --- | --- | --- |
| `proctira` | Migrator / table owner (`MIGRATOR_DATABASE_URL`) | `NOSUPERUSER` `NOBYPASSRLS` (CI/prod); may already be compose `POSTGRES_USER` |
| `proctira_app` | Application runtime (`DATABASE_URL`) | `NOSUPERUSER` `NOBYPASSRLS` `NOCREATEDB` `NOCREATEROLE` `NOINHERIT` |

### Control-ledger privileges (W1-DATA-11)

After domain SQL `050` + `072`:

| Object | `proctira` (migrator) | `proctira_app` (runtime) |
| --- | --- | --- |
| Tenant / domain tables | Owner (DDL) | DML via `050` (narrowed further by `053`/`069` where append-only) |
| `schema_migrations` | Full (apply-sql ledger writes) | **None** — `REVOKE ALL` in `072` |
| `_prisma_migrations` | Full (Prisma migrate) | **None** — `REVOKE ALL` in `072` |

Runtime must never `SELECT` or mutate migration ledgers. New migrator-only
tables need an additive `REVOKE` after `050`'s `ALL TABLES` / default privileges.

## Canonical SQL

`01_runtime_roles.sql` — **idempotent** `CREATE ROLE` + `GRANT CONNECT` /
`USAGE`. Passwords are never embedded; the shell wrapper sets them.

## Apply (preferred)

```bash
# Superuser (or CREATEROLE) connection — the only manual prerequisite.
export BOOTSTRAP_DATABASE_URL=postgresql://postgres:SECRET@host:5432/postgres
export MIGRATOR_PASSWORD='…'          # becomes proctira password
export APP_ROLE_PASSWORD='…'          # becomes proctira_app password
export BOOTSTRAP_DB_NAME=proctira     # optional: create DB owned by proctira
export BOOTSTRAP_EXTENSIONS=1         # optional: uuid-ossp + pgcrypto on target DB
export BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1  # CI/prod: pin proctira NOSUPERUSER NOBYPASSRLS

bash tools/scripts/bootstrap-db-roles.sh
```

Then continue with Prisma + domain SQL as the migrator:

```bash
export MIGRATOR_DATABASE_URL=postgresql://proctira:…@host:5432/proctira
export DATABASE_URL=postgresql://proctira_app:…@host:5432/proctira
pnpm --filter @proctira/database run prisma:migrate:deploy
bash tools/scripts/apply-sql.sh
```

`apply-sql.sh` and `setup-live-db-and-onboard.sh` invoke the bootstrap wrapper
automatically when `BOOTSTRAP_DATABASE_URL` is set (or when `proctira_app` is
missing and a bootstrap URL is available).

## Local compose

`docker-compose.yml` mounts this SQL into `docker-entrypoint-initdb.d` on **fresh
volumes**, then `db/docker-init/02_local_passwords.sql` sets the documented
dev passwords from `.env.example`.

## Related

- W1-DATA-01: `db/sql/050_app_runtime_role.sql` (DML grants after schema exists)
- W1-DATA-11: `db/sql/072_control_ledger_privileges.sql` (REVOKE runtime on migration ledgers)
- Audit: `docs/audits/DATA_W1_DATA_10_DB_BOOTSTRAP.md`
- Audit: `docs/audits/DATA_W1_DATA_11_PRIVILEGES.md`
