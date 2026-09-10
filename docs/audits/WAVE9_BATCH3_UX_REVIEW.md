# Enterprise UX design review — Wave 9 batch 3

**Scope:** Wave 9 batch 3 (G-909 reports · G-915 LMS · G-916 library · G-917 timetable · G-918 staff HR · G-919 attendance ops · G-920 transport · G-921 hostel · G-922 circulars)  
**Branch / tip:** `cursor/w9-cap-56c3`  
**Date (UTC):** 2026-09-09  
**Reviewer / agent:** Cursor cloud agent (Wave 9 capture session)  
**Paired test audit:** `docs/audits/WAVE9_GAP_CLOSURE_TEST_EVIDENCE.md`  
**Captures root:** `apps/web/screens/wave9-b3/` (120 PNGs — 40 screens × desktop 1440 / tablet 834 / mobile 390)

---

## 0. Inventory

| Screen                        | Route                                        | Desktop | Tablet | Mobile | Notes                                    |
| ----------------------------- | -------------------------------------------- | ------- | ------ | ------ | ---------------------------------------- |
| Reports catalogue             | `/reports`                                   | ☑       | ☑      | ☑      | 5 ready-made reports + export forms      |
| Reports schedules             | `/reports/schedules`                         | ☑       | ☑      | ☑      | Empty schedule list                      |
| Reports dashboards            | `/reports/dashboards`                        | ☑       | ☑      | ☑      | Role dashboard picker                    |
| Reports dashboard             | `/reports/dashboard`                         | ☑       | ☑      | ☑      | Principal-style dashboard shell          |
| LMS hub                       | `/lms`                                       | ☑       | ☑      | ☑      | Empty coursework; chips for depth routes |
| LMS bank                      | `/lms/bank`                                  | ☑       | ☑      | ☑      | Question bank form                       |
| LMS rubrics                   | `/lms/rubrics`                               | ☑       | ☑      | ☑      | Rubric builder                           |
| LMS discussions               | `/lms/discussions`                           | ☑       | ☑      | ☑      | Thread list                              |
| LMS lessons                   | `/lms/lessons`                               | ☑       | ☑      | ☑      | Lesson planner                           |
| LMS content                   | `/lms/content`                               | ☑       | ☑      | ☑      | Content library                          |
| LMS analytics                 | `/lms/analytics`                             | ☑       | ☑      | ☑      | Class 7A filter; zero metrics            |
| Library catalogue             | `/library`                                   | ☑       | ☑      | ☑      | 3 seeded items incl. capture fixture     |
| Library OPAC                  | `/library/opac`                              | ☑       | ☑      | ☑      | Search empty state                       |
| Library circulation           | `/library/circulation`                       | ☑       | ☑      | ☑      | Barcode checkout/return fields           |
| Library holds                 | `/library/holds`                             | ☑       | ☑      | ☑      | Holds queue                              |
| Library fines                 | `/library/fines`                             | ☑       | ☑      | ☑      | Fines list                               |
| Library detail                | `/library/[id]`                              | ☑       | ☑      | ☑      | Seeded “Capture Book …” title            |
| Hostel mess                   | `/hostel/mess`                               | ☑       | ☑      | ☑      | Mess menu form                           |
| Hostel gate passes            | `/hostel/gate-passes`                        | ☑       | ☑      | ☑      | Request form                             |
| Hostel fees                   | `/hostel/fees`                               | ☑       | ☑      | ☑      | Fee rules                                |
| Hostel attendance             | `/hostel/attendance`                         | ☑       | ☑      | ☑      | Roll grid                                |
| Timetable generate            | `/institutions/[id]/timetable/generate`      | ☑       | ☑      | ☑      | No jobs; prerequisite copy               |
| Timetable substitutions       | `/institutions/[id]/timetable/substitutions` | ☑       | ☑      | ☑      | No staff/meetings                        |
| Attendance ops                | `/attendance/ops`                            | ☑       | ☑      | ☑      | Regularisation + leave forms             |
| Staff list                    | `/staff`                                     | ☑       | ☑      | ☑      | Directory                                |
| Staff attendance              | `/staff/attendance`                          | ☑       | ☑      | ☑      | Empty mark grid                          |
| Staff import                  | `/staff/import`                              | ☑       | ☑      | ☑      | Bulk CSV                                 |
| Staff payroll                 | `/staff/payroll`                             | ☑       | ☑      | ☑      | No rows for current month                |
| Staff contracts               | `/staff/contracts`                           | ☑       | ☑      | ☑      | Contract list                            |
| Communication hub             | `/communication`                             | ☑       | ☑      | ☑      | Four module cards                        |
| Communication circulars       | `/communication/circulars`                   | ☑       | ☑      | ☑      | List incl. seeded circular               |
| Communication circulars new   | `/communication/circulars/new`               | ☑       | ☑      | ☑      | Compose form                             |
| Communication delivery        | `/communication/delivery`                    | ☑       | ☑      | ☑      | Delivery log                             |
| Communication circular detail | `/communication/circulars/[id]`              | ☑       | ☑      | ☑      | Ack panel with 2 pending                 |
| Transport hub                 | `/transport`                                 | ☑       | ☑      | ☑      | Module overview                          |
| Transport live                | `/transport/live`                            | ☑       | ☑      | ☑      | GPS ping + seeded vehicle                |
| Transport attendance          | `/transport/attendance`                      | ☑       | ☑      | ☑      | Bus attendance                           |
| Transport alerts              | `/transport/alerts`                          | ☑       | ☑      | ☑      | Alert rules                              |
| Transport fees                | `/transport/fees`                            | ☑       | ☑      | ☑      | Route fees                               |
| Transport route stops         | `/transport/routes/[id]/stops`               | ☑       | ☑      | ☑      | Seeded route + Oak Stop                  |

**Tenant:** `00000000-0000-4000-8000-000000000001` (E2E Demo School, institution `a2e96cd1-0232-4cce-97e2-00ebbfb9a374`).  
**Dynamic IDs seeded via gateway API:** library item `5de5abb4-…`, circular `5f9f6446-…`, transport route `7bd286d4-…`.

---

## 1. Rubric scores (1–10)

| Screen            | IA  | Hierarchy | Density | Empty/err | Mobile | Forms | Brand | Copy | Avg |
| ----------------- | --- | --------- | ------: | --------: | -----: | ----: | ----: | ---: | --: |
| Reports (4)       | 9   | 9         |       8 |         8 |      9 |     8 |     9 |    8 | 8.5 |
| LMS (7)           | 9   | 9         |       8 |         8 |      8 |     8 |     9 |    9 | 8.5 |
| Library (6)       | 9   | 9         |       8 |         8 |      9 |     9 |     9 |    8 | 8.6 |
| Hostel (4)        | 9   | 9         |       9 |         7 |      9 |     9 |     9 |    8 | 8.6 |
| Timetable (2)     | 8   | 8         |       9 |         7 |      8 |     8 |     9 |    7 | 8.0 |
| Attendance ops    | 8   | 8         |       8 |         8 |      8 |     7 |     9 |    7 | 7.9 |
| Staff HR (5)      | 9   | 9         |       9 |         7 |      9 |     8 |     9 |    8 | 8.5 |
| Communication (5) | 9   | 9         |       9 |         8 |      9 |     9 |     9 |    8 | 8.8 |
| Transport (6)     | 9   | 8         |       8 |         8 |      8 |     8 |     9 |    7 | 8.1 |

**Module UX score (avg): 8.4 / 10**

---

## 2. Findings

### P0 (must fix)

| ID  | Screen | Finding                          | Fix / evidence |
| --- | ------ | -------------------------------- | -------------- |
| —   | —      | None open after in-session fixes | —              |

### P1

| ID     | Screen                             | Finding                                                                                | Fix / waiver                                                                                                                                                                     |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3-001 | Transport live                     | Primary subtitle was developer-facing (`FORCE RLS`, JWT headers)                       | **Fixed** — user-facing subtitle; the API `honestyNote` (`FORCE RLS`, `MapLibre`) is no longer rendered at all after integration review (`transport/live/page.tsx`)              |
| B3-002 | Timetable substitutions            | “Double-books return HTTP 409” in page intro                                           | **Fixed** — plain-language overlap message (`institutions/[id]/timetable/substitutions/page.tsx`)                                                                                |
| B3-003 | Attendance ops                     | Thin empty states (“No regularisation requests.”)                                      | **Fixed** — guided copy with next action (`attendance-ops-forms.tsx`)                                                                                                            |
| B3-004 | Communication circular detail      | Breadcrumb shows raw circular UUID                                                     | **Fixed** — UUID segments shortened in breadcrumbs (Wave 10 G-1004)                                                                                                              |
| B3-005 | Timetable generate / substitutions | Prerequisite empty states describe setup but lack deep links to periods/bell schedules | **Fixed** — deep links to academic periods / bell schedules / staff (Wave 10 G-1004)                                                                                             |
| B3-006 | Attendance ops                     | Power-user UUID fields with no picker/autocomplete                                     | **Fixed (this PR)** — `EntitySearchSelect` for student/institution/class/period; attendance record id remains text input (`attendance-ops-forms.tsx`, `attendance/ops/page.tsx`) |
| B3-007 | Transport live (mobile)            | Map marker labels near illegible at 390px                                              | **Fixed (this PR)** — marker labels 17px, SVG `<title>` tooltips, labels hidden below `sm` (`transport/_components/live-map.tsx`)                                                |
| B3-008 | Transport live                     | GPS ingest card still cites `POST /transport/gps`                                      | **Fixed (this PR)** — user-facing CardDescription; API path demoted to muted helper text (`transport/_components/gps-device-forms.tsx`)                                          |

### P2

| ID     | Screen                   | Finding                                                | Backlog note                                                                                                                          |
| ------ | ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| B3-009 | LMS hub (mobile)         | Chip rows stack three deep before content              | **Fixed (this PR)** — horizontal scroll subnav with min touch targets (`lms/_components/lms-subnav.tsx`)                              |
| B3-010 | Reports (mobile)         | “Generate” button smaller than “Fetch summary”         | **Fixed (this PR)** — both primary actions use default size + `min-h-11` (`catalogue-generate-panel.tsx`, `board-summary-panel.tsx`)  |
| B3-011 | Institution child routes | Breadcrumbs expose full institution UUID               | **Fixed (this PR)** — `InstitutionBreadcrumbLabel` resolves name via `/api/v1/institutions/:id` (`components/layout/breadcrumbs.tsx`) |
| B3-012 | Captures (all mobile)    | Fixed bottom nav appears mid-scroll in `fullPage` PNGs | **WAIVED** (capture artifact only, dated 2026-09-10) — viewport screenshots omit the artefact                                         |

---

## 3. Decisions / changes landed

| Change                          | Files                                                                             | Result                                               |
| ------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| User-facing live-map subtitle   | `apps/web/src/app/(dashboard)/transport/live/page.tsx`                            | Primary copy readable; technical note retained below |
| Plain-language clash message    | `apps/web/src/app/(dashboard)/institutions/[id]/timetable/substitutions/page.tsx` | HTTP status code removed from UI                     |
| Guided empty states             | `apps/web/src/app/(dashboard)/attendance/_components/attendance-ops-forms.tsx`    | Regularisation + leave lists explain next step       |
| Entity search on attendance ops | `attendance/ops/page.tsx`, `attendance-ops-forms.tsx`                             | B3-006 — searchable student/institution/class/period |
| Transport map + GPS copy        | `transport/_components/live-map.tsx`, `gps-device-forms.tsx`                      | B3-007, B3-008                                       |
| LMS mobile subnav scroll        | `lms/_components/lms-subnav.tsx`                                                  | B3-009                                               |
| Reports button parity           | `reports/_components/catalogue-generate-panel.tsx`, `board-summary-panel.tsx`     | B3-010                                               |
| Institution breadcrumb names    | `components/layout/breadcrumbs.tsx`, `institution-breadcrumb-label.tsx`           | B3-011                                               |
| `wave9-b3` capture module       | `apps/web/scripts/capture-screens.mjs`                                            | 40 routes, 120 PNGs committed                        |

---

## 4. Sign-off

| Claim                             | Status                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0 cleared                        | ☑                                                                                                   |
| P1 cleared or waived              | ☑ (3 fixed in-session; B3-006…B3-011 fixed in Wave 10 PR; B3-012 waived 2026-09-10)                 |
| Multidevice PNGs reviewed         | ☑ (desktop + mobile all modules; tablet sample: staff-attendance, communication-hub, lms-analytics) |
| Scoreboard updated if score moved | ☐ (no scoreboard change — 8.4 within prior Wave 9 band)                                             |

**Residual risks:** Open Library / WhatsApp / GPS device feeds remain sandbox/env-gated per §8.4 parent audit. Institution-scoped pages need seeded periods/bell schedules for non-empty timetable generation captures.

**Horizontal overflow check:** `node /tmp/check-png-widths.mjs` on `apps/web/screens/wave9-b3` — **120 / 120 PNGs match viewport width (0 mismatches).**
