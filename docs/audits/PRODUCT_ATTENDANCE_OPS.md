# Enterprise product / IA checklist

**Module / slice:** Attendance regularisation, early departure, student leave, biometric ingest, CSV (G-919)  
**Branch / tip:** `cursor/w9-g917-timetable-attendance-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Wave 9 G-919

---

## 1. Capability statement

A student, parent, or teacher can request a status change on a past attendance row (regularisation). An approver (registrar / principal / attendance officer) approves or rejects; on approve the row updates and an audit entry is written. Teachers can mark `EARLY_DEPARTURE` (present-partial at weight 0.5 in the percentage numerator). Families request leave over a date range (optional attachment URL); approval auto-marks those school days `EXCUSED`. A device can POST punch events to `/attendance/ingest` with a per-institution API key, idempotent on `deviceId+eventId`. Staff can export the attendance report as CSV including a per-student breakdown when the scope is class or institution.

## 2. Personas & jobs

| Persona                        | Job-to-be-done                  | Success looks like                                              |
| ------------------------------ | ------------------------------- | --------------------------------------------------------------- |
| Parent / student / teacher     | Correct a past mark             | Request sits in `requested` until decided; audit shows from→to  |
| Registrar / attendance officer | Decide regularisation and leave | Approve updates records; reject leaves them unchanged           |
| Device / biometric vendor      | Push punches                    | Duplicate `eventId` is a no-op; attendance rows created         |
| Clerk                          | Export report                   | CSV has summary metrics plus one row per student when available |

## 3. Scope

| In scope                                               | Non-goals                                                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-contained regularisation state machine + audit    | Live `WorkflowService` instance per request (engine exists at `/workflow-engine`; this slice keeps a domain state machine so attendance does not require a pre-seeded definition) |
| `EARLY_DEPARTURE` end-to-end (SQL check, types, UI, %) | Half-day AM/PM split as a separate status                                                                                                                                         |
| Student leave request / approve → EXCUSED              | Staff leave (already in HR)                                                                                                                                                       |
| Device ingest + contract test                          | Live vendor SDK, clock-in geofence                                                                                                                                                |
| Extend G-925 client CSV with per-student rows          | Server-generated signed download URLs                                                                                                                                             |

## 4. Peer parity

| Peer capability                                 | Our target this slice               |
| ----------------------------------------------- | ----------------------------------- |
| Attendance regularisation / correction workflow | Request → approve/reject with audit |
| Early departure                                 | Status + 0.5 present-partial weight |
| Student leave → excused                         | Date range + auto-mark              |
| Biometric / device punches                      | Idempotent ingest by device+event   |

## 5. Surface map

| Nav label              | Route                 | API                                                        | Tables / events                                                   | Shell  |
| ---------------------- | --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Mark attendance        | `/attendance`         | existing bulk + `EARLY_DEPARTURE`                          | `student_attendance`                                              | Staff  |
| Reports + CSV          | `/attendance/reports` | `GET /attendance/percentage`                               | same                                                              | Staff  |
| Regularisation & leave | `/attendance/ops`     | `/attendance/regularisation`, `/attendance/leave-requests` | `attendance_regularisation_requests`, `attendance_leave_requests` | Staff  |
| Device ingest          | n/a (machine)         | `POST /attendance/ingest`                                  | `attendance_device_keys`, `attendance_ingest_events`              | Device |

## 6. Roles & tenancy (high level)

| Role                                            | Can                                                  | Cannot                  |
| ----------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| parent, student, teacher                        | Create regularisation / leave for own linked student | Approve                 |
| registrar, attendance_officer, principal, admin | Approve / reject; register device keys               | Cross-tenant ingest     |
| device (API key)                                | Ingest punches for its institution                   | Read other institutions |

Tenant boundary notes: new tables FORCE RLS on `app.tenant_id`. Ingest resolves tenant from the hashed device key, then binds `withPgTenant`.

## 7. Success metrics / DoD

- [x] Regularisation approve updates the attendance row + audit; reject does not
- [x] `EARLY_DEPARTURE` in enum, SQL check, marking UI, percentage (weight 0.5)
- [x] Leave approve auto-marks EXCUSED on weekday dates in range
- [x] Ingest idempotent by deviceId+eventId (contract test)
- [x] CSV export exists (G-925) and includes per-student rows when `studentRows` is present

## 8. Handoff

| Next skill | Audit path                                            |
| ---------- | ----------------------------------------------------- |
| Build      | `docs/audits/DEV_ATTENDANCE_OPS.md`                   |
| UX         | deferred                                              |
| Security   | RLS describe blocks; ingest key hashed at rest        |
| Test       | vitest + ungated Playwright smoke (not executed here) |
| Release    | not claimed                                           |
