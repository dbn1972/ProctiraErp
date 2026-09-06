# Enterprise module development checklist

**Capability / module:** SIS Foundation (WS0) + Timetable schema (WS1 data plane)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `282fdb60d303169c293673cc4652ad797d4171eb`  
**Owner / agent:** Cloud server agent (SIS foundation)  
**Date (UTC):** 2026-09-06  
**Peer parity target:** Shared SIS primitives (rooms, bell/periods, sections/meetings, substitutions, grading scales, export jobs) so timetable / master schedule / gradebook streams can land without schema churn  
**Dev session:** WS0 + WS1 schema slice (SQL-first)  
**Paired test audit:** deferred — enterprise **test** skill after WS1 API/UI (not this slice)

Copy of `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`.

---

## 0. Product contract

| Item | Content |
| --- | --- |
| Capability statement | On live Postgres, a multi-board cert tenant has constrained timetable foundation tables (rooms, bell schedules/periods, sections, meetings, substitutions) plus board affiliation codes and per-board grading scales (CBSE / ICSE / MH-STATE), with WS3 gradebook/export stubs ready for later streams. |
| In scope (peer parity) | Schema + FKs/indexes; multi-board seed for scales/codes; pure clash-detection unit stub; DEV audit + psql verify artifacts |
| Explicit non-goals | Timetable UI/API CRUD; publish workflow; live conflict engine on writes; GPA/transcript issuance; board PDF packs; Prisma apply path |
| Roles (RBAC) | Documented matrix only (enforcement in later API work): Scheduler, Registrar, Teacher, Principal, Board Officer |
| Boards impacted | CBSE ☑ ICSE ☑ State ☑ (MH-STATE) Other: |

Screen / API inventory (schema slice — routes TBD in WS1 UI):

| Nav / surface | Route | API | Tables | PII |
| --- | --- | --- | --- | --- |
| Bell schedules | `/academic-periods/[id]/bell-schedules` (planned) | TBD | `bell_schedules`, `bell_periods` | No |
| Timetable grid | `/institutions/[id]/timetable` (planned) | TBD | `section_meetings`, `rooms`, `sections` | Staff IDs |
| Substitutions | `/staff/substitutions` (planned) | TBD | `substitutions` | Staff IDs |
| Board export jobs | Examinations / Reports (planned) | TBD | `board_export_jobs` | Indirect |

### Gap matrix (B0.1 inventory)

| Existing (001 / live) | Gap closed by 003 |
| --- | --- |
| `tenants`, `boards`, `institutions`, `academic_periods`, `grades`, `staff`, `students`, `enrollments` | FK targets reused |
| Infrastructure rooms (in-memory / Prisma path) | New scheduling `rooms` table (SQL cert path) |
| No bell / period grid | `bell_schedules` + `bell_periods` (+ `periods` view) |
| No section / meeting / sub | `sections`, `section_enrollments`, `section_meetings`, `substitutions` |
| No grading scales / board affiliation codes | `grading_scales`, `grading_scale_bands`, `board_codes` |
| No transcript / export job status | Stub tables `grade_entries`, `credit_rules`, `gpa_snapshots`, `transcript_issuances`, `board_export_jobs` |

### RBAC matrix (documented — not enforced in this slice)

| Role | Schedule publish | Sub assign | Enter grades | Issue transcript | Board export |
| --- | --- | --- | --- | --- | --- |
| Scheduler | Yes | Yes | No | No | No |
| Registrar | Yes | Yes | Read | Yes | Yes |
| Teacher | No | Request only | Yes (own sections) | No | No |
| Principal | Approve | Yes | Read | Read | Read |
| Board Officer | No | No | No | Read | Yes |

---

## 1. Domain model (SQL-first)

| Check | Done | Evidence |
| --- | --- | --- |
| Versioned SQL under `db/sql/` | ☑ | `db/sql/003_sis_timetable_schedule_schema.sql` |
| Constraints / indexes / FKs | ☑ | Live FK sample in `/opt/cursor/artifacts/sis-foundation/verify.txt` |
| Multi-board seed fixtures | ☑ | `db/seeds/003_sis_timetable_board_scales.sql` → 3 scales, 21 bands, 12 board_codes |
| Domain unit/property tests | ☑ | `packages/backend/timetable/src/clash-detection.test.ts` |
| Invariants documented | ☑ | Teacher double-book / room double-book / invalid period; `start_time < end_time`; section unique per institution+period+code |

### Invariants

1. Bell period `start_time < end_time`; unique `period_order` per schedule.  
2. Section meeting unique on `(section_id, bell_period_id, day_of_week)`.  
3. Substitution cannot map a staff member to themselves; unique per meeting+date.  
4. Clash stub: overlapping same-day intervals on same teacher or room → conflict.  
5. Issued transcripts (later): versioned uniqueness `(tenant_id, student_id, version)`.

---

## 2. API / services

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant middleware on all routes | ☐ | Residual — WS1 API |
| Validation + typed errors | ☐ | Residual — WS1 API |
| RBAC enforced | ☐ | Matrix only (§0) |
| Conflict / rule failures → 409/422 | ☐ | Domain stub only (`detectClashes`) |
| Idempotent writes where needed | ☐ | Residual |
| Cross-tenant deny test | ☐ | Residual — pair with test skill |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| --- | --- | --- | --- | --- |
| Bell / timetable / substitutions | ☐ | ☐ | ☐ | Out of scope this slice |

---

## 4. Cross-module integration

| Dependency | Integrated | Evidence |
| --- | --- | --- |
| Institutions / periods | ☑ | FKs to `institutions`, `academic_periods` |
| Staff / students / enrollments | ☑ | FKs on meetings/subs/section_enrollments; cert seed tenant intact |
| Attendance / assessments / exams (as applicable) | ☐ | Residual — wire after published meetings (WS2) |
| Exports / jobs (as applicable) | ☑ schema only | `board_export_jobs` status enum; no runner yet |

---

## 5. Observability & audit

| Check | Done | Evidence |
| --- | --- | --- |
| Structured logs on writes | ☐ | Residual — API |
| Audit trail for sensitive mutations | ☐ | Residual |
| Async job status (if exports) | ☑ schema | `export_job_status` on `board_export_jobs` |

---

## 6. Security & compliance

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant isolation | ☑ schema | Every new table has `tenant_id` FK to `tenants` |
| RBAC matrix documented | ☑ | §0 |
| Export download auth | ☐ | Residual — WS4 |
| Issued records immutable / versioned | ☑ schema | `transcript_issuances.version` unique |

---

## 7. Hand-off to production-ready **test** skill

| Check | Done | Evidence |
| --- | --- | --- |
| Test checklist copied & filled | ☐ | After WS1 UI/API |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐ | Residual |
| Desktop + tablet + mobile captures | ☐ | Residual |
| Tip CI green | ☐ | Verify after push |
| Scoreboard updated honestly | ☐ | Residual until timetable screens exist |

---

## Exit — capability 10/10

| Gate | Pass |
| --- | --- |
| Peer parity for this slice | ☑ schema/seed only |
| Live SQL + seeds | ☑ `/opt/cursor/artifacts/sis-foundation/` |
| Live API writes | ☐ |
| UI inventory complete | ☐ |
| Rules tests green | ☑ clash unit |
| Board artifacts (if applicable) | ☐ N/A this slice (scales seeded, packs later) |
| Security evidence | ☐ partial (schema tenant FK) |
| Test skill complete | ☐ |
| CI green | ☐ pending tip |

**Residuals / waivers (dated):**

| Residual | Owner | Date |
| --- | --- | --- |
| WS1 API + UI for bell / timetable / substitutions | Track A | 2026-09-06 |
| Enforce RBAC + tenant deny tests | Track A + E | 2026-09-06 |
| Seed sample rooms/bell rows (optional demos) | Track A | 2026-09-06 |
| Parallel stub schema used TEXT ids — replaced with UUID FKs; consumers must use `bell_periods` (view `periods` for read alias) | Track A | 2026-09-06 |
| `pg-timetable-repository.ts` still targets stub columns (`periods` table, TEXT section_meetings shape) — needs align to UUID FK schema before live API | Track A | 2026-09-06 |
| Gradebook/GPA/transcript APIs | Track C (WS3) | 2026-09-06 |

**Verdict:** ☑ Ready w/ waivers · ☐ **10/10 product slice** (foundation data plane only — not full timetable product 10/10)

### Apply / verify evidence

- Applied: `psql "$DATABASE_URL" -f db/sql/003_sis_timetable_schedule_schema.sql`
- Seeded: `psql "$DATABASE_URL" -f db/seeds/003_sis_timetable_board_scales.sql`
- Artifacts: `/opt/cursor/artifacts/sis-foundation/summary.json`, `verify.txt`
- Cert counts: `board_codes=12`, `grading_scales=3`, `grading_scale_bands=21`
