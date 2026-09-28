# Enterprise data / SQL certification checklist

**Module / slice:** Scholarship application documents  
**Branch / tip:** `cursor/scholarship-application-documents-2d14`  
**Date (UTC):** 2026-09-28  
**Environment:** raw SQL under `db/sql`; live apply recorded when Postgres is available

---

## 1. Schema

| Artifact          | Path                                                  | Notes                                                                                                         |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Migration         | `db/sql/104_scholarship_application_documents.sql`    | Idempotent CREATE, RLS + FORCE, tenant FK, composite FK to `(tenant_id, id)` on applications, partial indexes |
| Seed              | `db/seeds/006_sunrise_public_school_demo.sql`         | Three metadata rows for Aarav Mehta (PENDING / VERIFIED / REJECTED). Bytes are not in git.                    |
| Placeholder bytes | `db/seeds/write-sunrise-scholarship-placeholders.mjs` | Writes the 118-byte PDF (sha256 `7856c8e9…`) at seed/test time                                                |
| Invariants        | documented                                            | mime allow-list, 10 MB, sha256 hex, rejection requires a reason, soft delete                                  |

## 2. Apply / verify (no Prisma for cert)

| Step        | Command / evidence                                                  | Pass                                   |
| ----------- | ------------------------------------------------------------------- | -------------------------------------- |
| Apply       | `psql` / `tools/scripts/apply-sql.sh` including `104_…`             | ☐ until this environment runs Postgres |
| Seed        | `psql … -f db/seeds/006_sunrise_public_school_demo.sql`             | ☐                                      |
| Row counts  | seed raises unless `scholarship_application_documents` count ≥ 3    | ☐                                      |
| Multi-board | not required — documents are tenant-scoped, not board-rule variants | n/a                                    |

## 3. Tenancy & constraints

| Check                                 | Pass | Evidence                                                                                                                           |
| ------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scoping / RLS / service filter | code | `tenant_isolation` policy matches other scholarship tables; reads go through `withPgTenant`                                        |
| FK / unique / indexes                 | code | `tenant_id → tenants(id)`; `(tenant_id, application_id) → scholarship_applications(tenant_id, id)`; partial indexes on active rows |
| Privilege class                       | pass | `db/runtime-table-privileges.json` class `dml`; `check-runtime-table-privileges.mjs` PASS                                          |
| Domain tests                          | pass | `document-routes.test.ts` mime, size, cross-tenant 404, other-parent 403, signed URL 401                                           |

## 4. Rollback

| Change    | Forward fix / rollback                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New table | Forward-fix. Do not drop in place; soft-delete rows (`deleted_at`) if a file must be withdrawn. Object keys are removed best-effort by the API. |

## 5. Sign-off

**Data claim:** Not certified until `104` and the Sunrise seed are applied on a live Postgres and the document count check passes.

**Waivers:** Live apply is environment-dependent. Unit tests cover the service rules without a database.
