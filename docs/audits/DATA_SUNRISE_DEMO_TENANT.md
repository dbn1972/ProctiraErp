# Enterprise data / SQL certification checklist

**Module / slice:** Sunrise Public School screen-review demo seed, plus the institutions directory profile (five Delhi schools)  
**Branch / tip:** `cursor/sunrise-directory-seed-34d0`  
**Date (UTC):** 2026-09-28  
**Environment:** Local Postgres 16. Role `postgres` (superuser) on `proctira_test` and a schema-only clone `proctira_seed_fresh`. Schema came from Prisma migrations and `APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh` (applied=119 on the source database).

Copy of `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`. This slice is a single-tenant demo seed, not a multi-board certification.

Depends on the institutions directory UI in pull request #465 (`cursor/institutions-list-parity-34d0`). This seed is not applied by `tools/scripts/apply-sql.sh` or by the CI E2E workflow, so the extra attendance rows do not change the 45-minute E2E shard budget.

---

## 1. Schema

| Artifact              | Path                                          | Notes                                                                                           |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Migration(s)          | none                                          | No DDL. Existing tables and RLS policies are unchanged.                                         |
| Seed(s)               | `db/seeds/006_sunrise_public_school_demo.sql` | Idempotent fixed ids and `uuid_generate_v5` keys. Not applied by `apply-sql.sh`.                |
| Invariants documented | ☑                                             | Tenant FK rows only. Consent rows inserted already decided (append-only). Fee journals balance. |

Directory profile on tenant `00000000-0000-4000-8000-00000000a501` (slug `sunrise-public-school`, board CBSE `…a521`):

| Id      | School                                   | Area (`…a511` Delhi East, `…a512` Delhi North, `…a513` Delhi South) | Type             | UDISE       | Enrolled | Staff | Today attendance | Status   |
| ------- | ---------------------------------------- | ------------------------------------------------------------------- | ---------------- | ----------- | -------- | ----- | ---------------- | -------- |
| `…a551` | Sunrise Public School – Mayur Vihar      | Delhi East                                                          | Senior Secondary | 07040100417 | 1,240    | 84    | 94%              | active   |
| `…a552` | Sunrise Public School – Preet Vihar      | Delhi East                                                          | Secondary        | 07040100522 | 860      | 58    | 91%              | active   |
| `…a553` | Sunrise Junior Wing – Patparganj         | Delhi East                                                          | Primary          | 07040100618 | 410      | 27    | 88%              | active   |
| `…a554` | Sunrise Public School – Rohini Sector 9  | Delhi North                                                         | Senior Secondary | 07040200731 | 1,105    | 76    | 76%              | active   |
| `…a555` | Sunrise Pre-Primary – Vasundhara Enclave | Delhi East                                                          | Pre-Primary      | 07040100844 | 0        | 0     | none             | inactive |

The institutions list asks for `sortBy=directory`: active schools by institution code, then inactive schools. That puts Mayur Vihar (`07040100417`), Preet Vihar (`07040100522`), Junior Wing Patparganj (`07040100618`), and Rohini Sector 9 (`07040200731`) ahead of inactive Vasundhara Enclave (`07040100844`). A name sort would list Junior Wing first. Other API clients keep the default `sortBy=name`.

`…a551` is the original screen-review school, renamed in place from Pune / `SPS-PUN-01`. Named students `…a5b1`–`…a5b5`, staff `…a591`–`…a593`, classes `…a561`–`…a563`, sections, fees, and consents are unchanged. Generated people use `generate_series` and `uuid_generate_v5`. Attendance is five dates ending on `CURRENT_DATE` (18,075 rows). Present targets per day are 1,166 / 783 / 361 / 840 so `ROUND` yields 94 / 91 / 88 / 76. Names are fictional.

## 2. Apply / verify (no Prisma for cert)

| Step                              | Command / evidence                                                                                                                                                                                                                                                                                                                                 | Pass |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Apply                             | Existing migrated `proctira_test`. Fresh clone: `pg_dump -s --no-owner --no-privileges proctira_test` into `proctira_seed_fresh`.                                                                                                                                                                                                                  | ☑    |
| Seed                              | `psql -v ON_ERROR_STOP=1 -f db/seeds/006_sunrise_public_school_demo.sql` twice on `proctira_test` and twice on `proctira_seed_fresh`. First fresh apply inserted the directory rows. Second apply inserted 0 generated students, staff, enrollments, and attendance rows (about 0.7s on the already-seeded database, under 5s for the fresh pair). | ☑    |
| Row counts / spot queries         | institutions 5, areas 3, classes 6, sections 3, students 3,615, staff 245, attendance 18,075, fee plans 3, invoices 3 (open 2, paid 1), consents 2 (pending 1, approved 1). Percents 94 / 91 / 88 / 76. Vasundhara attendance null.                                                                                                                | ☑    |
| Multi-board profile (if required) | Not this slice. Board pack remains `db/seeds/002_multi_board_schools_500.sql`. One board (CBSE) and three areas inside one tenant.                                                                                                                                                                                                                 | n/a  |

## 3. Tenancy & constraints

| Check                                         | Pass | Evidence                                                                                                                    |
| --------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| Tenant scoping columns / RLS / service filter | ☑    | Seed binds `app.platform_admin` and `set_app_tenant_id` inside one transaction. No policy edits.                            |
| FK / unique / indexes for hot paths           | ☑    | Inserts use existing FKs. Generated ids are deterministic `uuid_generate_v5` with `ON CONFLICT (id)`. No new indexes.       |
| Domain property tests (if any)                | n/a  | Attendance targets are checked inside the seed `DO` block (percent in 94/91/88/76 and exactly 4 schools on `CURRENT_DATE`). |

## 4. Rollback

| Change                                                      | Forward fix / rollback                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Demo rows for tenant `00000000-0000-4000-8000-00000000a501` | Stop re-running the seed. Consents and fee ledger rows are append-only, so removal is an operational delete under platform scope, not a schema rollback. Generated directory rows use deterministic ids and can be deleted by those ids under the same tenant GUC. |

## 5. Sign-off

**Data claim:** ☐ Certified · ☐ Certified w/ waivers · ☑ Not certified

**Waivers:** Single tenant, one board (CBSE), three Delhi areas, five schools. Not a 3-board certification. No password login is seeded. Historical screen-test notes that say Pune / `SPS-PUN-01` describe the seed before this rename.
