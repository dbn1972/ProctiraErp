# Enterprise data / SQL certification checklist

**Module / slice:** Reports catalogue (G-909)  
**Branch / tip:** `cursor/w9-g909-reports-56c3`  
**Date (UTC):** 2026-09-09  
**Environment:** raw SQL `db/sql/037_reports_schema.sql` — apply via `tools/scripts/apply-sql.sh` (no Prisma)

---

## 1. Schema

| Artifact              | Path       | Notes |
| --------------------- | ---------- | ----- |
| Migration(s)          | `db/sql/037_reports_schema.sql` | `report_artifacts`, `report_schedules`, `report_runs` |
| Seed(s)               | none | Catalogue keys are code, not rows |
| Invariants documented | ☑ | sha256 hex 64 chars; format ∈ csv/xlsx/pdf; cadence ∈ daily/weekly/monthly; run source ∈ manual/schedule |

## 2. Apply / verify (no Prisma for cert)

| Step                              | Command / evidence | Pass |
| --------------------------------- | ------------------ | ---- |
| Apply                             | `apply-sql.sh` picks `037` by LC sort after `034` | ☐ live env |
| Seed                              | n/a | ☐ |
| Row counts / spot queries         | unit RLS contract + in-memory store tests | ☑ unit |
| Multi-board profile (if required) | not board-specific schema | n/a |

## 3. Tenancy & constraints

| Check                                         | Pass | Evidence |
| --------------------------------------------- | ---- | -------- |
| Tenant scoping columns / RLS / service filter | ☑ | `tenant_isolation` + `FORCE ROW LEVEL SECURITY`; platform_admin SELECT for scheduler due-scan |
| FK / unique / indexes for hot paths           | ☑ | FKs schedule/artifact on runs; indexes (tenant, next_run_at) |
| Domain property tests (if any)                | ☑ | sha256 match, next_run_at, role dashboards, tenant isolation |

## 4. Rollback

| Change | Forward fix / rollback |
| ------ | ---------------------- |
| 037 create tables | `DROP TABLE report_runs, report_schedules, report_artifacts;` — no destructive ALTER |

## 5. Sign-off

**Data claim:** ☐ Certified w/ waivers — SQL + RLS unit contract shipped; live `psql` apply not run in this agent (no dedicated cert Postgres). In-memory dual store covers gateway without `DATABASE_URL`.

**Waivers:** live apply/seed row counts deferred to CI `apply-sql.sh` on merge.
