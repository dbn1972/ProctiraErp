# Decision D2 — Role catalogue / Keycloak realm (AWAITING OWNER CONFIRMATION)

**Status:** ANALYSIS COMPLETE — needs owner sign-off on the taxonomy before
implementation. This is a security/product ownership call; recorded here with
the full accounting the owner requested.

## Accounting (evidence from code + realm, not estimate)

**Realm currently defines 6 roles** (`infra/keycloak/proctira-realm.json`):
`super-admin`, `admin`, `principal`, `staff`, `teacher`, `guardian`.

**Code references 38 role names that the realm does NOT define** (count = code
sites referencing each; from static scan of `packages/backend/**/*.ts` RBAC
gates/allow-lists, test-fixture tokens excluded):

Core actors: `student` (28), `parent` (28), `registrar` (18), `bursar` (18),
`hr_officer` (18).
Staff/domain officers: `health_admin` (12), `communications_officer` (9),
`school_nurse` (8), `counsellor` (8), `notification_admin` (4), `warden` (3),
`health_officer` (3), `admissions_officer` (3), `librarian` (2),
`finance_officer` (2), `etl_engineer` (2), `transport_officer`,
`timetable_officer`, `subject_teacher`, `class_teacher`, `scholarship_officer`,
`discipline_officer`, `marks_clerk`, `staff_admin`, `school_admin`, `nurse`.
Platform/government: `system_admin` (10), `platform_admin` (5), `board_admin`
(3), `board_officer`, `board_regional_officer`, `ministry_admin`, `state_admin`,
`state_director`, `applicant`, plus exam-officer spellings.

### Known inconsistencies in the code (must be normalised first)
- `exam_officer` / `exam-officer` / `examinations_officer` — 3 spellings, 1 role
- `nurse` / `school_nurse` — likely 1 role
- `system_admin` / `platform_admin` vs realm `super-admin` / `admin` — overlap
- `parent` vs realm `guardian` — likely the same actor under two names

**Distinct roles after collapsing synonyms: ~30** (down from the raw 38).

## Recommendation (for owner to accept/modify)
1. **Normalise synonyms first** — pick one canonical name per role (e.g.
   standardise on `examinations_officer`, `guardian`, `platform_admin`), fix the
   code to use it. This is engineering work, no decision needed beyond the
   canonical names.
2. **Extend the realm** to the ~30 canonical roles so every RBAC gate maps to a
   real realm role.
3. **Confirm the taxonomy against the RBAC permission matrix**, not just grep —
   the authoritative required set is whatever the permission catalogue needs.

## Open question for the owner
Approve extending the realm to the ~30 canonical roles (with synonym
normalisation), or provide a different authoritative taxonomy? Implementation is
blocked until this is confirmed, because the realm export is a security artifact.
