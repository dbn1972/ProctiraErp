# DATA — W1-DATA-15 complete residual (staff/ops + Prisma safe pattern)

**Module / slice:** Cross-domain referential integrity (complete residual)  
**Branch / tip:** `cursor/w1-data-15-fk-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL contract + optional live Postgres (`apply-sql.sh`)

Copy of checklist gate: `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`.

Prior waves: `DATA_W1_DATA_15_FKS.md` (071/072), `DATA_W1_DATA_15_DANGLES.md` (073/074).

---

## Finding

Cross-domain UUID columns still permitted **in-tenant dangling relationships** after
campus/ops student FKs landed. Remaining high-value auditor residuals:

1. Raw-SQL **staff_id** (HR / leave / payroll / exam invigilators / timetable absences)
2. Transport **fees_invoice_id** / **fees_structure_id** links into the fees domain
3. Prisma FORCE-RLS tables (`student_attendance`, `assessment_results`, examination
   candidate tables, `staff_attendance`) whose policies historically lacked
   `missing_ok` / `platform_admin`, making migrator **VALIDATE** unsafe

## 1. Schema

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Staff/ops ADD NOT VALID | `db/sql/085_cross_domain_fk_staff_ops.sql` | Staff + transport fee links; demo staff `…098` |
| Staff/ops VALIDATE | `db/sql/086_validate_cross_domain_fk_staff_ops.sql` | Validates 076 names |
| Prisma ADD NOT VALID only | `db/sql/087_cross_domain_fk_prisma_not_valid.sql` | **No VALIDATE companion** (safe pattern) |
| Prior closed sets | `071`/`072`, `073`/`074` | Unchanged |
| Invariants documented | ☑ | Below |

### 076 closed set

| Domain | Constraint target |
| ------ | ----------------- |
| HR leave | `staff_leave_requests`, `staff_leave_balances` → `staff(id)` |
| HR contracts | `staff_contracts`, `staff_qualifications`, `staff_hr_attendance` → `staff(id)` |
| Payroll | `staff_payroll_lines` → `staff(id)` |
| Appraisals / training | `hr_appraisals`, `hr_training_attendance`, `hr_certifications` → `staff(id)` |
| Timetable / exam | `timetable_teacher_absences`, `exam_invigilators` → `staff(id)` |
| Transport fees | `transport_fee_links.fees_invoice_id` → `parent_fee_invoices`; `fees_structure_id` → `fee_structures`; `transport_fee_structures.fees_structure_id` → `fee_structures` |

### 078 Prisma NOT VALID-only set (safe pattern)

| Table | Column | Parent |
| ----- | ------ | ------ |
| `student_attendance` | `student_id` | `students(id)` |
| `assessment_results` | `student_id` | `students(id)` |
| `examination_candidate_registrations` | `student_id` | `students(id)` |
| `examination_candidates` | `student_id` | `students(id)` |
| `examination_academic_records` | `student_id` | `students(id)` |
| `staff_attendance` | `staff_id` | `staff(id)` |

**Why no VALIDATE:** Under FORCE RLS, policies that evaluate
`current_setting('app.current_tenant_id')` without `missing_ok` throw when the
migrator GUC is unset; even with `app_tenant_id()` rewrites, absence of
`platform_admin` escape means VALIDATE is visibility-scoped and can report
false-clean. **NOT VALID still rejects dangling INSERT/UPDATE.** Full-scan
VALIDATE is an operator BYPASSRLS/superuser follow-up after orphan cleanup.

## 2. Apply / verify (no Prisma for cert of these FKs)

| Step | Command / evidence | Pass |
| ---- | ------------------ | ---- |
| Apply | `prisma migrate deploy` then `APPLY_STRICT_FKS=1 APPLY_SEEDS=1 bash tools/scripts/apply-sql.sh` — applied=94 including 076/077/078 | ☑ live |
| Spot query | 076 names `convalidated=t`; 078 names exist with `convalidated=f` (intentional) | ☑ live |
| Deny proof | Orphan `staff_contracts.staff_id` → `23503` / `staff_contracts_staff_id_fkey`; orphan `student_attendance.student_id` → `23503` / `student_attendance_student_id_fkey` | ☑ live |
| Multi-board | N/A — integrity is tenant-row FK | ☑ N/A |

```bash
psql "$MIGRATOR_DATABASE_URL" -c "
SELECT c.conname, c.convalidated
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
WHERE c.contype = 'f'
  AND c.conname LIKE ANY (ARRAY[
    'staff_%_staff_id_fkey',
    'hr_%_staff_id_fkey',
    'transport_fee_%_fees_%_fkey',
    'student_attendance_student_id_fkey',
    'assessment_results_student_id_fkey'
  ]);
"
```

Static contract:

```bash
pnpm exec vitest run tools/scripts/__tests__/cross-domain-fks.test.ts
```

Live orphan deny (requires `DATABASE_URL`):

```bash
pnpm exec vitest run packages/shared/database/src/cross-domain-fks.live.test.ts
```

## 3. Tenancy & constraints

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Tenant scoping columns / RLS / service filter | ☑ | Unchanged; FKs additive same-schema |
| FK / unique / indexes for hot paths | ☑ | NOT VALID (+ VALIDATE for 076); Prisma skip VALIDATE |
| Domain property tests | ☑ | static + live orphan deny |

## 4. Rollback

| Change | Forward fix / rollback |
| ------ | ---------------------- |
| 076 / 077 / 078 constraints | `ALTER TABLE … DROP CONSTRAINT <name>` per closed-set name |

## 5. Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Prisma 078 VALIDATE under FORCE RLS | **Waived / deferred** — safe pattern is NOT VALID only; operator full-scan VALIDATE |
| Health counselling / special-needs `student_id TEXT` | **Out of scope** — type mismatch; needs typed UUID migration first |
| Scholarship `applicant_id` | **Accepted** — identity may be applicant/user, not enrolled student |
| Intentional bare `institution_id` / Phase 3–5 boundary UUIDs | **Accepted** — product boundary |
| Composite same-tenant guarantee (`child.tenant_id = parent.tenant_id`) | **Not enforced** — single-column FKs only (per task: do not invent) |
| Migrator VALIDATE visibility under FORCE RLS (076 set) | **Accepted** — same class as 068 / 072 / 074 |
| Orphan cleanup for non-demo historical data | **Operator** — VALIDATE fails until repaired |
| Class / section / subject bare UUID refs | **Deferred** — lower auditor priority than staff/student dangling finding |

## Enabling apply fixes (same PR)

| Fix | Path | Why |
| --- | ---- | --- |
| `${1:-…}` not `${1:=…}` in timeout banner | `tools/scripts/migration-timeouts.sh` | bash cannot assign defaults to `$1`; broke `emit_migration_timeout_banner` with no args |
| `psql_q -Atq` for ledger status | `tools/scripts/apply-sql.sh` | W1-DATA-17 `SET` preamble otherwise polluted status as `SET\nSET\nmissing` |

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).

**Waivers:** Prisma VALIDATE; TEXT health ids; scholarship applicant identity; institution-boundary bare UUIDs; composite tenant match; RLS-scoped VALIDATE; class/section deferred.
