# UX design review — Attendance

**Commit:** `0043e555` (`main`) · **Branch:** `ux/attendance-review` · **Date:** 2026-09-24
**Scope:** `/attendance`, `/attendance/ops`, `/attendance/reports`, plus the parent and student
portal attendance pages and the mobile Attendance tab.

First module in the plan because attendance is the highest-frequency journey in the product —
every teacher, every period, every day, under time pressure, often on a shared or mobile device.

---

## 1. Verdict

The surface is **live, not a dead shell**: `attendance` is `mounted: true` with `prisma+rls` and
`rbacWired: true` in `apps/api-gateway/src/mount-matrix.ts:173`, and is absent from
`EXPECTED_PARKED`.

The screens are competently built and visually consistent. Three defects make the module unfit
for its stated purpose, and all three are the same shape: **a capability was built and never
wired to the surface that needs it.**

| #        | Finding                                                                                               | Severity  | Verified by           |
| -------- | ----------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| **AT-1** | The purpose-built mobile attendance form is unrouted dead code; the phone tab serves the desktop grid | **Major** | execution + grep      |
| **AT-2** | The roster grid is not keyboard-navigable: ~5 tab stops per student, no radiogroup, no arrow keys     | **Major** | source, 5 buttons/row |
| **AT-3** | Three attendance reads render a 403 denial as "No roster yet"                                         | **Major** | source, unambiguous   |
| **AT-4** | Zero localisation across the whole attendance tree, inside a localised shell                          | **Major** | grep + execution      |
| **AT-5** | No conflict detection — two teachers marking one roster silently last-write-wins                      | Major     | source                |
| **AT-6** | Partial success is returned by the API and never shown to the user                                    | Minor     | source                |
| **AT-7** | "Mark all present" overwrites every row with no confirm or undo                                       | Minor     | source                |
| **AT-8** | Correction workflow requires hand-typing an `attendanceId`                                            | Minor     | source                |

---

## 2. AT-1 — The mobile experience is the desktop grid

`features/attendance/MobileAttendanceForm.tsx` is 688 lines of genuinely good mobile UX: one
student per row, four 48×48 touch targets (`min-h-[48px] min-w-[48px]`), correct
`role="radiogroup"` / `role="radio"` / `aria-checked` semantics, a live tally, an offline path
that enqueues to the sync queue, and a three-state submission banner
(`success | queued | error`) with `aria-live="polite"`.

**Nothing renders it.** `grep -rn "MobileAttendanceForm" src --include=*.tsx | grep -v '\.test\.'`
returns only self-references inside the file itself. It is reachable solely through
`featureRegistry.ts`, consumed by `RootRouter.tsx`, imported only by `app/App.tsx` — which
nothing imports. The repo already knows: `app/dead-internal-links.test.ts` calls
`featureRegistry.ts` "a mechanism the App Router does not read".

Meanwhile `components/layout/mobile-shell-routes.ts:19` points the phone's Attendance tab at
`/attendance` — the desktop server component.

Measured at 360×780:

```
mobileFormPresent   : false
desktopGridPresent  : true
horizontalOverflow  : false
```

Credit where due: no horizontal overflow, so the desktop grid does reflow. But a teacher on a
phone gets `aria-pressed` buttons in a table instead of the radiogroup built for them, and
**loses the offline queue entirely** — §4 below.

**This is the most valuable finding in the review**, because the fix is mostly routing, not
design. The hard work is already done and paid for.

---

## 3. AT-2 — The grid is not keyboard-first

The live control is `StatusToggle` (`attendance-marking-form.tsx:128-166`): a
`<div role="group">` of five plain `<button aria-pressed>` elements. Consequences:

- **~5 tab stops per student row.** A 40-student roster is ~200 tab stops before the first
  comment field.
- **No `role="radiogroup"` / `aria-checked`** — so assistive technology hears five independent
  toggle buttons, not one five-way choice. The _dead_ mobile form gets this right.
- **No arrow-key navigation, no roving `tabindex`, no type-ahead** (P/A/L/E), no
  `aria-rowindex`/`aria-colindex`, no sticky header.
- **Zero `onKeyDown`, `onKeyUp`, `tabIndex` or `.focus()`** anywhere in the attendance tree. The
  only `useRef` is a draft-hydration guard.
- After a failed submit, focus is **not** moved to the `role="alert"`. After "Load roster", focus
  is not moved to the grid.
- The sticky submit bar (`:552`) can overlay the last row with no scroll compensation.

For the product's highest-frequency data-entry task, this is the finding with the largest daily
cost. A clerk marking six classes of 40 cannot use the keyboard.

Also noted: the gated E2E `02-attendance.spec.ts:35` selects rows with
`page.getByRole('radio')`, which **cannot match** the live `aria-pressed` DOM. That spec is
pinned against semantics the live form does not have.

---

## 4. AT-3 — A denied roster reads as an empty class

`lib/api/attendance.ts` has three list reads on the old collapsing pattern:

| Function              | Line | Collapse                                                           |
| --------------------- | ---: | ------------------------------------------------------------------ |
| `getClassRoster`      |  131 | `return result.ok && result.data ? (result.data.data ?? []) : [];` |
| `listRegularisations` |  197 | same                                                               |
| `listLeaveRequests`   |  237 | same                                                               |

`gatewayFetch` with `throwOnError: false` returns `{ ok: false, status: 403, error }`. All three
discard `status` and `error`. So a teacher without `attendance.read` on that class sees:

> No roster yet. Choose an institution, class, academic period, and date, then click **Load roster**.

Indistinguishable from a class with no students. On `/attendance/ops` a 403 renders "No
regularisation requests yet." — which a clerk would reasonably read as "nothing to approve".

`fetchList` / `ListResult` exist in this worktree and other modules have migrated; attendance has
not. The parent portal proves the team knows better —
`(parent)/parent/attendance/page.tsx:33` branches on `result.status === 403` and passes
`forbidden` into `AcademicFrame`.

Two further silent swallows in `attendance/page.tsx:52-66`:
`listClassesByInstitution(...).catch(() => [])` and `listAcademicPeriods(...).catch(() => [])`.
A failed options read renders an empty picker with no explanation.

---

## 5. AT-4 — An untranslated island inside a translated shell

Nine locale catalogues ship (`ar bn en gu hi kn mr ta te`). The attendance tree uses **none** of
them: zero `useTranslations` / `getTranslations` across `(dashboard)/attendance/**`,
`features/attendance/**`, and both portal attendance pages.

The chrome around it _is_ localised — `sidebar.tsx` and `(dashboard)/loading.tsx` both translate —
so a Hindi-medium school sees a translated sidebar wrapped around an English screen.

Every string is a literal, including:

- `Mark attendance`, `Submit attendance`, `Mark all present`, `Load roster`
- `No roster yet. Choose an institution, class, academic period, and date…`
- status labels `Present | Absent | Late | Excused | Early`
- `` `Recorded ${n} new and updated ${m} existing records.` `` — plurals baked into a template
  literal, which cannot be translated correctly for languages with non-binary plural rules

Also not localisable as written: dates via `new Date().toISOString().slice(0, 10)` and
percentages via `value.toFixed(2) + '%'` rather than `Intl.NumberFormat`.

Measured at runtime on `/attendance`: `lang="en"`, `dir="ltr"`, `h1="Mark attendance"`.

---

## 6. AT-5 to AT-8 — state gaps

| Required state          | Present?                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loading                 | ⚠️ group `loading.tsx` only — no roster-shaped skeleton                                                                                                                            |
| empty                   | ✅ titled, explained, with a next step                                                                                                                                             |
| validation              | ✅ client zod pre-flight + server re-parse, `role="alert"`                                                                                                                         |
| **forbidden**           | ❌ collapses to empty (AT-3)                                                                                                                                                       |
| not-found               | ❌                                                                                                                                                                                 |
| **offline**             | ❌ nothing in the live tree — no `navigator.onLine`, no queue, no banner                                                                                                           |
| stale data              | ❌ no last-loaded timestamp                                                                                                                                                        |
| **conflict**            | ❌ no ETag, no `If-Match`, no version — two teachers on one roster silently last-write-wins (**AT-5**)                                                                             |
| **partial success**     | ⚠️ `BulkAttendanceResponse` carries `errors[]` and `summary.totalErrors`; the banner reports only `totalRecorded`/`totalUpdated`, so per-student failures are invisible (**AT-6**) |
| retry                   | ❌ no retry affordance on failure                                                                                                                                                  |
| **destructive confirm** | ❌ "Mark all present" rewrites every row, no confirm, no undo (**AT-7**)                                                                                                           |
| autosave indicator      | ⚠️ works (30 s debounce, flush before submit, clear on success) but the indicator is one static sentence — no timestamp, no saving→saved transition, no "draft restored" notice    |
| correction history      | ⚠️ the regularisation workflow exists, but the user must hand-type an `attendanceId` into a text input (`attendance-ops-forms.tsx:115`) — no link from a roster row (**AT-8**)     |

There is no `loading.tsx`, `error.tsx` or `not-found.tsx` inside any attendance segment.

`/attendance/ops` deserves credit: it surfaces its own known picker-truncation defect to the user
in a `role="status"` banner. That is the right instinct.

---

## 7. What was verified, and how

**By execution** (Playwright, chromium, throwaway probe):
mobile viewport renders the desktop grid and not the mobile form; no horizontal overflow at
360 px; `lang`/`dir`/`h1` on `/attendance`; the first 24 tab stops.

**By grep / source, unambiguous:** the dead-code import graph; the three collapsing reads; zero
i18n; absence of any keyboard handler; the mount-matrix row.

**NOT verified — stated rather than claimed:**

- **Per-row tab-stop count with a populated roster.** The probe environment has no live gateway,
  so `getClassRoster` returned `[]` and `rosterRows: 0`. The ~5-per-row figure is derived from
  five `STATUS_OPTIONS` rendered as buttons, not measured against real data.
- **RTL behaviour.** My first attempt set a `NEXT_LOCALE` cookie; the app switches locale through
  the language-selector UI, so that probe was invalid and I discarded it rather than report a
  false RTL defect. A second attempt timed out on the selector. **RTL on attendance is unverified.**
- **The 403 path in a live deployment.** The code path is unambiguous but was not exercised
  against a denied session.
- **Any screen-reader evidence.** None. No NVDA/JAWS/VoiceOver/TalkBack pass was performed, so
  nothing here supports a WCAG 2.2 AA claim. AT-2's semantics are read from source.
- **axe results for attendance routes.** `a11y-axe.spec.ts` covers them; I did not run it.
- **Whether `attendance.read` is granted to teacher roles in any seeded tenant** — so I cannot say
  whether the sidebar entry is visible in practice for a teacher. With the test session it is
  filtered out, which is correct behaviour, not a defect.
- **Backend conflict semantics.** AT-5 describes the _web_ layer having no conflict handling.
  Whether `packages/backend/attendance` detects concurrent edits was not read.

**No workflow was completed end to end.** No attendance was recorded against a live backend.

---

## 8. Recommended order

| #   | Fix                                                                | Why                                                                                                                             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **AT-3** convert the 3 reads to `ListResult`                       | Proven pattern, two domains already done, removes a misleading state on the highest-traffic screen                              |
| 2   | **AT-1** route the mobile form, or delete it                       | Either a built feature reaches users or dead code stops implying coverage. Needs a product decision on which                    |
| 3   | **AT-2** keyboard model                                            | Highest daily cost, but a real component rewrite: radiogroup semantics, roving tabindex, arrow keys, type-ahead, focus-on-error |
| 4   | **AT-4** localisation                                              | Mechanical but wide; 9 catalogues × every string. Fix the plural template literals properly rather than porting them            |
| 5   | **AT-6/7/8** partial success, destructive confirm, correction link | Small, independent, each a contained change                                                                                     |
| 6   | **AT-5** conflict detection                                        | Needs a backend contract decision (ETag / version column) before any UI                                                         |

AT-1 and AT-5 need rulings I do not own. AT-3 is the one I would start today.
