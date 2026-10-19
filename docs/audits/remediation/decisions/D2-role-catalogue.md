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

---

## D2 APPROVED (owner): normalize synonyms, then extend realm to ~30 distinct roles

**Authoritative sources found:**

- Realm export: `infra/keycloak/proctira-realm.json` (6 roles).
- Central catalogue: `KEYCLOAK_REALM_ROLES` in
  `packages/backend/auth/src/keycloak/roles.ts` and `DEFAULT_ROLES` in
  `packages/shared/auth/src/rbac.ts` — both define only the SAME 6 roles.
- The ~30 domain roles exist only as scattered string literals in per-module
  RBAC allow-lists, not in the central catalogue — that is the real gap.

**Confirmed synonym rules (evidence-based — do NOT over-collapse):**

- COLLAPSE `exam_officer`, `exam-officer`, `examinations_officer` → one
  canonical `examinations_officer` (they are used interchangeably in the same
  arrays).
- COLLAPSE `system_admin` → `platform_admin` (never co-occur; same tier). Keep
  `super-admin`/`admin` as the existing realm roles; `platform_admin` is the
  platform-operator tier.
- COLLAPSE `nurse` → `school_nurse` (confirm no distinct meaning).
- **DO NOT collapse `parent` and `guardian`** — they appear TOGETHER in the same
  role arrays (`['parent','guardian','student']`), so they are DISTINCT roles.
  Both must be added as canonical roles.
- Treat `staff_admin` / `school_admin` and other near-duplicates case-by-case by
  checking co-occurrence; only collapse pairs that never co-occur AND have no
  distinct permission set.

**Work (three coordinated changes, one reviewed PR):**

1. Normalize the confirmed synonym spellings across backend module RBAC literals.
2. Add the resulting ~30 canonical roles to `KEYCLOAK_REALM_ROLES`,
   `DEFAULT_ROLES` (with permission definitions matching current usage), and the
   realm export JSON.
3. Point the scattered literals at the canonical catalogue where practical.

**Guardrail:** this changes a security artifact (the realm) and RBAC gates. No
role may gain privileges it does not already effectively have in code. A
reviewer must verify each canonical role's permission set equals the union of
what its (collapsed) synonyms currently grant — normalization must be
privilege-preserving, not privilege-expanding. Confirm the final set against the
RBAC permission matrix, not just string scans.

---

## D2 CORRECTION (owner) — platform_admin ≠ system_admin; preserve tenant isolation

Owner clarified the roles are DISTINCT by scope:

- **platform_admin** = overall PLATFORM / control-plane operator (cross-tenant ops).
- **system_admin** = per-TENANT administrator (scoped to one tenant).

The first D2 implementation WRONGLY collapsed system_admin -> platform_admin
(add-only), which granted platform_admin every tenant-scoped permission
system_admin held — including student PHI, health, assessment, examination and
report data access. For a platform operator that BREAKS tenant isolation.

**Corrected rule (supersedes the earlier system_admin->platform_admin collapse):**

- Do NOT collapse system_admin into platform_admin. They are distinct canonical roles.
- platform_admin keeps control-plane / platform-operations permissions but MUST NOT
  hold tenant-scoped student PHI / health / academic (assessment, examination,
  report, student) data access by default. Remove platform_admin from those
  tenant-scoped allow-lists where the batch additively inserted it.
- system_admin stays exactly as it was (unchanged per-tenant admin).
- This correction must be applied to PR #633 BEFORE it merges. #633 is not merged,
  so nothing downstream depends on the wrong grant yet.
