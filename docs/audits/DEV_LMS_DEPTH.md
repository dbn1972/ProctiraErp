# Enterprise module development checklist

**Capability / module:** LMS depth (G-915) — bank, rubrics, uploads, discussions, content, analytics  
**Branch / tip:** `cursor/w9-g915-lms-56c3`  
**Owner / agent:** Wave 9 G-915 agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Canvas/Moodle-class bank + rubric + file drop + discussions + class progress, without LTI/SCORM  
**Dev session:** Wave 9 G-915  
**Paired test audit:** existing `docs/audits/LMS_ENTERPRISE_PRODUCTION_READY_AUDIT.md` (Wave 8); this slice adds depth tests, not a new 10/10 claim

---

## 0. Product contract

| Item                   | Content                      |
| ---------------------- | ---------------------------- |
| Capability statement   | See `docs/audits/PRODUCT_LMS_DEPTH.md` |
| In scope (peer parity) | Typed bank, rubric grades, storage uploads, moderated discussions, content library, class analytics |
| Explicit non-goals     | LTI/SCORM, AI marking, gradebook sync, live object-storage in CI |
| Roles (RBAC)           | Staff author/grade/moderate; student submit/post/read published; gateway resource `lms` unchanged |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: board/school `scope` only (existing LMS model) |

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| ------------- | ----- | --- | ------ | --- |
| Bank | `/lms/bank` | `POST/GET /lms/bank` | `lms_question_bank_items` | prompts (academic) |
| Rubrics | `/lms/rubrics` | `POST/GET /lms/rubrics` | `lms_rubrics`, `lms_rubric_criteria` | staff names via created_by |
| Rubric grade | assignment detail | `POST /lms/submissions/:id/rubric-grade` | `lms_rubric_grades` | scores, comments |
| Files | assignment detail | `POST /lms/assignments/:id/files` `GET /lms/files/:id` | `lms_submission_files` | filenames |
| Discussions | `/lms/discussions` | `/lms/discussions` | discussions + posts | student posts |
| Content | `/lms/content` | `POST/GET /lms/content` | `lms_content_items` | none beyond titles |
| Lessons | `/lms/lessons` | `/lms/lessons` | `lms_lessons`, `lms_lesson_resources` | none beyond titles |
| Analytics | `/lms/analytics` | `GET /lms/analytics` | derived | scores, student counts |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/038_lms_depth_schema.sql` |
| Constraints / indexes / FKs  | ☑    | type CHECKs, tenant indexes, assignment/submission FKs |
| Multi-board seed fixtures     | ☐    | Uses existing LMS board/school scope; no new 3-board seed |
| Domain unit/property tests    | ☑    | `grading-engine.test.ts` (MSQ/numeric/match/essay/rubric) |
| Invariants documented        | ☑    | MSQ exact set; numeric ±tolerance; match pair set; essay pending; hidden posts omitted for learners |

---

## 2. API / services

| Check                              | Done | Evidence |
| ---------------------------------- | ---- | -------- |
| Tenant middleware on all routes    | ☑    | existing LMS plugin + `withPgTenant` |
| Validation + typed errors          | ☑    | TypeBox schemas in `packages/backend/lms/src/schemas.ts` |
| RBAC enforced                      | ☑    | `canAuthor` / `isLearner` in `LmsService` |
| Conflict / rule failures → 409/422 | ☑    | duplicate submit 409; locked thread 422; quiz rules 422 |
| Idempotent writes where needed     | ☐    | submit remains unique (tenant, assignment, student) |
| Cross-tenant deny test             | ☑    | existing pg RLS smoke + e2e gated tenant B; route tests on in-memory |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| ------ | ------------------- | ----------- | ----------- | -------- |
| `/lms/bank` | ☑ empty card | ☑ create form | scope board/school | page + actions |
| `/lms/rubrics` | ☑ | ☑ | scope | page + actions |
| `/lms/discussions` | ☑ | ☑ post/lock/hide | class key | page |
| `/lms/lessons` | ☑ | ☑ staff create | scope | page; students read-only |
| assignment analytics | ☑ empty | read | quiz items | assignment detail |
| assignment detail files/rubric | ☑ | ☑ | n/a | existing detail + new forms |

---

## 4. Cross-module integration

| Dependency                                       | Integrated | Evidence |
| ------------------------------------------------ | ---------- | -------- |
| Institutions / periods                           | ☐          | class key is a free-text / section id string |
| Staff / students / enrollments                  | ☐          | studentId on submit unchanged |
| Attendance / assessments / exams (as applicable) | ☐        | not in slice |
| Exports / jobs (as applicable)                  | ☐          | n/a |
| Object storage                                   | ☑          | `@proctira/storage` via `lms-blob-store.ts` (G-914 pattern) |

---

## 5. Observability & audit

| Check                               | Done | Evidence |
| ----------------------------------- | ---- | -------- |
| Structured logs on writes           | ☐    | Relies on gateway request logs; no new domain audit table |
| Audit trail for sensitive mutations | ☐    | Rubric grades store `scored_by`; files store `created_by` |
| Async job status (if exports)       | ☐    | n/a |

---

## 6. Security & compliance

| Check                                | Done | Evidence |
| ------------------------------------ | ---- | -------- |
| Tenant isolation                     | ☑    | `038` RLS + `raw-sql-rls.test.ts` append |
| RBAC matrix documented               | ☑    | PRODUCT + existing `lms` registry |
| Export download auth                 | ☑    | file GET requires tenant + actor; Next proxy forwards session |
| Issued records immutable / versioned | ☐    | n/a |

---

## 7. Hand-off to production-ready **test** skill

| Check                                  | Done | Evidence |
| -------------------------------------- | ---- | -------- |
| Test checklist copied & filled         | ☐    | Not claiming production-ready |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐    | Spec committed, not run |
| Desktop + tablet + mobile captures     | ☐    | Not run |
| Tip CI green                           | ☐    | Not claimed |
| Scoreboard updated honestly            | ☐    | Gap remains until live chain |

---

## Exit — capability 10/10

| Gate                            | Pass |
| ------------------------------- | ---- |
| Peer parity for this slice      | ☐ slice implemented, not certified |
| Live SQL + seeds                | ☐ schema committed; not applied live here |
| Live API writes                 | ☐ gated e2e only |
| UI inventory complete           | ☑ pages exist |
| Rules tests green               | ☑ unit/route vitest (in-memory) |
| Board artifacts (if applicable) | ☐ n/a |
| Security evidence               | ☑ RLS unit + IDOR route tests |
| Test skill complete             | ☐ |
| CI green                        | ☐ |

**Residuals / waivers (dated):**

| Residual | Owner | Date |
| -------- | ----- | ---- |
| Live Postgres apply of 038 + Playwright live chain | CI / follow-up | 2026-09-09 |
| Full UX/a11y/mobile captures | test skill | 2026-09-09 |
| Multi-board seed pack | not in G-915 | 2026-09-09 |

**Verdict:** ☑ Not ready for a 10/10 product claim · implementation slice only
