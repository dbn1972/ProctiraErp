# Enterprise product / IA checklist

**Module / slice:** LMS depth (G-915) — question bank, rubrics, uploads, discussions, content library, class analytics  
**Branch / tip:** `cursor/w9-g915-lms-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Wave 9 G-915 agent

Copy → `docs/audits/PRODUCT_<MODULE>.md`. Complete **before** build.

---

## 1. Capability statement

Teachers and board authors can author a typed question bank (MCQ, MSQ, numeric, match, essay), assemble quizzes from those items, attach rubrics to assignments and essay questions, grade with per-criterion scores, accept storage-backed submission files, moderate class discussion threads (hide/lock), and publish a lesson/content library. Students submit typed quiz answers and files, read published content, and post in unlocked threads. Staff can open a class analytics view showing submission rate, average score, and mastery by skill/tag. This slice does not replace Spiral PAL, the existing assignment hub, or a full LTI/SCORM player.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| Teacher | Build mixed-type quizzes from a bank and grade essays with a rubric | Bank item appears on a quiz; essay stays in a grading queue; rubric total writes the submission score |
| Student | Submit homework with a file and take a mixed quiz | File is stored and listed; MSQ/numeric/match auto-grade; essay waits for the teacher |
| Student | Read published lesson resources for a class | Only published `link` / `file` / `text` items for their class/subject |
| Teacher | Moderate a class discussion | Can lock a thread and hide a post; learners cannot post on a locked thread |
| Head of department | See whether a class is keeping up | Analytics page shows submission rate, average score, mastery by skill |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| Question bank with mcq / msq / numeric / match / essay | LTI 1.3, SCORM, xAPI, video conferencing |
| Auto-grade MSQ (exact set), numeric (tolerance), match (pairs); essay → manual queue | Peer review, plagiarism detection, AI marking |
| Rubrics (criteria × levels) + per-submission grades | Standards-based gradebook sync (G-907 owns gradebook) |
| Storage-backed submission uploads (size/type validation) | Live S3/MinIO in CI; disk/in-memory fallback is honest |
| Discussion threads + posts with hide/lock | Real-time chat, reactions, @mentions |
| Content library (link \| file \| text), student read-only | Lesson planner / curriculum coverage (G-923) |
| Class analytics (rate, average, mastery by skill/tag) | Adaptive item response theory, dashboards beyond this class view |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| Canvas/Moodle question bank + quiz from bank | Typed bank + assemble-from-bank on quizzes |
| Rubric grading on assignments | Criteria × levels, per-criterion scores → total |
| File submissions | Storage-backed, mime/size checks, download proxy |
| Class discussions with moderation | Threads + posts, hide and lock |
| Content/modules | Published content items; students cannot author |
| Class progress | Submission rate, average score, skill/tag mastery |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell (staff / parent / public) |
| --------- | ----- | --- | --------------- | ------------------------------- |
| Learning hub | `/lms` | `/lms/assignments` | `lms_assignments` | Staff (students read published) |
| Question bank | `/lms/bank` | `/lms/bank` | `lms_question_bank` | Staff |
| Rubrics | `/lms/rubrics` | `/lms/rubrics` | `lms_rubrics`, `lms_rubric_criteria`, `lms_rubric_scores` | Staff |
| Discussions | `/lms/discussions` | `/lms/discussions` | `lms_discussions`, `lms_discussion_posts` | Staff + student post |
| Lessons | `/lms/lessons` | `/lms/lessons` | `lms_lessons`, `lms_lesson_resources` | Staff author; student read published |
| Content library | `/lms/content` | `/lms/content` | `lms_content_items` | Staff author; student read published |
| Class analytics | `/lms/analytics` | `/lms/analytics` | derived from submissions + bank tags | Staff |
| Assignment detail | `/lms/assignments/[id]` | submissions, files, rubric grade | `lms_submissions`, `lms_assignment_files` | Staff grade; student submit |
| File download | `/api/lms/files/[id]` | `/lms/files/:id` | object storage key | Authenticated |

## 6. Roles & tenancy (high level)

| Role | Can | Cannot |
| ---- | --- | ------ |
| admin / board_admin / principal / teacher / staff | Author bank, rubrics, content; assemble quizzes; grade; moderate; view analytics | Cross-tenant read/write |
| student | Submit own work, post in unlocked threads, read published content | Author bank/rubrics, see answer keys, un-hide posts, see other students' submissions |
| parent | Existing LMS read (registry) | Author or grade in this slice |

Tenant boundary notes: every new table has `tenant_id` + FORCE RLS using `app.tenant_id`. School-bound teachers stay on their institutions (existing LMS IDOR guard). Learners are bound to JWT `sub` on submit/post.

## 7. Success metrics / DoD

- [x] SQL 038 with RLS on every new table
- [x] Bank → quiz assemble; MSQ/numeric/match auto-grade; essay pending
- [x] Rubric grade endpoint writes per-criterion scores and submission total
- [x] File upload via `@proctira/storage` abstraction (S3/MinIO or disk)
- [x] Discussions hide/lock
- [x] Content library student read-only when published
- [x] Class analytics endpoint + page
- [x] Ungated e2e page smoke + gated live chain (bank → quiz → essay rubric → analytics) — spec committed, not executed here
- [ ] Live Postgres apply of 038 in CI / sandbox (deferred to tip CI)

## 8. Handoff

| Next skill | Audit path        |
| ---------- | ----------------- |
| Build      | `docs/audits/DEV_LMS_DEPTH.md` |
| UX         | Not a full designer pass this slice; pages follow LMS hub patterns |
| Security   | RLS unit + route IDOR tests; no SEC_ pack claimed |
| Test       | `apps/web/e2e/47-lms-depth-write-smoke.spec.ts` + backend vitest |
| Release    | Not shipped; no production-ready claim |
