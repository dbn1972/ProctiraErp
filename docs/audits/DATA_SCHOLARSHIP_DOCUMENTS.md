# Enterprise data / SQL certification checklist

**Module / slice:** Scholarship application documents  
**Branch / tip:** `cursor/scholarship-application-documents-2d14`  
**Date (UTC):** 2026-09-28  
**Environment:** Postgres 16 + Redis on localhost, role `proctira_app` (NOBYPASSRLS), 2026-09-28

---

## 1. Schema

| Artifact          | Path                                                  | Notes                                                                                                         |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Migration         | `db/sql/104_scholarship_application_documents.sql`    | Idempotent CREATE, RLS + FORCE, tenant FK, composite FK to `(tenant_id, id)` on applications, partial indexes |
| Seed              | `db/seeds/006_sunrise_public_school_demo.sql`         | Three metadata rows for Aarav Mehta (PENDING / VERIFIED / REJECTED). Bytes are not in git.                    |
| Placeholder bytes | `db/seeds/write-sunrise-scholarship-placeholders.mjs` | Writes the 118-byte PDF (sha256 `7856c8e9…`) at seed/test time                                                |
| Invariants        | documented                                            | mime allow-list, 10 MB, sha256 hex, rejection requires a reason, soft delete                                  |

## 2. Apply / verify (no Prisma for cert)

| Step        | Command / evidence                                                                                                           | Pass                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Apply       | `APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh` then `psql -f 104` a second time                                        | pass — first apply and second apply both completed (CONCURRENTLY unique index is idempotent) |
| Seed        | `psql -f db/seeds/006_sunrise_public_school_demo.sql` twice, then `node db/seeds/write-sunrise-scholarship-placeholders.mjs` | pass                                                                                         |
| Row counts  | seed raises unless `scholarship_application_documents` count ≥ 3                                                             | pass — Sunrise tenant `…a501` returned 3 rows (PENDING, VERIFIED, REJECTED)                  |
| Multi-board | not required — documents are tenant-scoped, not board-rule variants                                                          | n/a                                                                                          |

## 3. Tenancy & constraints

| Check                                 | Pass | Evidence                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scoping / RLS / service filter | pass | As `proctira_app`, `set_app_tenant_id('…0000bb')` returns 0 document rows; `set_app_tenant_id('…00a501')` returns 3. Audit rows for upload/verify/reject exist on tenant `…0001` after Playwright (`entity_type=scholarship_application_document`, operations CREATE/UPDATE). |
| FK / unique / indexes                 | code | `tenant_id → tenants(id)`; `(tenant_id, application_id) → scholarship_applications(tenant_id, id)`; partial indexes on active rows                                                                                                                                            |
| Privilege class                       | pass | `db/runtime-table-privileges.json` class `dml`; `check-runtime-table-privileges.mjs` PASS                                                                                                                                                                                     |
| Domain tests                          | pass | `document-routes.test.ts` mime, size, cross-tenant 404, other-parent 403, signed URL 401                                                                                                                                                                                      |

## 4. Rollback

| Change    | Forward fix / rollback                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New table | Forward-fix. Do not drop in place; soft-delete rows (`deleted_at`) if a file must be withdrawn. Object keys are removed best-effort by the API. |

## 5. Sign-off

**Data claim:** Live apply, second apply of `104`, Sunrise seed, placeholder PDFs, and app-role RLS (other tenant 0 rows) were run on this Postgres 16. That is the data evidence for this slice. It is not a full multi-board certification.

**Live UI:** `E2E_BACKEND_READY=1 pnpm --filter @proctira/web exec playwright test e2e/55-scholarship-documents.spec.ts --project=chromium` — 2 passed (upload, required-doc 400, signed URL body contains `%PDF`, verify, reject confirm).
