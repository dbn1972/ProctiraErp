# Enterprise data / SQL certification checklist

**Module / slice:** Sunrise Public School screen-review demo seed  
**Branch / tip:** `cursor/seed-demo-tenant-sunrise-0ba0`  
**Date (UTC):** 2026-09-26  
**Environment:** Local Postgres 16. Role `proctira` (`NOSUPERUSER`, `NOBYPASSRLS`) after Prisma migrations and `APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh`.

Copy of `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`. This slice is a single-tenant demo seed, not a multi-board certification.

---

## 1. Schema

| Artifact              | Path                                          | Notes                                                                                           |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Migration(s)          | none                                          | No DDL. Existing tables and RLS policies are unchanged.                                         |
| Seed(s)               | `db/seeds/006_sunrise_public_school_demo.sql` | Idempotent fixed ids. Not applied by `apply-sql.sh`.                                            |
| Invariants documented | ☑                                             | Tenant FK rows only. Consent rows inserted already decided (append-only). Fee journals balance. |

## 2. Apply / verify (no Prisma for cert)

| Step                              | Command / evidence                                                                                                                       | Pass |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Apply                             | Prisma migration SQL, then `APPLY_STRICT_FKS=1 APPLY_SEEDS=1 bash tools/scripts/apply-sql.sh` (applied=119)                              | ☑    |
| Seed                              | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/006_sunrise_public_school_demo.sql` twice (second run inserted 0 rows)              | ☑    |
| Row counts / spot queries         | institutions 1, classes 3, sections 3, students 5, staff 3, fee plans 3, invoices 3 (open 2, paid 1), consents 2 (pending 1, approved 1) | ☑    |
| Multi-board profile (if required) | Not this slice. Board pack remains `db/seeds/002_multi_board_schools_500.sql`.                                                           | n/a  |

Unbound owner `SELECT count(*) FROM students` returned 0. The same student id under tenant `00000000-0000-4000-8000-000000000001` returned 0.

## 3. Tenancy & constraints

| Check                                         | Pass | Evidence                                                                                          |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| Tenant scoping columns / RLS / service filter | ☑    | Seed binds `app.platform_admin` and `set_app_tenant_id` inside one transaction. No policy edits.  |
| FK / unique / indexes for hot paths           | ☑    | Inserts use existing FKs (institution, class, section, invoice, consent, ledger). No new indexes. |
| Domain property tests (if any)                | n/a  | No GPA or clash rule changes.                                                                     |

## 4. Rollback

| Change                                                      | Forward fix / rollback                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo rows for tenant `00000000-0000-4000-8000-00000000a501` | Stop re-running the seed. Consents and fee ledger rows are append-only, so removal is an operational delete under platform scope, not a schema rollback. |

## 5. Sign-off

**Data claim:** ☐ Certified · ☐ Certified w/ waivers · ☑ Not certified

**Waivers:** Single school (CBSE, Pune). Not a 3-board certification. No password login is seeded.
