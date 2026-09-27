# UX tip re-audit — 2026-09-27

Independent re-audit of the 26 Sep 2026 UX finding themes against tip `main`. This file does not edit `docs/audits/UX_FINDINGS_TIP_LEDGER.md` or any `SCREEN_TEST_*.md`. No product code was changed.

## Pin

| Item                           | Value                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip SHA                        | `2a69829df8015fedf5accfeede6d9438ff097401`                                                                                                                                                                                                                                                                |
| Tip subject                    | `fix(e2e): retry hydration-race testids instead of asserting once (#429)`                                                                                                                                                                                                                                 |
| Ledger pin this audit outranks | `e9974367` in `docs/audits/UX_FINDINGS_TIP_LEDGER.md` (2026-09-26)                                                                                                                                                                                                                                        |
| Evidence class                 | **Code-only.** The web app was not booted and no screenshots were captured. Visual hierarchy, contrast, and live empty/error rendering are `EXTERNALLY_UNVERIFIED`.                                                                                                                                       |
| Original report                | `UX_FINDINGS.md` / `proctira-design/UX_FINDINGS.md` is **not in the repo**. A search for `UX_FINDINGS*` returns only the tip ledger. The 304 high / 1003 observation totals and the per-theme sizes below are reconstructed from the task brief and the ledger. They are **not** row-matched on this tip. |

Disposition vocabulary used here: `FULLY_CLOSED` · `PARTIAL` · `OPEN` · `REGRESSED` · `EXTERNALLY_UNVERIFIED`.

No theme is `REGRESSED`. Nothing that the ledger marked closed was found reopened as a user-visible defect. Several ledger `OPEN` rows are cleared on this newer tip; that does not close the parent theme.

`SCREEN_TEST_*.md` rows on this tip are `NOT_RUN` for live Sunrise exercise. They were not used as proof that a UX finding is closed.

## Method

Grep and file reads on `apps/web`, `apps/admin-console`, `apps/mobile`, `apps/public-website`, `apps/registration-portal`, and `apps/install-wizard` at the pin above:

- truncated ids (`slice(0, 8)`) and labels/placeholders containing `UUID` or `School ID`
- raw `<Input>` for `studentId` / `staffId` / `institutionId` / `hostelId` / `routeId` where the same file has no `EntitySearchSelect`
- `ConfirmActionDialog` and second-step dialogs versus approve/reject/delete/pay controls
- `ScaffoldModeBanner`, demo-mode copy, and “coming soon”
- `list-result.drift.test.ts` `BASELINE` and route-group `loading.tsx` / `error.tsx`
- `useTranslations` / `getTranslations` versus dashboard `page.tsx` files
- `size="icon"` buttons versus `aria-label`
- raw `<table>` elements whose file has no `overflow-x` / `overflow-auto` (shadcn `Table` wraps `overflow-auto` in `packages/ui/components/src/Table.tsx:11` and is not counted)

Attendance UI is cited where the defect is still in tip code. Fix ownership stays with open PR #386. This audit does not edit that lane.

## Theme rollup

Original observation counts are the 26 Sep inventory sizes. Residual counts are **this scan’s hits**, not a claim that the other original rows are closed.

| Theme                                            | Original obs. |                                                                                 Tip residual (this scan) | Disposition | Why                                                                                                                                                            |
| ------------------------------------------------ | ------------: | -------------------------------------------------------------------------------------------------------: | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour-only status                               |          ~112 |                                                1 strict dot; 3 colour-band bars that also print a number | `PARTIAL`   | Sampled status pills include a text label. Colour still encodes the band. The 112-row list cannot be closed without the source file.                           |
| Raw / truncated UUID as a primary label or input |           ~86 |                                                                              22 user-visible sites below | `PARTIAL`   | Fees structure, dunning, netting, and hostel mess pickers are name search on tip. Truncations and paste fields remain.                                         |
| Accessibility                                    |           ~70 |                                            Route groups without an error boundary; one hidden colour dot | `PARTIAL`   | Sampled icon buttons expose `aria-label`. Keyboard, contrast, and screen-reader passes were not run.                                                           |
| No confirm on destructive or money actions       |           ~68 |                                                                   6 surfaces still submit on first click | `PARTIAL`   | Shared `ConfirmActionDialog` covers the W1/W9 money paths that were re-read. Gate, scholarship review, role delete, theme reject, and transcript issue do not. |
| Developer / scaffold copy                        |           ~41 | Admin landing always forces a scaffold banner; reports, warehouse, and notification rules still mount it | `PARTIAL`   | Honesty banners are intentional and still developer-voiced.                                                                                                    |
| Missing empty / loading / error                  |           ~36 |                   Drift `BASELINE` **107**; `(public)` and admin-console have no route `loading`/`error` | `PARTIAL`   | Student, parent, auth, and dashboard route groups have boundaries. List failure still collapses to an empty array at 107 call sites.                           |
| i18n                                             |           ~34 |                                                   10 of 166 dashboard `page.tsx` files call translations | `PARTIAL`   | Auth forms and most registration-portal screens use catalogs. Dashboard copy is still hardcoded English beside `messages/{en,ar}`.                             |
| Inert controls                                   |           ~20 |                                      1 disabled upload that explains itself; unused “coming soon” widget | `PARTIAL`   | No empty `onClick={() => {}}` primary button was found. The original 20 rows were not re-matched, so the theme is not `FULLY_CLOSED`.                          |
| Mobile tables                                    |           ~13 |                                                            11 raw `<table>` files with no overflow class | `PARTIAL`   | shadcn `Table` scrolls. Hand-rolled tables in staff, students, institutions, workflows, assessment, LMS depth grades, and the public site do not.              |

### Slices verified closed on this tip

These are slices, not the parent theme.

| Slice                                                                                                      | Disposition                         | Tip evidence                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student portal route loading and error boundaries                                                          | `FULLY_CLOSED`                      | `apps/web/src/app/(student)/loading.tsx:3` renders `RouteLoadingPanel`. `apps/web/src/app/(student)/error.tsx:12` renders `RouteErrorPanel` with `reset`.                                                                      |
| Public Privacy / Terms / Cookies visitor last-reviewed line                                                | `FULLY_CLOSED`                      | `apps/public-website/src/app/privacy/page.tsx:28`, `terms/page.tsx:27`, `cookies/page.tsx:27` each render “Last reviewed: 26 September 2026”. No “before public launch” string remains in public-website TSX.                  |
| Registration date-of-birth kept out of the URL                                                             | `FULLY_CLOSED`                      | `apps/registration-portal/src/app/track/lookup/route.ts:27-32` sets httpOnly cookie `registration_track_dob`. `apps/registration-portal/src/app/track/[trackingNumber]/page.tsx:31-33` redirects away when `?dob=` is present. |
| Mobile home tiles pass `studentId`                                                                         | `FULLY_CLOSED`                      | `apps/mobile/lib/features/home/presentation/home_screen.dart:82` and `:123-144` call `withStudentQuery` for assessments, examinations, scholarships, and health.                                                               |
| Admin tenant decommission / offboard second step                                                           | `FULLY_CLOSED`                      | `apps/admin-console/src/app/(admin)/tenants/[id]/lifecycle-actions.tsx:64-71` routes those two actions through `ConfirmedActionButton`. Copy at `:114-124` states the action is separate from the reason check.                |
| Fees structure, scholarship netting, dunning, and hostel mess UUID paste fields named in the 26 Sep ledger | `FULLY_CLOSED` for those four files | `fees/_components/structures-workspace.tsx:172`, `scholarship-netting-form.tsx:103`, `dunning-console.tsx:343`, and `hostel/_components/mess-ops-forms.tsx:276` use `EntitySearchSelect`.                                      |

## Per-module

Disposition is for residuals found in code on this tip. `EXTERNALLY_UNVERIFIED` means this scan did not find a cited residual and did not view the screen, so the original highs for that module are not closed.

| Module           | Disposition             | Tip residual                                                                                                                                                    |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile           | `PARTIAL`               | Home `studentId` query is closed. Parent child list and document upload are not.                                                                                |
| institutions     | `PARTIAL`               | Substitution labels are truncated staff/meeting ids. Attendance and utilization bars use colour plus a number.                                                  |
| staff            | `PARTIAL`               | `features/staff/pages/StaffDirectory.tsx` table has no overflow wrapper. Contract create uses a staff picker.                                                   |
| parent           | `PARTIAL`               | Offer fee line still prints a truncated invoice id. Web parent lists were not re-captured.                                                                      |
| student          | `EXTERNALLY_UNVERIFIED` | Route `loading`/`error` exist. No UUID or scaffold hit under `app/(student)`. Screens were not viewed.                                                          |
| admin-console    | `PARTIAL`               | Decommission confirm is closed. Tenant overview still prints the raw tenant id. Theme reject has no second step.                                                |
| lms              | `OPEN`                  | Lesson, content, rubric, bank, and discussion forms ask for School ID as a free-text field.                                                                     |
| health           | `PARTIAL`               | Allergy, vaccination, and incident student fields use a directory picker. Counselling still pastes Student ID and Counsellor ID.                                |
| registration     | `PARTIAL`               | DOB-in-URL is closed. 20 of 32 TSX files call translations; the rest were not proven complete.                                                                  |
| examinations     | `PARTIAL`               | Status pills use `STATUS_LABEL` text. Candidate options fall back to a truncated id.                                                                            |
| fees             | `PARTIAL`               | Structure, netting, and dunning pickers are closed. Reconciliation still shows truncated batch and invoice ids. Pay and refund dialogs were present on re-read. |
| communication    | `OPEN`                  | Hostel and route campaign scope still ask for a UUID.                                                                                                           |
| hostel           | `PARTIAL`               | Mess student picker is closed. Gate-pass approve/reject submits on first click.                                                                                 |
| students         | `PARTIAL`               | Directory table has no overflow wrapper. Sibling link is a raw student id.                                                                                      |
| website          | `PARTIAL`               | Legal banners are closed. Status and compliance tables are raw `<table>` without a horizontal scroll class.                                                     |
| auth             | `PARTIAL`               | Login, MFA, and reset use `useTranslations`. Demo-mode banner prints the env var name. `(public)` has no route error boundary.                                  |
| admin            | `PARTIAL`               | Administration landing always forces an “ops stub / UI scaffold” banner.                                                                                        |
| assessments      | `PARTIAL`               | `features/assessment/pages/AssessmentResultsEntry.tsx` raw table has no overflow class. In-form row remove is local draft editing, not a stored delete.         |
| reports          | `PARTIAL`               | Reports catalog mounts `ScaffoldModeBanner`.                                                                                                                    |
| transport        | `OPEN`                  | Attendance option labels are truncated student and route ids.                                                                                                   |
| workflows        | `PARTIAL`               | `WorkflowDetail.tsx` and `WorkflowInbox.tsx` raw tables have no overflow class.                                                                                 |
| developer        | `EXTERNALLY_UNVERIFIED` | No `app/**/developer` route exists on tip. Original developer-module highs were not row-matched.                                                                |
| admissions       | `OPEN`                  | Interview slot asks for Institution UUID. Waitlist primary line is a truncated application id.                                                                  |
| data-warehouse   | `PARTIAL`               | Field-mapping, import, map, and landing pages mount `ScaffoldModeBanner`.                                                                                       |
| library          | `EXTERNALLY_UNVERIFIED` | Clearance, checkout, and hold use `EntitySearchSelect`. No other library residual was opened. Screens were not viewed.                                          |
| scholarships     | `OPEN`                  | Review queue bulk and single approve/reject have no confirm dialog. Status text is a snake_case replace, which is text, not colour-only.                        |
| academic-periods | `PARTIAL`               | Bell-schedule heading falls back to the raw period id when the period service fails. Icon buttons in the periods manager have `aria-label`s.                    |
| public           | `PARTIAL`               | Same as website for legal copy. `apps/web/src/app/(public)` has neither `loading.tsx` nor `error.tsx`.                                                          |
| install          | `EXTERNALLY_UNVERIFIED` | Install-wizard broker list is operator configuration. Original install-screen highs were not viewed.                                                            |
| audit-logs       | `PARTIAL`               | DSAR page still branches on `source === 'scaffold'` at `audit-logs/dsar/page.tsx:133`.                                                                          |
| dashboard        | `PARTIAL`               | Home mounts `ScaffoldModeBanner` when the role dashboard source is scaffold. Cross-board transfer actions are wired to a mock hook.                             |
| billing          | `EXTERNALLY_UNVERIFIED` | No pay click-handler was found under `app/(dashboard)/billing`. The screen was not viewed.                                                                      |
| notifications    | `PARTIAL`               | Notification rules mount `ScaffoldModeBanner` (`admin/notification-rules/page.tsx:52`).                                                                         |
| pipelines        | `PARTIAL`               | Warehouse import/map scaffolds above. Pipeline builder field-row remove is in-form editing (`features/etl/pages/PipelineBuilder.tsx:600`).                      |

## Prioritized residuals

Suggested fixes are for a follow-up wave. Attendance rows are listed so they are not forgotten; do not edit them while #386 is open.

### mobile

1. **OPEN** — Parent home has no child picker. `apps/mobile/lib/features/parent_portal/presentation/parent_home_screen.dart:34-42` renders “No linked child” and says the list is not available in this build. **Fix:** load the existing parent-portal children API and pass the selected id into messages, consents, and fees. If that API is absent, keep the honest empty state and do not add a fake child.
2. **PARTIAL** — Scholarship document upload is a disabled button. `apps/mobile/lib/features/scholarship/presentation/scholarship_application_screen.dart:269-286` explains the gap and sets `onPressed: null`. **Fix:** leave it disabled until an upload route exists, or remove the button and keep the sentence.

### lms

3. **OPEN** — Lesson form School ID paste. `apps/web/src/app/(dashboard)/lms/_components/lesson-form.tsx:47-48`. **Fix:** `EntitySearchSelect` fed by `listInstitutions`.
4. **OPEN** — Content form School ID paste. `apps/web/src/app/(dashboard)/lms/_components/content-form.tsx:48-49`. **Fix:** same picker.
5. **OPEN** — Rubric form School ID paste. `apps/web/src/app/(dashboard)/lms/_components/rubric-form.tsx:46-47`. **Fix:** same picker.
6. **OPEN** — Question-bank School ID paste. `apps/web/src/app/(dashboard)/lms/_components/bank-item-form.tsx:66-67`. **Fix:** same picker.
7. **OPEN** — Discussion School ID paste. `apps/web/src/app/(dashboard)/lms/_components/discussion-forms.tsx:52-54`. **Fix:** same picker, optional.
8. **OPEN** — Depth grading asks for Criterion ID when criteria are not loaded. `apps/web/src/app/(dashboard)/lms/_components/depth-grade-forms.tsx:109-117`. The same file’s `<table` at `:66` has no overflow class. **Fix:** criterion `<select>` from the rubric, and wrap the table in `overflow-x-auto`.

### admissions

9. **OPEN** — New interview slot requires Institution UUID. `apps/web/src/app/(dashboard)/admissions/_components/new-interview-slot-form.tsx:69-72`. **Fix:** institution `EntitySearchSelect`.
10. **OPEN** — Waitlist primary line is a truncated application id. `apps/web/src/app/(dashboard)/admissions/page.tsx:108`. **Fix:** applicant name plus application number from the admissions directory.
11. **PARTIAL** — Merit score form asks for Application ID text. `apps/web/src/app/(dashboard)/admissions/_components/merit-panel.tsx:119-127`. **Fix:** application search select.
12. **PARTIAL** — Seat matrix falls back to eight id characters. `apps/web/src/app/(dashboard)/admissions/_components/seat-matrix-panel.tsx:34`. **Fix:** show the institution name or “Unknown institution”, not a slice.

### communication

13. **OPEN** — Campaign hostel scope is “Hostel UUID (optional)”. `apps/web/src/app/(dashboard)/communication/_components/new-campaign-form.tsx:179-180`. **Fix:** hostel picker.
14. **OPEN** — Campaign route scope is “Route UUID (optional)”. `apps/web/src/app/(dashboard)/communication/_components/new-campaign-form.tsx:184-185`. **Fix:** route picker.

### transport

15. **OPEN** — Attendance student options render truncated ids. `apps/web/src/app/(dashboard)/transport/_components/attendance-panel.tsx:121`. **Fix:** resolve student and route names before rendering `<option>`.

### scholarships

16. **OPEN** — Bulk approve and bulk reject fire immediately. `apps/web/src/features/scholarships/pages/ScholarshipReviewQueue.tsx:208-220`. **Fix:** `ConfirmActionDialog` before `handleBulkAction`, destructive for reject.
17. **OPEN** — Single reject fires immediately. Same file `:325-329`. **Fix:** same dialog. The dashboard scholarship decision form already uses `ConfirmActionDialog`; point this legacy feature page at it.

### health

18. **OPEN** — Counselling session pastes example UUIDs. `apps/web/src/app/(dashboard)/health/_components/create-counselling-session-form.tsx:130-148` placeholders `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1` and `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`. **Fix:** student and staff `EntitySearchSelect`, matching the allergy form.
19. **PARTIAL** — Nurse incident still has a free-text Institution ID. `apps/web/src/app/(dashboard)/health/_components/create-nurse-incident-form.tsx:90-91`. Student on that form is already a picker. **Fix:** optional institution picker.

### hostel

20. **OPEN** — Gate pass approve and reject have no confirm step. `apps/web/src/app/(dashboard)/hostel/_components/gate-pass-actions.tsx:32-51`. **Fix:** `ConfirmActionDialog` on reject; approve can share it.

### admin-console

21. **PARTIAL** — Tenant overview primary facts include the raw id. `apps/admin-console/src/app/(admin)/tenants/[id]/page.tsx:97` `['Tenant ID', tenant.id]`. **Fix:** show slug as the primary identifier and move the full id under a disclosure labeled “Copy tenant id”.
22. **OPEN** — Theme reject submits with the approve button in one form. `apps/admin-console/src/app/(admin)/themes/[id]/page.tsx:93-98`. Notes are required; there is no second confirm. **Fix:** confirm dialog on reject.

### admin, reports, notifications, data-warehouse, dashboard

23. **OPEN** — Administration landing always shows scaffold copy. `apps/web/src/app/(dashboard)/admin/page.tsx:30-34` `force` banner: “ops stub / UI scaffold”. **Fix:** when the tenant-admin APIs are live, drop `force` and the words “ops stub”. Keep a short outage banner only when `source === 'scaffold'`.
24. **PARTIAL** — Reports catalog scaffold banner. `apps/web/src/app/(dashboard)/reports/page.tsx:73`. **Fix:** same pattern: banner only when the gateway is unreachable, title in operator-free language (“Reports service unavailable”).
25. **PARTIAL** — Notification rules scaffold banner. `apps/web/src/app/(dashboard)/admin/notification-rules/page.tsx:52-56`. **Fix:** same outage wording.
26. **PARTIAL** — Home role dashboard scaffold banner. `apps/web/src/app/(dashboard)/page.tsx:135-138`. **Fix:** same outage wording.
27. **PARTIAL** — Cross-board approve/reject call `fire` with no confirm, and the file header still says the hook returns a deterministic mock. `apps/web/src/features/dashboards/pages/CrossBoardTransferDashboard.tsx:18-22` and `:385-391`. **Fix:** confirm reject, and replace the mock hook before the buttons are enabled for a real approver.

### fees, parent, examinations, institutions, academic-periods

28. **PARTIAL** — Reconciliation success text and match rows truncate ids. `apps/web/src/app/(dashboard)/fees/_components/reconciliation-workspace.tsx:79` and `:242`. **Fix:** show invoice number (already the title at `:239`) and a batch reference, not `batchId.slice(0, 8)`.
29. **PARTIAL** — Parent offer fee line truncates the invoice id. `apps/web/src/app/(parent)/parent/offers/_components/accept-offer-form.tsx:113`. **Fix:** invoice number or “Fee invoice ready”.
30. **PARTIAL** — Exam ops candidate label falls back to a truncated candidate id. `apps/web/src/app/(dashboard)/examinations/[id]/ops/page.tsx:52`. **Fix:** “Candidate” plus admission number when the student directory misses.

Further residuals, still open, outside the top 30:

- Timetable substitution picker and list. `apps/web/src/app/(dashboard)/institutions/[id]/timetable/substitutions/page.tsx:44` and `:114-115`. **Fix:** staff display names and meeting period labels.
- Bell schedule title falls back to the full period UUID. `apps/web/src/app/(dashboard)/academic-periods/[id]/bell-schedules/page.tsx:28-33` and `:83`. **Fix:** “This period” when the name lookup fails.
- Breadcrumb UUID segments. `apps/web/src/components/layout/breadcrumbs.tsx:111-112`. **Fix:** keep the institution resolver; for other entities show the route title, not eight hex digits.
- Shared label fallback. `apps/web/src/lib/entity-label.ts:55`. **Fix:** “Unknown record” unless a screen opts into a short reference code.
- Roster bulk assign placeholder and failure note. `apps/web/src/components/timetable/section-roster-controls.tsx:162` and `:172-184`. **Fix:** multi-select from `studentOptions`.
- Official transcript issue has no confirm and a raw Student ID field. `apps/web/src/components/gradebook/issue-transcript-form.tsx:35-46`. **Fix:** student picker plus `ConfirmActionDialog`.
- Role delete has no confirm. `apps/web/src/features/settings/pages/RolesPermissions.tsx:540-547`. **Fix:** `ConfirmActionDialog` with `destructive`.
- Colour-only connectivity dot, hidden from assistive tech. `apps/web/src/components/layout/MobileShell.tsx:252-259`. **Fix:** a connectivity control with text (“Online” / “Offline”), or remove the placeholder.
- Colour-band bars that also print the number (not colour-only, still the band): `apps/web/src/app/(dashboard)/institutions/page.tsx:118-137`, `institutions/[id]/grades/page.tsx:46-67`. **Fix:** add the band word next to the percent everywhere the bar colour changes (grades utilization already does this at `:67`).
- List collapse ratchet. `apps/web/src/lib/api/list-result.drift.test.ts:43` `BASELINE = 107` (ledger recorded 118). **Fix:** convert collapsing reads to `fetchList` and lower the baseline in the same change. Do not treat 107 as closed.
- `(public)` has no `loading.tsx` or `error.tsx`. Admin-console `(admin)` has neither. **Fix:** the same `RouteLoadingPanel` / `RouteErrorPanel` pair used by `(student)`.
- Dashboard i18n. 166 `page.tsx` files under `apps/web/src/app/(dashboard)`, 10 of which call `useTranslations` or `getTranslations`. **Fix:** move shared chrome and the highest-traffic module headings into the existing `en`/`ar` catalogs before translating every form.
- Raw tables without a scroll wrapper: `features/students/pages/StudentsDirectory.tsx:125`, `features/staff/pages/StaffDirectory.tsx:116`, `features/institutions/pages/InstitutionsList.tsx:117`, `features/workflows/pages/WorkflowDetail.tsx:524`, `features/workflows/pages/WorkflowInbox.tsx:321`, `features/assessment/pages/AssessmentResultsEntry.tsx:180`, `apps/public-website/src/app/status/page.tsx:150`, `apps/public-website/src/app/compliance/page.tsx:185`. **Fix:** `overflow-x-auto` or the shared `Table`.
- Sibling id paste. `apps/web/src/app/(dashboard)/students/_components/student-360-panel.tsx:299-303`. **Fix:** student search select.
- Auth demo banner prints `NEXT_PUBLIC_AUTH_DEMO_MODE`. `apps/web/src/components/auth/auth-demo-mode-banner.tsx:21-26`. **Fix:** “Sign-in is running in a local demo configuration.”
- Attendance report column is a truncated student id. `apps/web/src/app/(dashboard)/attendance/_components/attendance-report-filters.tsx:341`. **Fix:** student name. Leave the edit to #386.

## Count honesty

| Claim                                   | Status                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| All ~304 highs `FULLY_CLOSED`           | Forbidden. Source file is absent and the residuals above are on tip `2a69829d`. |
| Any theme in the rollup `FULLY_CLOSED`  | Not claimed. Closed slices are listed separately.                               |
| Ledger theme dispositions at `e9974367` | Stale. #412 and #413 are on this tip. This file outranks that ledger.           |
| UX reviewed / 10/10 / production-ready  | Not claimed. Evidence is code-only.                                             |
| `REGRESSED`                             | None observed.                                                                  |
