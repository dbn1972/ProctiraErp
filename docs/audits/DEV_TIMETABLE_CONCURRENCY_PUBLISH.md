# DEV — Timetable concurrency protection (P1-TT)

**Capability / module:** Timetable · optimistic concurrency on section/meeting update  
**Branch / tip:** `cursor/timetable-concurrency-publish-56c3`  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Concurrent registrar edits do not silently overwrite (PowerSchool / IC-class schedule edit conflict)  
**Tasks:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` row **P1-TT** (parent owns checklist status — this agent does not edit TASKS)  
**Paired product evidence:** tip already ships publish + clash (`publishSection` / `TimetableClashError` 409)

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | When two operators edit the same **draft** section or meeting, a client that sends `If-Match: <updatedAt>` receives **HTTP 409 `VERSION_CONFLICT`** if the row changed; successful writes return a fresh `ETag`.        |
| In scope (peer parity) | Thin OCC on `PUT /timetable/sections/:id` and `PUT /timetable/meetings/:id`; token = entity `updatedAt` ISO; in-memory + PG compare-and-swap; unit proof                                                                |
| Explicit non-goals     | Integer `version` SQL column / migration (would leave timetable package); mandatory If-Match (omission stays last-write-wins for legacy clients); UI ETag wiring; multi-document schedule “publication version” history |
| Roles (RBAC)           | Unchanged — `schedule.write` for updates; `schedule.publish` for publish/unpublish                                                                                                                                      |
| Boards impacted        | Board-agnostic                                                                                                                                                                                                          |

Screen / API inventory:

| Nav / surface         | Route                          | API                                               | Tables                        | PII |
| --------------------- | ------------------------------ | ------------------------------------------------- | ----------------------------- | --- |
| Institution timetable | `/institutions/[id]/timetable` | `PUT /api/v1/timetable/meetings/:id` (+ If-Match) | `section_meetings.updated_at` | No  |
| Sections (API)        | —                              | `PUT /api/v1/timetable/sections/:id` (+ If-Match) | `sections.updated_at`         | No  |

---

## 1. Domain model

| Check                         | Done | Evidence                                                                  |
| ----------------------------- | ---- | ------------------------------------------------------------------------- |
| Versioned SQL under `db/sql/` | ☐    | **NON-GOAL this slice** — reuse existing `updated_at` (no new migration)  |
| Constraints / indexes / FKs   | ☑    | Pre-existing `003_sis_timetable_schedule_schema.sql`                      |
| Domain unit tests             | ☑    | `packages/backend/timetable/src/concurrency.test.ts`                      |
| Invariants documented         | ☑    | Stale If-Match → `VERSION_CONFLICT` 409 (distinct from `TIMETABLE_CLASH`) |

**Version token:** `updatedAt` ISO-8601 string (also returned as `ETag: "<updatedAt>"` on GET section / successful PUT).

---

## 2. API / services

| Check                        | Done | Evidence                                                                                          |
| ---------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| If-Match → expectedUpdatedAt | ☑    | `routes.ts` `ifMatchOf` + `normalizeIfMatchToken`                                                 |
| 409 VERSION_CONFLICT         | ☑    | `TimetableVersionConflictError` in `timetable-errors.ts`; wired in `sendDomainError`              |
| Publish / clash unchanged    | ☑    | Tip already has `publishSection` + `TimetableClashError`; this slice does not regress those paths |
| PG CAS                       | ☑    | `UPDATE … AND updated_at = $expected::timestamptz` in `pg-timetable-repository.ts`                |
| In-memory CAS                | ☑    | `in-memory-repository.ts` throws on token mismatch                                                |
| Backward compatible          | ☑    | Missing If-Match → prior last-write-wins behavior                                                 |

Package: `@proctira/backend-timetable`.

---

## 3–6. UI / integration / observability / residual

- **UI:** not in scope (API token only). Clients may adopt ETag later.
- **Residual / dated NON-GOAL (2026-09-12):** durable integer `version` column + schema migration; forcing If-Match on all writes; schedule “publication version” history beyond existing `status`/`published_at`.

---

## Exit (this slice)

- [x] Thin OCC on section + meeting update (If-Match → 409)
- [x] Unit test (`concurrency.test.ts`)
- [x] DEV note (this file)
- [ ] Tip CI green on merge commit (release gate — not claimed here)
- [ ] Parent marks **P1-TT** DONE in TASKS (out of scope for this agent)
