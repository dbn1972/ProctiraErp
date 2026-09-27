# Screen test — Examinations (Sunrise Public School)

**Date (UTC):** 2026-09-26  
**Tenant:** Sunrise Public School `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` after Prisma migrate and `APPLY_STRICT_FKS=1` domain SQL. Examinations are **not** in the seed; the list starts empty until staff schedule one.  
**Session:** HS256 staff cookie, role `admin`, subject `neha.verma`. No password login exists on this seed.  
**Stack:** Postgres 16 (local), api-gateway `:3000`, Next.js dev `:3001`. Walked in headless Chromium.

This is a route walk of staff **examinations** screens only. It is not a production-ready or 10/10 claim. Attendance and unrelated modules (#388, #386, #382, #381, #377, #375, #374) were not touched.

**Publish safety:** On Results, **Publish results** stayed disabled while the exam was `DRAFT`/`SCHEDULED` (not `IN_PROGRESS` or `COMPLETED`), so no publish POST ran and marks could not lock. The control uses `ConfirmActionDialog` (`publish-results-confirm`) when publishing is allowed.

## Route table

| Route                           | Result | What was exercised                                                                                                                                                                                                  |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/examinations`                 | PASS   | Hub loaded (empty, then one exam after schedule). **Board export packs** and **Schedule exam** CTAs present. No raw UUID primary labels.                                                                            |
| `/examinations/new`             | PASS   | **AY 2026-27** academic period Select, **Sunrise Public School** institution, subject/centre fields. Created **Sunrise screen-test midterm** (code `SPS-SCR-*`, start ≥14 days ahead). Redirect to detail overview. |
| `/examinations/board-exports`   | PASS   | **Board export packs** heading; institution picker shows **SPS-PUN-01 · Sunrise Public School**, not a UUID. CBSE / ICSE / MH-STATE board Select.                                                                   |
| `/examinations/[id]`            | PASS   | Overview KPIs and facts for the scheduled exam.                                                                                                                                                                     |
| `/examinations/[id]/candidates` | PASS   | Empty state, then **Register candidate** with **Aarav Mehta** (`SPS-NID-001`) from the Sunrise student directory; table row shows the name, not the student UUID.                                                   |
| `/examinations/[id]/results`    | PASS   | Results shell with **Upload marks** / **Download CSV** / **Publish results** (disabled until exam status allows publish). No marks uploaded; publish did not run.                                                   |
| `/examinations/[id]/documents`  | PASS   | Admit cards / seating / certificates generate buttons render; no generate jobs submitted on this walk.                                                                                                              |
| `/examinations/[id]/ops`        | PASS   | Exam ops panel loads (invigilation / seating / marks entry shell). No write actions submitted.                                                                                                                      |

No examinations route in this table was **FAIL** or **BLOCKED** after the fix below.

Out of scope: attendance, gradebook (non–board-export), parent portal, and federated `/app/examinations/*` prototype router (Next `(dashboard)/examinations/*` is the staff surface under test).

## Fixes from the walk

| Screen          | Fault                                                                                          | Change                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Results · table | **Student** column showed raw `studentId` UUIDs (mono). Candidates tab already resolved names. | `results/page.tsx` loads `loadStudentOptions()` and renders `resolveEntityLabel` for each row. |

## Rows this walk added

Staff writes from the primary schedule/register actions (not part of the original seed):

- Examination **Sunrise screen-test midterm** (`SPS-SCR-*`) with one subject (Mathematics) and centre **Main hall**.
- One registered candidate: **Aarav Mehta** for that examination.

Marks were not uploaded and results were not published.
