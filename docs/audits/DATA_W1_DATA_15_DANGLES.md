# DATA — W1-DATA-15 in-tenant dangling cross-domain UUID refs

**Module / slice:** Cross-domain referential integrity (student UUID FKs)  
**Branch / tip:** `cursor/aud-w1-data-15-dangling-fks-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL contract + optional live Postgres (`apply-sql.sh`)

Copy of checklist gate: `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`.

---

## Finding

Cross-domain UUID columns (especially `student_id`) were often declared as bare
`UUID` without `REFERENCES`. Even with correct tenant isolation, **in-tenant
dangling relationships** remained possible (orphan hostel beds, library loans,
LMS submissions, transport assignments, nurse incidents, exam seats).

Prior wave (`071` / `072`, audit `DATA_W1_DATA_15_FKS.md`) closed the
highest-value fee / SIS / parent / admissions / grade set and deferred campus
ops. This residual closes that deferral.

## 1. Schema

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Wave-1 ADD NOT VALID | `db/sql/071_cross_domain_fk_constraints.sql` | Fee / parent / transfer / grade closed set |
| Wave-1 VALIDATE | `db/sql/072_validate_cross_domain_fk_constraints.sql` | Validates 071 names |
| Residual ADD NOT VALID | `db/sql/073_cross_domain_fk_campus_ops.sql` | Hostel / library / LMS / transport / health nurse / exam seating |
| Residual VALIDATE | `db/sql/074_validate_cross_domain_fk_campus_ops.sql` | Validates 073 names |
| Demo seed repair | `db/sql/009b_library_seed.sql`, `010b_parent_portal_seed.sql` | Upsert demo student `…099` (from wave-1) |
| Invariants documented | ☑ | Below |

### 073 closed set → `students(id)`

| Domain | Tables |
| ------ | ------ |
| Hostel | `hostel_assignments`, `hostel_leaves`, `hostel_visitors`, `mess_subscriptions`, `gate_passes`, `hostel_attendance` |
| Library | `library_loans`, `library_holds`, `library_fines` |
| LMS | `lms_submissions`, `lms_skill_mastery`, `lms_practice_attempts` |
| Transport | `transport_student_assignments`, `transport_bus_attendance`, `transport_alerts`, `transport_fee_links` |
| Health | `health_nurse_incidents` |
| Exam | `exam_seating` |

## 2. Apply / verify (no Prisma for cert)

| Step | Command / evidence | Pass |
| ---- | ------------------ | ---- |
| Apply | `APPLY_STRICT_FKS=1 APPLY_SEEDS=1 bash tools/scripts/apply-sql.sh` (073/074 always-on; not gated on `APPLY_STRICT_FKS`) | ☑ contract |
| Seed | Demo `…099` upserted in 071 + `009b` / `010b`; hostel/transport seeds have no orphan student rows | ☑ |
| Spot query | Expect 0 unvalidated among 073 names (see below) | ☑ |
| Multi-board | N/A — integrity is tenant-row FK, not board-rule | ☑ N/A |

```bash
psql "$MIGRATOR_DATABASE_URL" -c "
SELECT c.conname, c.convalidated
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
WHERE c.contype = 'f'
  AND c.conname LIKE ANY (ARRAY[
    'hostel_%_student_id_fkey',
    'library_%_student_id_fkey',
    'lms_%_student_id_fkey',
    'transport_%_student_id_fkey',
    'health_nurse_incidents_student_id_fkey',
    'exam_seating_student_id_fkey'
  ])
  AND NOT c.convalidated;
"
```

Static contract:

```bash
pnpm exec vitest run tools/scripts/__tests__/cross-domain-fks.test.ts
```

## 3. Tenancy & constraints

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Tenant scoping columns / RLS / service filter | ☑ | Unchanged; FKs are additive same-schema |
| FK / unique / indexes for hot paths | ☑ | NOT VALID then VALIDATE; skips if column already has any FK |
| Domain property tests | ☑ | `tools/scripts/__tests__/cross-domain-fks.test.ts` |

## 4. Rollback

| Change | Forward fix / rollback |
| ------ | ---------------------- |
| 073 / 074 constraints | `ALTER TABLE … DROP CONSTRAINT <name>` per closed-set name; do not drop parent `students` rows |

## 5. Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Prisma `student_attendance` / `assessment_results` `student_id` | **Deferred** — FORCE RLS + `app.current_tenant_id` without `missing_ok` / platform_admin breaks migrator VALIDATE |
| Health counselling / special-needs `student_id TEXT` | **Out of scope** — type mismatch; needs typed UUID migration first |
| Scholarship `applicant_id` (UUID, not necessarily `students.id`) | **Accepted** — identity may be applicant/user, not enrolled student |
| Intentional bare `institution_id` / Phase 3–5 boundary UUIDs | **Accepted** — product boundary documented in schema comments (e.g. infrastructure) |
| Composite same-tenant guarantee (`child.tenant_id = parent.tenant_id`) | **Not enforced** — single-column FKs only |
| Migrator VALIDATE under FORCE RLS may be visibility-scoped | **Accepted** — same class as W1-DATA-06 / 068 / 072; NOT VALID still blocks new dangling writes |
| Orphan cleanup for non-demo historical data | **Operator** — VALIDATE fails until repaired |
| Staff / HR `staff_id` UUID without FK | **Deferred** — separate residual; not part of student dangling finding |

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).

**Waivers:** Prisma attendance/assessment VALIDATE; TEXT health ids; institution-boundary bare UUIDs; composite tenant match; RLS-scoped VALIDATE.
