# Enterprise product / IA checklist

**Module / slice:** Institutions timetable (week grid, generate, substitutions)
**Branch / tip:** `cursor/institutions-timetable-grid-0b3f`
**Date (UTC):** 2026-09-28
**Owner / agent:** cloud agent

## 1. Capability statement

A principal or timetable coordinator at a school can see the week's section meetings as a Mon–Sat grid, add a meeting by name, and get a clear 409 when a teacher is already booked. They can run the existing generator and assign a substitute for an absent teacher, with the same tenant and role checks as the rest of the timetable API.

## 2. Personas & jobs

| Persona                  | Job-to-be-done                            | Success looks like                                           |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| Principal (Priya Sharma) | See Class 9-B's week and cover an absence | Grid matches the seeded week; substitution names the teacher |
| Timetable coordinator    | Add one meeting or generate demand        | New meeting appears; a double-book is rejected               |

## 3. Scope

| In scope                                                      | Non-goals                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `/institutions/[id]/timetable`, `/generate`, `/substitutions` | Parent/student timetable shells                              |
| Week grid, list, add, draft remove, 409 copy                  | Rewriting the generator algorithm                            |
| Sunrise Mayur Class 9-B seed                                  | New migration (104/105 are taken; no schema change required) |

## 4. Peer parity

| Peer capability                          | Our target this slice                      |
| ---------------------------------------- | ------------------------------------------ |
| Weekly grid with free periods and breaks | Seeded Mayur grid                          |
| Conflict on teacher double-book          | Existing 409, named in the form            |
| Substitute assignment                    | Existing substitution API with staff names |

## 5. Surface map

| Nav label     | Route                          | API                             | Tables                                        | Shell |
| ------------- | ------------------------------ | ------------------------------- | --------------------------------------------- | ----- |
| Timetable     | `/institutions/[id]/timetable` | meetings, periods, sections     | `section_meetings`, `bell_periods`            | staff |
| Generate      | `.../timetable/generate`       | generation-jobs                 | `timetable_generation_jobs`                   | staff |
| Substitutions | `.../timetable/substitutions`  | substitutions, teacher-absences | `substitutions`, `timetable_teacher_absences` | staff |

## 6. Roles & tenancy

| Role                            | Can                               | Cannot                     |
| ------------------------------- | --------------------------------- | -------------------------- |
| Principal, registrar, scheduler | Create meetings and substitutions | Read another tenant's rows |
| Teacher                         |                                   | Write meetings (403)       |

Tenant boundary: meeting delete for another tenant is 404.

## 7. Success metrics / DoD

- [ ] Seeded Class 9-B grid renders without raw UUIDs
- [ ] Add meeting and 409 are covered by Playwright
- [ ] Page matrix includes the three routes
- [ ] No SCREEN STATE chips or UX review button

## 8. Handoff

| Next skill | Audit path                       |
| ---------- | -------------------------------- |
| Build      | `DEV_INSTITUTIONS_TIMETABLE.md`  |
| UX         | `UX_INSTITUTIONS_TIMETABLE.md`   |
| Security   | `SEC_INSTITUTIONS_TIMETABLE.md`  |
| Test       | `TEST_INSTITUTIONS_TIMETABLE.md` |
