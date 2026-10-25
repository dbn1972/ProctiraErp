# Wave 0 ledger triage — group 4 summary

- Baseline: `4c7fb8fec961b49a8a7b70c05d22ebe30ad18e20` (worktree `ledger-triage-wave0`, branch `docs/ledger-triage-wave0`)
- Scope: 113 rows (66 medium, 47 low; 34 OPEN, 79 PARTIAL) across lms, staff, transport, assessment, timetable, student, library, attendance, scholarship, gradebook, hostel, health, curriculum, examination, exam-document-worker.
- Output: `work/triage-group-4.json` (113 rows, each input id exactly once). Built from `logs/triage-g4/decisions-*.json` by `logs/triage-g4/build.py`, which checks for unique ids, preserved notes, and that every cited path exists at tip.
- Data source: ledger title/notes/evidence only. The xlsx is absent (see `triage-manifest.json`), so fix_steps/acceptance/needs were null for every row. NEEDS_DECISION comes from row notes, merged-PR bodies (#646/#647/#648/#653) and `DECISION_REGISTER.md`.

## Counts

| triage_result | rows |
|---|---|
| STALE | 7 |
| DUPLICATE | 3 |
| PARTIAL_CONFIRMED | 56 (4 propose OPEN → PARTIAL: PRC-L277, PRC-M169, PRC-M173, PRC-M400) |
| STILL_OPEN | 47 (28 OPEN, 19 PARTIAL with no new tip evidence of met steps; no CSV change) |

| eligibility (rows staying OPEN/PARTIAL) | rows |
|---|---|
| ELIGIBLE_MEDIUM | 34 |
| ELIGIBLE_LOW | 10 |
| BLOCKED_FOR_APPROVAL | 22 |
| NEEDS_DECISION | 19 |
| SCHEMA_BATCH | 14 |
| INFRA_BATCH | 4 |
| CLAIMED | 0 (no group-4 id appears in `claimed-and-decision.json`) |
| n/a (STALE/DUPLICATE) | 10 |

## STALE (proposed FULLY_CLOSED, ALREADY_FIXED note convention)

| id | evidence | test |
|---|---|---|
| PRC-L175 | timetable routes.ts:121,160; timetable-service.ts:1392-1405 | timetable suite exit 0 |
| PRC-L374 | timetable generation.ts:209-215; timetable-service.ts:1220-1229 | timetable suite exit 0 |
| PRC-M549 | timetable routes.ts:1250-1279; timetable-service.ts:1606-1623 | timetable suite exit 0 |
| PRC-M382 | staff staff-csv.ts:34-79,136-163; hr-service.ts:808 | staff suite exit 0 |
| PRC-M386 | student students-360/service.ts:441-463,517-521; blob-store.ts:55 | student suite exit 0 |
| PRC-M292 | library library-service.ts:182-204,247-252; in-memory-repository.ts:89-103 | library suite exit 0 |
| PRC-L573 | library patron-binding.test.ts:158-200; library-ops.test.ts (fines, concurrency, cross-tenant) | library suite exit 0 |

## DUPLICATE

- PRC-L501 → PRC-L500: same staff `standalone-server.ts`, same root cause.
- PRC-M371 → PRC-M381: same `__offboard` customData defect. M381 is the superset and stays PARTIAL.
- PRC-M380 → PRC-M543: same certification-expiry job and notification wiring. M543 is the superset.

## Tests run (all targeted package suites, server-guard exit 0 before each)

| command | exit | log |
|---|---|---|
| `pnpm -C packages/backend/timetable exec vitest run --reporter=verbose` | 0 (178 passed, 12 skipped) | `logs/triage-g4/timetable-vitest.log` |
| `pnpm -C packages/backend/attendance exec vitest run --reporter=verbose` | 0 (167 passed, 14 skipped) | `logs/triage-g4/attendance-vitest.log` |
| `pnpm -C packages/backend/examination exec vitest run --reporter=verbose` | 0 (250 passed, 14 skipped) | `logs/triage-g4/examination-vitest.log` |
| `pnpm -C packages/backend/health exec vitest run --reporter=verbose` | 0 (202 passed, 7 skipped) | `logs/triage-g4/health-vitest.log` |
| `pnpm -C packages/backend/staff exec vitest run --reporter=verbose` | 0 (814 passed, 12 skipped) | `logs/triage-g4/staff-vitest.log` |
| `pnpm -C packages/backend/transport exec vitest run --reporter=verbose` | 0 (76 passed, 2 skipped) | `logs/triage-g4/transport-vitest.log` |
| `pnpm -C packages/backend/student exec vitest run --reporter=verbose` | 0 (392 passed, 5 skipped) | `logs/triage-g4/student-vitest.log` |
| `pnpm -C packages/backend/library exec vitest run --reporter=verbose` | 0 (53 passed, 1 skipped) | `logs/triage-g4/library-vitest.log` |

The skipped tests are live/PG suites (DATABASE_URL unset). They are NOT VERIFIED and were never used to support STALE. Rows whose remaining proof depends on them (PRC-M400, M396, M407, L503, L278, M169, L275, L563, M620, M583, M632, M368) stay PARTIAL.

## Tip findings that contradict merged-PR or ledger claims

- PR #647 reports PRC-L277 as FULLY_CLOSED. At tip, the device/ingest identifiers are still not validated as UUIDs (`attendance/src/ops-schemas.ts:68,78-89`), so the row is PARTIAL.
- PR #647 calls PRC-M407 STALE. Its substitutions soft-delete filter exists only in PG SQL (`pg-timetable-repository.ts:767`) and has no executed test, so the row stays PARTIAL.
- PRC-L373: the package has a durable audit path, but the gateway builds `TimetableService` without `auditPool` (`apps/api-gateway/src/domain-plugins.ts:258-263`). Production still audits only in memory.
- PRC-M173: the gateway never wires `holidayLookup`, so holidays inside an approved leave range are still marked EXCUSED.
- PRC-M368: `db/sql/246` (PR #650, cited as PRC-M207) adds the posted-once index. The service path still surfaces a raw error to the losing concurrent request. PRC-M207 is the db twin in group 2, so coordinate with that group's disposition.
- The w3 notes call PRC-M370, PRC-M373, PRC-M440, PRC-M441, PRC-M452 and PRC-L589 "partially addressed". No met step is visible at tip, so these are STILL_OPEN with disposition unchanged.
- PRC-M528: the w3 note lists the magic-byte sniff as missing, but it is present at tip (`lms/src/lms-file-store.ts:41-86`).
- PRC-L083: the remaining fix is in `packages/backend/parent-portal/src/pg-academic-visibility-store.ts`, a module claimed by `fix/audit-parent-portal-batch`. Coordinate before editing.

## Rows not completed

None. All 113 rows have a result. The shell was briefly unavailable twice during evidence reading. No test run was affected, and the line references read during those windows were re-checked with file reads.
