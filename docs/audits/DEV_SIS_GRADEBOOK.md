# DEV — SIS Gradebook / GPA / transcripts / report cards (WS3)

**Capability / module:** Gradebook · Credits · GPA · Report cards · Official transcripts  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `268118806cdefb2a45cf0d9d94fae1965c1bc938`  
**Owner / agent:** cloud SERVER agent  
**Date (UTC):** 2026-09-06  
**Peer parity target:** Teacher enters section grades; registrar computes GPA + issues versioned immutable transcripts; term report-card jobs return status + artifact metadata (PowerSchool / IC-class gradebook slice)  
**Dev session:** WS3 server slice  
**Paired test audit:** `docs/audits/SIS_GRADEBOOK_TEST_NOTES.md`

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | A teacher/registrar can **upsert grades** for a section, **compute weighted/unweighted GPA** using board grading-scale bands + credit rules, **queue a report-card job** with SUCCEEDED/FAILED status + artifact URI, and **issue official transcripts** where each issue increments version and prior checksums remain immutable. |
| In scope (peer parity) | Grade entry upsert; GPA engine + snapshots; credit rules; report-card job metadata; versioned transcript issue; redesign UI for institution gradebook + student records; honesty banners on schema/API miss                                                                                                                        |
| Explicit non-goals     | Full PDF print shop / signed sealed PDFs; parent portal grade view; LMS grade sync; device-farm captures; live IdP E2E; Prisma models for this path                                                                                                                                                                                |
| Roles (RBAC)           | Teacher grade entry; Registrar transcript issue — enforced on write routes (`gradebook-access`)                                                                                                                                                                                                                                    |
| Boards impacted        | CBSE ☑ ICSE ☑ State (MH) ☑ via seeded scales + credit rules                                                                                                                                                                                                                                                                        |

Screen / API inventory:

| Nav / surface                  | Route                          | API                                                          | Tables                                                | PII                  |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------- | -------------------- |
| Institution gradebook          | `/institutions/[id]/gradebook` | `/api/v1/gradebook/entries`, `/gpa/compute`, `/report-cards` | `grade_entries`, `gpa_snapshots`, `board_export_jobs` | Student IDs + scores |
| Student records                | `/students/records`            | `/api/v1/gradebook/transcripts`, `/gpa`, `/report-cards`     | `transcript_issuances`, `gpa_snapshots`               | Student IDs          |
| Federated placeholder redirect | `/app/students/records`        | links to App Router                                          | —                                                     | —                    |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                                                                    |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `003_sis_timetable_schedule_schema.sql` (tables); `004_sis_gradebook_indexes.sql` (upsert unique + indexes) |
| Constraints / indexes / FKs   | ☑    | `grade_entries_upsert_uidx`; transcript UNIQUE (tenant, student, version)                                   |
| Multi-board seed fixtures     | ☑    | Scales in `003_sis_timetable_board_scales.sql`; credits+section in `004_sis_gradebook_credit_section.sql`   |
| Domain unit/property tests    | ☑    | `packages/backend/gradebook/src/gpa-engine.test.ts` (9), `gradebook-service.test.ts` (2)                    |
| Invariants documented         | ☑    | Locked grades → 409; issued transcript versions append-only; GPA uses board bands                           |

**Entities:** `grading_scales`, `grading_scale_bands`, `credit_rules`, `grade_entries`, `gpa_snapshots`, `transcript_issuances`, `board_export_jobs` (job_type=`REPORT_CARD`), `sections`.  
**Persistence:** raw `pg` (`PgGradebookRepository`) when `DATABASE_URL` set; in-memory otherwise. **No Prisma.**

---

## 2. API / services

| Check                              | Done | Evidence                                               |
| ---------------------------------- | ---- | ------------------------------------------------------ |
| Tenant middleware on all routes    | ☑    | `tenantIdOf` in `routes.ts`                            |
| Validation + typed errors          | ☑    | TypeBox schemas in `schemas.ts`                        |
| RBAC enforced                      | ☑    | `gradebook-access.ts` + route `requireAction`          |
| Conflict / rule failures → 409/422 | ☑    | `GRADE_LOCKED` 409; schema missing 503; validation 400 |
| Idempotent writes where needed     | ☑    | Grade by (tenant, student, section, assessment)        |
| Cross-tenant deny test             | ☑    | `gradebook-service.test.ts` isolation case             |

Package: `@proctira/backend-gradebook` registered in `apps/api-gateway/src/domain-plugins.ts`.

---

## 3. UI (redesign)

| Screen                   | Empty/loading/error            | Write works              | Board-aware         | Evidence                                     |
| ------------------------ | ------------------------------ | ------------------------ | ------------------- | -------------------------------------------- |
| Institution gradebook    | ☑ honesty empty + API error    | ☑ forms → server actions | scales/credit codes | `institutions/[id]/gradebook/page.tsx`       |
| Student records          | ☑ empty transcript list        | ☑ issue transcript       | N/A                 | `students/records/page.tsx`                  |
| Federated StudentRecords | ☑ redirect copy (no fake data) | → live route             | N/A                 | `features/students/pages/StudentRecords.tsx` |

Institution tabs include **Gradebook**.

---

## 4. Cross-module integration

| Dependency                       | Integrated | Evidence                                        |
| -------------------------------- | ---------- | ----------------------------------------------- |
| Institutions / periods           | ☑          | Sections filtered by institutionId              |
| Staff / students / enrollments   | Partial    | Student IDs opaque; demo enrollments seeded     |
| Attendance / assessments / exams | ☐          | Residual — assessment module separate           |
| Exports / jobs                   | ☑          | `board_export_jobs` REPORT_CARD status pipeline |

---

## 5. Observability & audit

| Check                               | Done | Evidence                                                        |
| ----------------------------------- | ---- | --------------------------------------------------------------- |
| Structured logs on writes           | ☐    | Residual — gateway request logs                                 |
| Audit trail for sensitive mutations | ☑    | `GradebookService` audit log on grade upsert + transcript issue |
| Async job status (if exports)       | ☑    | QUEUED→RUNNING→SUCCEEDED/FAILED on report cards                 |

---

## 6. Security & compliance

| Check                                | Done    | Evidence                                            |
| ------------------------------------ | ------- | --------------------------------------------------- |
| Tenant isolation                     | Partial | All queries filter `tenant_id`                      |
| RBAC matrix documented               | Partial | See §0                                              |
| Export download auth                 | Partial | Artifact URI metadata only (memory://)              |
| Issued records immutable / versioned | ☑       | New version per issue; checksum differs; live smoke |

---

## 7. Hand-off to production-ready **test** skill

| Check                  | Done    | Evidence                                                                              |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| Test checklist started | ☑       | `docs/audits/SIS_GRADEBOOK_TEST_NOTES.md`                                             |
| Ungated smoke          | ☑       | `apps/web/e2e/23-gradebook-inventory-smoke.spec.ts`                                   |
| Live write E2E         | Partial | Service-level live Postgres smoke (artifact); Playwright gated on `E2E_BACKEND_READY` |
| Multidevice captures   | ☐       | Residual — not claimed                                                                |

---

## Residuals (honest)

1. Authenticated Playwright write journey (`E2E_BACKEND_READY=1`).
2. Multidevice PNG pack / device-farm.
3. Live IdP.
4. Crypto-sealed PDF print shop (PDF-lite HTML on disk is in scope and done).
5. Platform `@proctira/backend-audit` dual-write (service-local audit is done).
