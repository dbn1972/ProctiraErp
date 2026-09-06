# SIS world-class 10/10 — gap closure plan

**Status:** plan of record  
**Updated (UTC):** 2026-09-06  
**Branch context:** `cursor/enterprise-score-uplift-56c3`  
**Skills:**  
- Build → `.cursor/skills/enterprise-module-development/SKILL.md`  
- Test → `.cursor/skills/enterprise-module-production-ready/SKILL.md`

This plan closes the **product** gaps vs peer SIS/ERP (schedule, gradebook/transcripts, timetable/calendar, multi-board exports). Current program readiness (~9.4 with waivers) measures **audited screens**, not peer feature parity.

Do **not** invent calendar durations. Sequence by **dependency**, not clock time.

---

## Outcome definition (program 10/10 for these slices)

When this epic is done, a multi-board tenant can:

1. Define **bell schedules**, period grids, and **substitutions**, with calendar federation hooks.  
2. Build a **master schedule** (sections + rooms) with **conflict detection**.  
3. Run a **gradebook** with credit rules, **GPA**, **report cards**, and **official transcripts**.  
4. Produce **board export packs** (CBSE, ICSE, one state board) from live results — not static mocks.

Each slice must pass **both** the development checklist and the production-ready test checklist.

---

## Current baseline (honest)

| Capability | Today | Gap to peer 10/10 |
| --- | --- | --- |
| Multi-board data plane | Seed **3×6×500** proven (raw SQL) | Remaining boards beyond CBSE/ICSE/MH-STATE templates |
| SIS core | Institutions, periods, attendance, assessments, exams, master schedule | Room conflict edge cases / calendar IdP |
| Gradebook & transcripts | Live GPA + transcripts + report-card jobs | Sealed PDF / parent portal |
| Timetable / calendar | Bell schedules + substitutions | External calendar federation |
| Board export packs | CBSE / ICSE / MH-STATE live packs (WS4) | Additional state boards; sealed PDF; exam-module merge |

External caps that still apply program-wide (dated waivers unless closed): **live IdP**, **Android device-farm**.

---

## Workstream map (dependency order)

```text
WS0 Foundation (schema + RBAC + jobs)
    ↓
WS1 Timetable / calendar / bell / substitutions
    ↓
WS2 Master schedule / sections / rooms / conflicts
    ↓
WS3 Gradebook / credits / GPA / report cards / transcripts
    ↓
WS4 Multi-board compliance export packs (CBSE / ICSE / state)
    ↓
WS5 Enterprise test + scoreboard + tip CI (continuous per WS)
```

---

## WS0 — Foundation

**Goal:** Shared primitives every later stream needs.

### Build activities

| ID | Activity | Deliverable |
| --- | --- | --- |
| B0.1 | Inventory existing `academic-periods`, assessments, exams, institutions, rooms/infrastructure fields | Gap matrix in `docs/audits/DEV_SIS_FOUNDATION.md` |
| B0.2 | Add SQL: `rooms`, `bell_schedules`, `periods`, `sections`, `section_enrollments`, `section_meetings`, `substitutions`, `grade_entries`, `credit_rules`, `gpa_snapshots`, `transcript_issuances`, `board_export_jobs` | `db/sql/00x_sis_core_*.sql` |
| B0.3 | RBAC matrix: Scheduler, Registrar, Teacher, Principal, Board Officer | Documented in DEV audit |
| B0.4 | Async job runner hook (or reuse etl-worker) for PDF/CSV exports | Job status API |
| B0.5 | Multi-board seed extensions (board codes, grading scales per board) | Seed SQL + verify script |

### Test activities (enterprise test skill)

| ID | Activity |
| --- | --- |
| T0.1 | Schema apply/verify on live Postgres (raw `psql`, no Prisma cert path) |
| T0.2 | Tenant isolation property tests for new tables |
| T0.3 | RBAC deny unit tests |

**Exit:** SQL applied on cert DB; RBAC tests green; DEV checklist §0–1 complete.

---

## WS1 — Timetable / calendar / bell / substitutions

**Goal:** Peer-grade **timetable & calendar** slice.

### Build activities

| ID | Activity | Deliverable |
| --- | --- | --- |
| B1.1 | Bell schedule CRUD (period start/end, day pattern) | API + UI under Academics |
| B1.2 | Period grid linked to academic periods + institution | UI grid |
| B1.3 | Substitution assign (absent teacher → substitute, slot-level) | Write API + UI |
| B1.4 | Calendar feed hooks (iCal export and/or webhook stub with honesty if external sync not live) | Export endpoint |
| B1.5 | Clash rules: teacher double-book, invalid period | Domain tests |

### Nav / screens (minimum)

| Screen | Route (proposed) |
| --- | --- |
| Bell schedules | `/academic-periods/[id]/bell-schedules` |
| Timetable grid | `/institutions/[id]/timetable` |
| Substitutions | `/staff/substitutions` or institution-scoped |

### Test activities

| ID | Activity |
| --- | --- |
| T1.1 | Ungated inventory smoke for new routes |
| T1.2 | Live write E2E: create bell schedule → assign substitution |
| T1.3 | Negative: substitution clash → 409 |
| T1.4 | Desktop/tablet/mobile captures |
| T1.5 | Axe on timetable grid |

**Exit:** Capability 10/10 for timetable slice (DEV + TEST checklists); scoreboard Academics screens updated.

---

## WS2 — Master schedule / section rostering / room conflicts

**Goal:** Peer-grade **SIS core scheduling**.

### Build activities

| ID | Activity | Deliverable |
| --- | --- | --- |
| B2.1 | Section entity (course offering, teacher, room, capacity) | API + UI |
| B2.2 | Section rostering (enroll/withdraw students) | Write API + UI |
| B2.3 | Room booking on meetings | Persistence |
| B2.4 | Conflict engine: room ∩ time, teacher ∩ time, student overload policy | Pure domain module + tests |
| B2.5 | Publish schedule workflow (draft → published; lock edits) | State machine + audit log |
| B2.6 | Wire **attendance** mark flow to published section meetings | Integration |

### Test activities

| ID | Activity |
| --- | --- |
| T2.1 | Live E2E: create section → enroll → detect room conflict |
| T2.2 | Property tests for conflict engine |
| T2.3 | Publish → attendance period list reflects meetings |
| T2.4 | Multidevice captures for schedule builder |
| T2.5 | Security: teacher cannot publish; registrar can |

**Exit:** Conflict engine proven; attendance integration live; Academics schedule screens ≥9.5 with honest residuals only for external calendar providers.

---

## WS3 — Gradebook / transcripts / GPA / report cards

**Goal:** Peer-grade **gradebook & transcripts**.

### Build activities

| ID | Activity | Deliverable |
| --- | --- | --- |
| B3.1 | Gradebook linked to section + assessment scheme | UI + API |
| B3.2 | Standards-based and/or numeric entry (board-configurable) | Rules config per board |
| B3.3 | Credit rules + course completion | Domain service |
| B3.4 | GPA engine (weighted/unweighted; board policy hooks) | Unit/property tests |
| B3.5 | Report card generation (term) | PDF/HTML artifact + job status |
| B3.6 | Official transcript issuance (versioned, immutable after issue) | Issue + download APIs |
| B3.7 | Replace student records placeholder with live transcript list | UI |

### Test activities

| ID | Activity |
| --- | --- |
| T3.1 | Live E2E: enter grades → compute GPA → generate report card |
| T3.2 | Issue transcript → second issue creates new version, prior immutable |
| T3.3 | RBAC: teacher enters grades; registrar issues transcript |
| T3.4 | Axe + multidevice on gradebook + transcript screens |
| T3.5 | Artifact store under `/opt/cursor/artifacts/sis-gradebook-audit/` |

**Exit:** GPA + transcript artifacts from live data; Student Records no longer placeholder-only.

---

## WS4 — Multi-board compliance export packs

**Goal:** Peer-grade **board-specific marksheets / exam exports**.

Depends on WS3 results + exam module data.

### Build activities

| ID | Activity | Deliverable |
| --- | --- | --- |
| B4.1 | Board pack registry (CBSE, ICSE, one state e.g. MH-STATE) | Config + templates |
| B4.2 | Marksheet generator per board (fields, terminology, security marks) | Template engine |
| B4.3 | Exam board export (candidate list, center codes, results file) | CSV/PDF per board spec |
| B4.4 | Validation gate (missing subjects / incomplete grades → 422) | Domain tests |
| B4.5 | Export job UI under Examinations or Reports | Status + download |
| B4.6 | Cert profile proof: run packs on `proctira-multiboard-cert` seed | Evidence JSON |

### Test activities

| ID | Activity |
| --- | --- |
| T4.1 | Golden/fixture tests for each board template field map |
| T4.2 | Live E2E: generate CBSE + ICSE + state pack from seeded results |
| T4.3 | Negative: incomplete data blocked |
| T4.4 | Download auth + tenant isolation on artifacts |
| T4.5 | Audit `docs/audits/MULTI_BOARD_EXPORT_PACKS.md` |

**Exit:** Three board packs produced from live cert DB; scoreboard/compliance claim updated; residual only for boards not yet templated.

---

## WS5 — Continuous enterprise quality (every stream)

For **each** WS1–WS4 merge train:

1. Follow **enterprise-module-development** checklist → `docs/audits/DEV_…`.  
2. Follow **enterprise-module-production-ready** checklist → `docs/audits/…`.  
3. Update `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` honestly.  
4. Tip CI green (lint, typecheck, unit, integration, tenant isolation, lighthouse as applicable).  
5. No invented device-farm or IdP proofs.

---

## Parallelism (what can overlap)

| Parallelizable | Blocked until |
| --- | --- |
| B0.* foundation | — |
| Board template research (B4.1 docs only) | — |
| UI shell routes (empty states) | B0.2 schema |
| WS1 build | B0.2–B0.3 |
| WS2 build | WS1 period/bell model stable |
| WS3 build | Sections (WS2) for section-linked gradebook; assessments can start earlier with period-only scope |
| WS4 build | WS3 finals + exams results stable |

---

## Suggested agent / team split

| Track | Focus | Skills |
| --- | --- | --- |
| A | WS0 + WS1 timetable | Dev → Test |
| B | WS2 master schedule + conflicts | Dev → Test |
| C | WS3 gradebook/GPA/transcripts | Dev → Test |
| D | WS4 board packs | Dev → Test |
| E | Scoreboard + CI + residual hygiene | Test |

---

## Scoreboard impact (target after epic)

| Module / slice | Target after epic |
| --- | --- |
| Academics — timetable / schedule | **10/10** product + test (waive only external calendar IdP sync) |
| Academics — gradebook / transcripts | **10/10** |
| Examinations — board exports | **10/10** for CBSE/ICSE/state pack |
| Program weighted | Rise only if Mobile device-farm + live IdP still not capping; otherwise **~9.6–9.8** honest ceiling |

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Board PDF specs change / incomplete public specs | Version templates; golden fixtures; waiver per board revision |
| Conflict engine performance at 3k students | Index meetings; batch validate; property tests on dense fixtures |
| GPA policy disputes per board | Board policy config tables — no hardcode |
| Scope creep into fees/LMS/parent portal | Explicit non-goals in each DEV contract |
| Claiming 10/10 on UI mocks | Gate exit on live SQL + file artifacts |

---

## Immediate next actions (start WS0)

1. Create `docs/audits/DEV_SIS_FOUNDATION.md` from the dev checklist template.  
2. Draft `db/sql/003_sis_timetable_schedule_schema.sql` (bell, periods, rooms, sections, meetings).  
3. Extend multi-board seed with grading scale + board codes.  
4. Open WS1 UI route shells with honesty empty states until API is live.  
5. Keep tip CI green; do not merge WS slices without paired test audit.

---

## References

- `.cursor/skills/enterprise-module-development/SKILL.md`  
- `.cursor/skills/enterprise-module-production-ready/SKILL.md`  
- `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`  
- `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`  
- `docs/audits/MULTI_BOARD_SCHOOL_ONBOARDING.md`  
- `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md`  
- `db/sql/001_core_onboarding_schema.sql`
