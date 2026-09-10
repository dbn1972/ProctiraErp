# Wave 8 — Functional Requirements Specification: LMS (Assignments · Homework · Quizzes) and Spiral PAL

**Document type:** FRS (functional + non-functional requirements, with traceability)  
**Status:** Baseline v1.0 — 2026-09-08 · **Owner:** ProctiraERP product engineering  
**Governs:** gaps **G-801 … G-808** in `docs/audits/ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md`  
**Related:** `docs/plans/LMS_LTI_EPIC.md` (external LMS interop — **out of scope here**), `docs/architecture/TENANCY_BOARD_SCHOOL.md`

---

## 1. Business context (BRD summary)

| Item             | Statement                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem          | ProctiraERP runs SIS, fees, health, campus services, but teachers still assign homework and quizzes on paper or in third-party tools. Learning evidence never reaches the SIS, and Boards cannot publish common work to all their schools.                  |
| Goal             | A native, tenant-safe LMS where **Boards publish shared assignments/quizzes to every school under them** and **schools author their own**, students submit and are auto-graded where possible, and a **Spiral PAL** engine schedules personalised revision. |
| Tenancy model    | `tenant` (RLS boundary, the SaaS customer) → `boards` (e.g. CBSE, State board) → `institutions` (schools). Every LMS row is `scope = board` (shared with all schools of `board_id`) or `scope = school` (owned by `institution_id`).                        |
| Primary users    | Board administrator, School principal, Teacher, Student, Parent (read-only).                                                                                                                                                                                |
| Success measures | Teacher can publish a quiz in ≤ 2 minutes; 100 % of quiz submissions auto-graded; every learner has a daily plan; zero cross-school or cross-tenant reads (proven by tests).                                                                                |
| Out of scope     | LTI 1.3 / external LMS connectors (see LTI epic), rich content authoring, video, plagiarism detection, proctoring, discussion forums.                                                                                                                       |

## 2. Actors and permissions

Gateway RBAC resource: **`lms`** (`apps/api-gateway/src/rbac-registry.ts`). HTTP verb → action mapping is the gateway default (GET=read, POST=create, PUT=update, DELETE=delete). Domain-level scope rules live in `packages/backend/lms/src/lms-service.ts`.

| Actor                  | Gateway permission                   | Domain rule                                                                                                                                   |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Board / tenant admin   | `lms:manage`                         | May author **board-scoped** and any school-scoped content; sees whole tenant.                                                                 |
| Principal              | `lms:manage`                         | Same as admin when `institutions` is empty; otherwise school-bound (below).                                                                   |
| Teacher (school-bound) | `lms:create/read/update/delete/list` | Only **school** scope for institutions in the JWT `institutions` claim; **cannot** publish board-wide; cannot read other schools' rows (404). |
| Staff                  | `lms:read`                           | Read within own school + board-shared.                                                                                                        |
| Student                | `lms:read`, `lms:create`             | Reads **published/closed** work only; answer key hidden; may submit / practise / view plan **only as `sub`** (self-binding → 403 otherwise).  |
| Parent / guardian      | `lms:read`                           | Read published work (child visibility is via parent-portal linkage — future).                                                                 |

## 3. Functional requirements

Notation: **FR-LMS-nnn** (assignments & submissions), **FR-PAL-nnn** (adaptive learning), **FR-UX-nnn** (web). Each row lists acceptance criteria and where it is proven.

### 3.1 Skills taxonomy (shared by quizzes and PAL)

| ID         | Requirement                                                                                                | Acceptance                                                                     | Trace                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| FR-PAL-001 | Staff can define skills (`code`, `name`, `subject`, `gradeLevel`, prerequisites) at board or school scope. | `POST /lms/skills` → 201; unique `(tenant, code)` → 409; unknown prereq → 400. | `routes.test.ts › skills`; `lms_skills` in `026_lms_schema.sql` |
| FR-PAL-002 | Skills visible to a school = own school skills + board-shared skills of its board.                         | `GET /lms/skills?institutionId&boardId` returns union; other school excluded.  | `matchesScope`, `scopeConditions`; `pg-lms-repository.test.ts`  |

### 3.2 Assignments, homework, quizzes

| ID         | Requirement                                                                                                                                                                              | Acceptance                                                                                   | Trace                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| FR-LMS-001 | One entity `lms_assignments` with `kind ∈ {assignment, homework, quiz}` and `scope ∈ {board, school}`; `boardId` required for board scope, `institutionId` for school scope.             | Missing target → 400 with field error.                                                       | `assertScopeTarget`; CHECK constraint `lms_assignments_scope_target` |
| FR-LMS-002 | Fields: title, description, subject, gradeLevel, sectionId, linked `skillIds`, `maxScore`, `dueAt`, `timeLimitMinutes`, `allowLate`, status.                                             | Unknown `skillIds` → 400.                                                                    | `CreateAssignmentSchema`, service `createAssignment`                 |
| FR-LMS-003 | Quizzes carry ordered multiple-choice questions (2–10 options, correct index, points, optional `skillId`, explanation). Non-quiz kinds reject questions.                                 | Homework with questions → 400; `correctOptionIndex ≥ options.length` → 400.                  | `normaliseQuestions`; `routes.test.ts`                               |
| FR-LMS-004 | Quiz `maxScore` defaults to the sum of question points.                                                                                                                                  | 3 questions (2+1+1) → `maxScore 4`.                                                          | `routes.test.ts › createQuiz`                                        |
| FR-LMS-005 | Lifecycle `draft → published → closed → archived`; `closed → published` allowed (reopen); `archived` terminal; a quiz cannot be published with zero questions.                           | Illegal transition → 422; publish sets `publishedAt` once.                                   | `assertTransition`; `/publish`, `/close` routes                      |
| FR-LMS-006 | Only **draft** assignments can be deleted; others must be archived.                                                                                                                      | DELETE on published → 422.                                                                   | `deleteAssignment`                                                   |
| FR-LMS-007 | Board-scoped content is visible to every school of that board; school-scoped content only to its school. School-bound callers without an explicit filter are pinned to their own school. | Teacher of School 1 lists board + School 1 rows, never School 2 rows; tenant admin sees all. | `listAssignments`; `routes.test.ts › board vs school scope`          |
| FR-LMS-008 | Cross-school IDOR by UUID and cross-tenant reads return **404** (no existence leak).                                                                                                     | Teacher of School 2 → 404; tenant B → 404 (RLS).                                             | `requireAssignment`; `pg-lms-repository.test.ts`                     |
| FR-LMS-009 | Learners see only published/closed work; drafts return 404; the answer key (`correctOptionIndex`, `explanation`) is hidden.                                                              | Student GET quiz → every `correctOptionIndex === -1`.                                        | `getAssignment`                                                      |

### 3.3 Submissions and grading

| ID         | Requirement                                                                                                         | Acceptance                                                    | Trace                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| FR-LMS-010 | One submission per `(assignment, student)`; duplicates → 409.                                                       | Second POST → 409 (in-memory and UNIQUE constraint).          | `submit`; `lms_submissions` UNIQUE |
| FR-LMS-011 | Submission only when `status = published`; after `dueAt` the submission is `late`; if `allowLate = false` → 422.    | Draft → 422; past due + allowLate=false → 422.                | `submit`                           |
| FR-LMS-012 | Students may submit only as themselves (`studentId === sub`).                                                       | Other studentId → 403.                                        | `submit`                           |
| FR-LMS-013 | Quiz submissions are auto-graded immediately; score scaled to `maxScore`; `status = graded`, `autoGraded = true`.   | 3/4 points on maxScore 4 → `score 3`.                         | `gradeQuiz`; `routes.test.ts`      |
| FR-LMS-014 | Staff grade homework/assignments (`score ≤ maxScore`, feedback, optional return-to-student); learners cannot grade. | Score > max → 400; student → 403; other-school teacher → 404. | `grade`                            |
| FR-LMS-015 | Learners list/see only their own submissions.                                                                       | Student list filtered by `sub`; foreign submission → 404.     | `listSubmissions`, `getSubmission` |

### 3.4 Spiral PAL (Personalised Adaptive Learning)

| ID         | Requirement                                                                                                                                                                                                                                                       | Acceptance                                                                               | Trace                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| FR-PAL-010 | Mastery per `(student, skill)` ∈ [0, 1], updated by an exponential moving average: correct never lowers, incorrect never raises mastery.                                                                                                                          | Property test, 300 runs.                                                                 | `applyAttempt`; `spiral-pal.test.ts`  |
| FR-PAL-011 | Spiral review interval grows `1 → 3 → 7 → 14 → 30 → 60` days on a correct streak and collapses to 1 day on any miss; `dueAt = now + interval`.                                                                                                                    | Unit + property tests.                                                                   | `intervalForStreak`                   |
| FR-PAL-012 | Every quiz answer with a `skillId`, and every graded homework/assignment (≥ 60 % = correct) for its linked skills, updates mastery and logs an attempt.                                                                                                           | After quiz: mastery rows for question skills; attempts count = answered skill questions. | `submit`, `grade` → `applyPalAttempt` |
| FR-PAL-013 | Students can record practice attempts for a skill; learners only for themselves.                                                                                                                                                                                  | `POST /lms/pal/students/:id/attempts` 201; other student → 403.                          | `recordAttempt`                       |
| FR-PAL-014 | Daily plan orders **due reviews (lowest mastery first) → reinforcement (mastery < 0.4) → new skills whose prerequisites are mastered (≥ 0.8)**; skills with unmastered prerequisites are reported as blocked and never scheduled; items unique; `limit` honoured. | Unit + property tests (200 runs).                                                        | `buildSpiralPlan`                     |
| FR-PAL-015 | Progress view per student: skill, mastery, streak, due date; summary counts (mastered / in progress / not started / average).                                                                                                                                     | `GET /lms/pal/students/:id/progress`.                                                    | `getProgress`                         |

### 3.5 Web experience (apps/web `/lms`)

| ID        | Requirement                                                                                                                                 | Acceptance                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| FR-UX-001 | `/lms` hub: KPIs (published, due this week, awaiting grading, quizzes), filter by kind/status/scope, table with scope badge (Board/School). | Server component, `getTranslations('lms')`, empty state with CTA.                   |
| FR-UX-002 | `/lms/assignments/new`: kind selector, scope selector (board/school), due date, max score, late policy, quiz question builder.              | Client form, `data-hydrated`, inline validation, server action, redirect to detail. |
| FR-UX-003 | `/lms/assignments/[id]`: detail, questions, submissions table, grade dialog, publish/close actions.                                         | Actions call gateway; errors shown with `role="alert"`.                             |
| FR-UX-004 | `/lms/pal`: skills list + student plan/progress lookup with mastery bars.                                                                   | Accessible progress meters (`role="meter"` with `aria-valuenow`).                   |
| FR-UX-005 | Sidebar entry "LMS", feature registry `lms.read`, route-permission coupling, unauthenticated → `/login`.                                    | `09-route-permission-coupling.spec.ts`, property test.                              |
| FR-UX-006 | All strings via `next-intl` in the `lms` namespace across the 9 locales; ICU plurals; parity test extended.                                 | `campus-i18n-parity.test.ts` REDESIGN_NAMESPACES includes `lms`.                    |
| FR-UX-007 | Included in authenticated axe, dark-mode, touch-target and page-regression matrices; visual baseline for hub.                               | Spec lists updated; CI job runs them.                                               |

## 4. Non-functional requirements

| ID      | Requirement                                                                                                                                                       | Evidence                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| NFR-001 | **Tenancy:** every table has `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, `tenant_isolation` policy on `app.tenant_id`; all queries run in `withPgTenant`. | `026_lms_schema.sql`; pg smoke shows owner sees 0 rows without tenant binding. |
| NFR-002 | **Persistence parity:** Postgres when `DATABASE_URL`, in-memory otherwise (never in production — `assertInMemoryFallbackAllowed`).                                | `create-lms-repository.ts`                                                     |
| NFR-003 | **Validation:** TypeBox schemas on every body/query/params; 400 with field errors.                                                                                | `schemas.ts`                                                                   |
| NFR-004 | **Default deny:** `/api/v1/lms` mapped in `PATH_RESOURCE_MAP`; unmapped prefixes are denied by the gateway (G-702).                                               | `gateway-mount-matrix.test.ts`, `rbac-enforcement.test.ts` deny row `lms`.     |
| NFR-005 | **Privacy:** answer keys never sent to learners; no PII beyond UUIDs in LMS rows; attempts store only correctness/time.                                           | `getAssignment`                                                                |
| NFR-006 | **Accessibility:** WCAG 2.1 AA on all `/lms*` routes (axe, keyboard, 44/48 px targets).                                                                           | `a11y-axe.spec.ts`, touch-target specs                                         |
| NFR-007 | **i18n / RTL:** 9 locales, `ar` RTL, logical CSS properties (`ps-/pe-/me-`).                                                                                      | messages `lms` namespace                                                       |
| NFR-008 | **Performance:** list endpoints paginated (≤ 100), indexed by `(tenant, scope, board, institution)`, `(tenant, kind, status)`, `(tenant, due_at)`.                | `026_lms_schema.sql` indexes                                                   |
| NFR-009 | **Regression safety:** every `(dashboard)` page is enumerated in a route matrix; adding a page without a regression entry fails a unit test.                      | G-804 route coverage test                                                      |
| NFR-010 | **Determinism:** PAL engine is pure (no I/O, injectable `now`) so results are reproducible and property-testable.                                                 | `spiral-pal.ts`                                                                |

## 5. Data model (summary)

| Table                   | Purpose                                  | Key constraints                                              |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `lms_skills`            | Skill taxonomy (board/school)            | `UNIQUE(tenant_id, code)`; scope target CHECK                |
| `lms_assignments`       | Assignment / homework / quiz             | kind + status CHECKs; scope target CHECK; `max_score > 0`    |
| `lms_quiz_questions`    | MCQ items                                | `UNIQUE(assignment_id, position)`; cascade delete            |
| `lms_submissions`       | Student work + grade                     | `UNIQUE(tenant_id, assignment_id, student_id)`; status CHECK |
| `lms_skill_mastery`     | Spiral PAL ledger                        | `UNIQUE(tenant_id, student_id, skill_id)`; `mastery ∈ [0,1]` |
| `lms_practice_attempts` | Attempt history (quiz/homework/practice) | source CHECK; `mastery_after ∈ [0,1]`                        |

## 6. API surface

See the header of `packages/backend/lms/src/routes.ts` (18 routes under `/api/v1/lms`). All responses are JSON; lists return `{ data, meta }`.

## 7. Traceability to Wave 8 gaps

| Gap   | Requirements covered                          |
| ----- | --------------------------------------------- |
| G-801 | FR-LMS-001 … 015, FR-PAL-001/002, NFR-001…005 |
| G-802 | FR-PAL-010 … 015, NFR-010                     |
| G-803 | FR-UX-001 … 006, NFR-006/007                  |
| G-804 | FR-UX-007, NFR-009                            |
| G-805 | FR-LMS-007/008, NFR-001, tenancy doc          |
| G-806 | FR-UX-007 (axe/dark/touch/visual)             |
| G-807 | pg integration tests, CI apply-sql `026`      |
| G-808 | audit evidence pack + hooks state             |

## 8. Assumptions and open decisions

1. `studentId` in LMS equals the learner's user id (`sub`) for self-service binding; SIS `students.id` ↔ user mapping is handled by the portal layer (same assumption as parent-portal G-306).
2. Section/class targeting uses `sectionId` as an opaque UUID (no FK) until the SIS master-schedule section API is stabilised.
3. Parent visibility of a child's homework is read-only via `lms:read` and depends on parent-portal links; a dedicated "my children's work" view is backlog.
4. Rich attachments are URL references (`attachments: string[]`) to the storage service; binary upload UI is backlog.
