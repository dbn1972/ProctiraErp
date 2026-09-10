# DEV — Timetable ≥9.0 (2026-09-10)

## Capability
Schedulers manage bell schedules, section meetings, substitutions, and generation jobs with clash detection (HTTP 409). Domain RBAC via `timetable-access`.

## Non-goals
- iCal export / multi-campus federation (**PRD-013**)
- Live IdP (G-107)

## Evidence
- Domain access on write routes; unit clash 409 in `timetable-service.test.ts`
- E2E: `50-timetable-generation-write-smoke.spec.ts` teacher double-book → 409
- Mount matrix notes cite domain RBAC + PRD-013
- Waiver: PRD-013

## Status
**PROD_WAIVED @ 9.0** — tip CI still independent (PRD-001).
