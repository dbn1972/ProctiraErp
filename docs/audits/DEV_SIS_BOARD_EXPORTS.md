# DEV — SIS Board compliance export packs (WS4)

**Capability / module:** Multi-board marksheet / exam export packs (CBSE · ICSE · MH-STATE)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `7902b9b7e66558aaf6ac49e7a290ac6660551afa`  
**Owner / agent:** cloud SERVER agent  
**Date (UTC):** 2026-09-06  
**Peer parity target:** Registrar / board officer can generate board-specific marksheet + exam result artifacts from live cert grades with job status/download and incomplete-grade 422 gate (PowerSchool / board-office export slice)  
**Dev session:** WS4 server slice  
**Paired test audit:** live smoke `/opt/cursor/artifacts/sis-board-exports/live-smoke-summary.json` (Playwright gated residual)

---

## 0. Product contract

| Item | Content |
| --- | --- |
| Capability statement | An examinations/registrar operator can open **Board export packs**, pick CBSE / ICSE / MH-STATE + institution, generate a **MARKSHEET_PACK** job that writes CSV + exam-results JSON + PDF-lite HTML under `/opt/cursor/artifacts/sis-board-exports/`, poll job status, and download artifacts. Explicit student cohorts with missing required subjects are **blocked with HTTP 422**. |
| In scope (peer parity) | Pack registry + field maps; generators; create/status/download API; validation gate; Examinations UI; cert-tenant live smoke for 3 boards |
| Explicit non-goals | Official sealed PDF print shop; remaining state boards beyond MH-STATE; live IdP E2E; device-farm PNGs; Prisma models for this path |
| Roles (RBAC) | Board Officer / Registrar (documented intent) — **gateway tenant middleware only in this slice**; role deny matrix residual |
| Boards impacted | CBSE ☑ ICSE ☑ State (MH-STATE) ☑ |

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| --- | --- | --- | --- | --- |
| Board export packs | `/examinations/board-exports` | `/api/v1/gradebook/board-packs`, `/board-exports`, `/board-exports/:id`, `/download` | `board_export_jobs`, `grade_entries`, `board_codes`, `transcript_issuances`, `enrollments` | Student names, national IDs, marks |
| Examinations hub link | `/examinations` | — | — | — |

---

## 1. Domain model (SQL-first)

| Check | Done | Evidence |
| --- | --- | --- |
| Versioned SQL under `db/sql/` | ☑ | Reuses `003_sis_timetable_schedule_schema.sql` (`board_export_jobs`, grades, transcripts, board_codes) |
| Constraints / indexes / FKs | ☑ | Existing FKs + job indexes; no Prisma |
| Multi-board seed fixtures | ☑ | `db/seeds/005_sis_board_exports.sql` (complete grades × 3 boards + incomplete CBSE student) |
| Domain unit/property tests | ☑ | `board-export.test.ts` (4) + prior gradebook suite → 15 tests |
| Invariants documented | ☑ | Required subjects per pack; explicit studentIds → strict 422; default cohort = complete-only |

**Registry:** `packages/backend/gradebook/src/board-pack-registry.ts`  
**Generators:** `board-export-generator.ts` → `marksheet.csv`, `exam-results.json`, `marksheet.pdf-lite.html`, `pack.json`  
**Job type:** `MARKSHEET_PACK` on `board_export_jobs`

---

## 2. API / services

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant middleware on all routes | ☑ | `tenantIdOf` in `routes.ts` |
| Validation + typed errors | ☑ | `CreateBoardExportJobSchema`; `BusinessRuleError` 422 |
| RBAC enforced | ☐ | Residual — tenant-only |
| Conflict / rule failures → 409/422 | ☑ | Incomplete grades → 422; board mismatch → 422 |
| Idempotent writes where needed | N/A | Each export creates a new job row |
| Cross-tenant deny test | ☐ | Residual for test skill |

Endpoints:

- `GET /gradebook/board-packs`
- `GET /gradebook/boards`
- `POST /gradebook/board-exports`
- `GET /gradebook/board-exports`
- `GET /gradebook/board-exports/:id`
- `GET /gradebook/board-exports/:id/download?format=pack|csv|json|html`

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| --- | --- | --- | --- | --- |
| Board export packs | ☑ honesty banner on API miss | ☑ trigger form + job list | CBSE/ICSE/MH presets | `examinations/board-exports/page.tsx` |
| Examinations list CTA | ☑ | link only | — | `examinations/page.tsx` |

Ungated inventory: `e2e/19-examinations-inventory-smoke.spec.ts` includes `/examinations/board-exports`.

---

## 4. Cross-module integration

| Dependency | Integrated | Evidence |
| --- | --- | --- |
| Institutions / boards | ☑ | Board + institution affiliation check |
| Staff / students / enrollments | ☑ | Candidates from `enrollments` + `students` |
| Attendance / assessments / exams | Partial | Grades from `grade_entries` (WS3); exam module results not yet merged |
| Exports / jobs | ☑ | `board_export_jobs` + filesystem artifacts + checksum metadata |
| Transcripts | ☑ | Latest issued transcript checksum embedded in exam-results JSON when present |

---

## 5. Observability & audit

| Check | Done | Evidence |
| --- | --- | --- |
| Structured logs on writes | ☐ | Residual — gateway request logs |
| Audit trail for sensitive mutations | ☐ | Residual |
| Async job status (if exports) | ☑ | QUEUED→RUNNING→SUCCEEDED/FAILED; download only when SUCCEEDED |

---

## 6. Security & compliance

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant isolation | Partial | All queries filter `tenant_id`; download path must contain `sis-board-exports` |
| RBAC matrix documented | Partial | §0 |
| Export download auth | Partial | Tenant-gated API; no short-lived signed URL yet |
| Issued records immutable / versioned | ☑ | Pack jobs append-only; checksum in metadata |

---

## 7. Hand-off to production-ready **test** skill

| Check | Done | Evidence |
| --- | --- | --- |
| Test checklist started | Partial | This DEV audit + live smoke summary |
| Ungated smoke | ☑ | Examinations inventory includes board-exports route |
| Live write E2E | ☑ service-level | `scripts/live-board-export-smoke.mjs` → 3 packs SUCCEEDED + incomplete 422 |
| Multidevice captures | ☐ | Residual — not claimed |

### Live cert evidence (2026-09-06)

| Board | Job | Artifact |
| --- | --- | --- |
| CBSE | `ee3465c6-…` | `/opt/cursor/artifacts/sis-board-exports/CBSE/ee3465c6-91e8-4f63-a917-91593a8c419a/` |
| ICSE | `0ef519c9-…` | `/opt/cursor/artifacts/sis-board-exports/ICSE/0ef519c9-c491-416f-bc99-9224ea18b062/` |
| MH-STATE | `d8c37fc3-…` | `/opt/cursor/artifacts/sis-board-exports/MH-STATE/d8c37fc3-6fd6-4582-b514-a96fe3ae91c0/` |

Summary: `/opt/cursor/artifacts/sis-board-exports/live-smoke-summary.json`  
Unit: `pnpm test` in `@proctira/backend-gradebook` → **15 passed**.

---

## Residuals (honest)

1. Role-based deny + cross-tenant IDOR E2E on download.  
2. Authenticated Playwright write journey (`E2E_BACKEND_READY=1`).  
3. Multidevice PNG pack / device-farm.  
4. Live IdP.  
5. Official sealed PDF (current PDF-lite = HTML).  
6. Merge examination-module published results into pack (today: gradebook finals).  
7. Boards beyond CBSE/ICSE/MH-STATE not templated.
