# Product / IA — SIS Timetable harden

**Module / slice:** Timetable bells · periods · meetings · substitutions — mutation audit + cross-tenant  
**Branch:** `cursor/sis-timetable-harden-56c3`  
**Date (UTC):** 2026-09-07

## Capability

Registrar/scheduler can CRUD bell schedules, periods, meetings, and substitutions under `schedule.write`; Tenant B cannot read Tenant A bells/meetings/subs; each write leaves an in-process audit entry. Attendance consumes published meetings via `/timetable/attendance-periods` (already wired).

## Scope

| In | Out |
| --- | --- |
| Mutation audit (bell/period/meeting/sub) | iCal / calendar federation |
| Cross-tenant unit proof for bells/subs | Live IdP E2E |
| Document attendance wire | Device-farm · LMS |

## DoD

- [x] Unit tests green (access + isolation + audit)
- [ ] Tip CI + merge
