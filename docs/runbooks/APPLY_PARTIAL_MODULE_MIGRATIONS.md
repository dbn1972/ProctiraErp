# Apply partial-module Prisma migrations + redeploy gateway/web

Ops runbook for the five residual module migrations (2026-09-04 completion pass). Use this on **local docker-compose** or the **EC3 host** (`cloudsphere-ec3`, checkout under `~/ProctiraErp`).

## Migrations covered

| Directory under `packages/shared/database/prisma/migrations/` | Schema / tables |
| ------------------------------------------------------------- | --------------- |
| `20260904_add_institution_infrastructure` | `institution.infrastructure_items` |
| `20260904_assessment_report_cards` | `assessment.report_card_*`, teacher comments, etc. |
| `20260904_staff_appraisal_training` | `staff.staff_appraisal*`, training tables |
| `20260904_form_configurations` | `registration.form_configurations` |
| `20260904_user_role_assignments` | `auth.user_role_assignments` |

Package: **`@proctira/database`** (`packages/shared/database`).  
Deploy command: `pnpm --filter @proctira/database prisma:migrate:deploy` (wraps `prisma migrate deploy`).

Do **not** commit or paste secrets. Prefer loading `DATABASE_URL` / `DATABASE_URL_HOST` from `.env` / `.env.ec3` via `set -a; source …; set +a`.

---

## Preconditions

1. Repo at the revision that contains the five migration folders + `migration_lock.toml` (`provider = "postgresql"`).
2. Postgres reachable:
   - **Compose network / containers:** `DATABASE_URL` (host `postgres:5432`).
   - **Host processes / EC3:** `DATABASE_URL_HOST` (typically `127.0.0.1:5434` when `POSTGRES_PORT=5434` in `.env.ec3`).
3. `pnpm` install already done (`pnpm install --frozen-lockfile` if needed).
4. Safe Postgres start only — **never** `docker compose down -v` / volume wipe for this procedure.

### Reachability smoke (no migrate yet)

```bash
# Host-mapped port (EC3 / local host tooling)
pg_isready -h 127.0.0.1 -p "${POSTGRES_PORT:-5434}" || \
  (command -v docker >/dev/null && docker exec proctira-erp-postgres-1 pg_isready -U proctira -d proctira)
```

If Postgres is down but Docker Compose is available and data volumes already exist:

```bash
# Starts postgres only; keeps named volume `postgres-data` (no data destroy)
docker compose --env-file .env.ec3 up -d postgres
# Local default env file instead:
# docker compose up -d postgres

docker compose ps postgres
```

Stop postgres later only if you started it solely for migrate and nothing else needs it:

```bash
docker compose stop postgres   # preferred over `down` — leaves volumes intact
```

---

## 1. Migrate deploy

### Local (docker-compose app network or default `.env`)

```bash
cd /path/to/ProctiraErp   # or /workspace in agents

set -a
# Prefer a non-secret-checked-in env; copy from .env.example if needed
[ -f .env ] && source .env
set +a

# From a container that can resolve hostname `postgres`, DATABASE_URL is fine as-is.
# From the host against published port, override:
export DATABASE_URL="${DATABASE_URL_HOST:-$DATABASE_URL}"

pnpm --filter @proctira/database prisma:generate
pnpm --filter @proctira/database prisma:migrate:deploy
pnpm --filter @proctira/database exec prisma migrate status
```

### EC3 host (process-mode gateway/web)

```bash
cd ~/ProctiraErp

set -a
source .env.ec3
set +a

# Host must use the published Postgres port, not the compose DNS name
export DATABASE_URL="${DATABASE_URL_HOST}"

pnpm --filter @proctira/database prisma:generate
pnpm --filter @proctira/database prisma:migrate:deploy
pnpm --filter @proctira/database exec prisma migrate status
```

Confirm the five names appear in applied migrations (`migrate status` “Database schema is up to date” or lists them under Applied).

### Optional SQL spot-check (tables exist)

```bash
psql "$DATABASE_URL_HOST" -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('institution.infrastructure_items');
SELECT to_regclass('assessment.report_card_templates');
SELECT to_regclass('staff.staff_appraisal_templates');
SELECT to_regclass('registration.form_configurations');
SELECT to_regclass('auth.user_role_assignments');
SQL
```

Or via container:

```bash
docker exec -i proctira-erp-postgres-1 psql -U proctira -d proctira -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('institution.infrastructure_items');
SELECT to_regclass('assessment.report_card_templates');
SELECT to_regclass('staff.staff_appraisal_templates');
SELECT to_regclass('registration.form_configurations');
SELECT to_regclass('auth.user_role_assignments');
SQL
```

---

## 2. Redeploy / restart gateway + web

Prisma client must be regenerated **before** restart so new models are available. Domain plugins load when `DATABASE_URL` is set on the gateway process.

### A. Docker Compose (images or `docker-compose.dev.yml`)

```bash
cd ~/ProctiraErp   # or repo root

# Rebuild + recreate only app services (postgres volume untouched)
docker compose --env-file .env.ec3 up -d --build api-gateway web

# Dev overlay (HMR / pnpm inside containers):
# docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.ec3 up -d api-gateway web

docker compose ps api-gateway web
curl -fsS "http://127.0.0.1:${GATEWAY_PORT:-3200}/health" || true
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:${WEB_PORT:-3201}/login"
```

EC3 `.env.ec3` defaults used by validate scripts: gateway **3200**, web **3201**, Postgres host port **5434**.

### B. EC3 host processes (tsx / Next — matches prior phase apply notes)

After `git pull` (or sync) and migrate:

```bash
cd ~/ProctiraErp
set -a; source .env.ec3; set +a

# Gateway must see Postgres via host URL (and Redis host URL if used)
export DATABASE_URL="${DATABASE_URL_HOST}"
export REDIS_URL="${REDIS_URL_HOST:-$REDIS_URL}"
export PORT="${GATEWAY_PORT:-3200}"
export HOST="${GATEWAY_HOST:-0.0.0.0}"

# Stop previous gateway/web PIDs if you track them (example):
# kill "$(cat /tmp/proctira-gateway.pid)" 2>/dev/null || true
# kill "$(cat /tmp/proctira-web.pid)" 2>/dev/null || true

pnpm --filter @proctira/database prisma:generate

nohup pnpm --filter @proctira/api-gateway start \
  > /tmp/proctira-gateway.log 2>&1 & echo $! > /tmp/proctira-gateway.pid

# Web: use PORT from env (compose maps WEB_PORT→3001 in containers;
# host Next often uses WEB_PORT directly — match whatever already listens on 3201)
export PORT="${WEB_PORT:-3201}"
nohup pnpm --filter @proctira/web start \
  > /tmp/proctira-web.log 2>&1 & echo $! > /tmp/proctira-web.pid

# If web is usually run in dev on EC3 instead:
# nohup pnpm --filter @proctira/web dev > /tmp/proctira-web.log 2>&1 & echo $! > /tmp/proctira-web.pid
```

Smoke:

```bash
curl -fsS "http://127.0.0.1:3200/api/v1/auth/password" -H 'content-type: application/json' \
  -d '{"email":"'"${INDIA_ADMIN_EMAIL:-admin@proctira.in}"'","password":"'"${INDIA_ADMIN_PASSWORD:-proctira-india-admin}"'"}' | head -c 200
echo
curl -fsS -o /dev/null -w 'login %{http_code}\n' "http://127.0.0.1:3201/login"
```

---

## 3. Validation scripts after migrate

Existing `tools/scripts/validate-phase*-ec3.sh` scripts cover **owning schemas** and API regression. They do **not** all assert the five new residual tables by name; still run the owning-phase scripts after migrate + redeploy, then the SQL spot-check above.

| Migration | Run after migrate | Why |
| --------- | ----------------- | --- |
| `20260904_add_institution_infrastructure` | `validate-phase3-institution-ec3.sh` | Institution schema + `/institutions` |
| `20260904_assessment_report_cards` | `validate-phase6-assessment-ec3.sh` | Assessment schema + grading/items smoke |
| `20260904_staff_appraisal_training` | `validate-phase8-staff-ec3.sh` | Staff schema + `/staff` |
| `20260904_form_configurations` | `validate-phase16-registration-ec3.sh` | Registration schema + regression paths |
| `20260904_user_role_assignments` | `validate-phase2-auth-ec3.sh` | Auth schema + login / `/me` |

Recommended order on EC3 (auth first, then domains touched by residuals):

```bash
cd ~/ProctiraErp
export API_URL="${API_URL:-http://127.0.0.1:3200}"
export WEB_URL="${WEB_URL:-http://127.0.0.1:3201}"
set -a; source .env.ec3; set +a   # provides DATABASE_URL_HOST when present

./tools/scripts/validate-phase2-auth-ec3.sh
./tools/scripts/validate-phase3-institution-ec3.sh
./tools/scripts/validate-phase6-assessment-ec3.sh
./tools/scripts/validate-phase8-staff-ec3.sh
./tools/scripts/validate-phase16-registration-ec3.sh
```

Optional broader regression (not required for these five residuals alone):

```bash
./tools/scripts/validate-phase4-5-student-attendance-ec3.sh
./tools/scripts/validate-phase7-examination-ec3.sh
# … through validate-phase15-survey-ec3.sh as needed
```

---

## 4. Agent / CI environment note

If this procedure is attempted in an environment **without** Docker and with Postgres ports closed (e.g. cloud agent with no `docker` binary and `127.0.0.1:5432` / `:5434` refused):

1. **Do not** invent EC3 success.
2. Still land this runbook + ensure migration folders + `migration_lock.toml` are in the tree.
3. Run migrate + validate on a host where Postgres is up (EC3 or local compose).

---

## 5. Rollback notes

- These migrations are additive (`CREATE TABLE IF NOT EXISTS` / indexes). Prisma does not auto-rollback SQL; restore from backup only if a deploy must fully reverse schema (see `docs/BACKUP_RESTORE.md`).
- App rollback: restart previous gateway/web image or git revision; in-memory mode is used only when `DATABASE_URL` is unset (not for EC3 Prisma path).

## Related

- Residual list: `docs/SCHOOL_ERP_MODULE_SCOPE.md` §4 / §6
- Phase validate scripts: `tools/scripts/validate-phase*-ec3.sh`
- Package scripts: `packages/shared/database/package.json` → `prisma:migrate:deploy`
