# DATA — W1-DATA-15 cross-domain UUID foreign keys

**Module / slice:** Student / enrollment / fee / grade referential integrity  
**Branch / tip:** `cursor/aud-w1-data-15-dangling-fks-56c3` @ `d007077debf477332d635854dc349672787d2687`
**Date (UTC):** 2026-09-14  
**Environment:** local Postgres (`apply-sql.sh`) + static SQL review

## Finding

Cross-domain UUID columns (especially `student_id`, enrollment transfer IDs,
fee `invoice_id` / `structure_id`, and `grade_id` / `grade_entry_id`) were
often declared as bare `UUID` without `REFERENCES`. In-tenant dangling
relationships were therefore possible even when tenant isolation was correct.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| ADD NOT VALID FKs | `db/sql/071_cross_domain_fk_constraints.sql` | Highest-value student/enrollment/fee/grade refs; idempotent |
| VALIDATE | `db/sql/072_validate_cross_domain_fk_constraints.sql` | Validates FKs pointing at students/enrollments/grades/grade_entries/parent_fee_invoices/fee_structures |
| Demo seed repair | `db/sql/009b_library_seed.sql`, `010b_parent_portal_seed.sql` | Upsert well-known demo student `…099` before UUID cross-refs |
| Docs | `db/README.md`, this audit | Operator-facing residual list |

### Closed FK set (071)

- **→ students:** parent portal links/consents/threads/invoices; fee concessions + dunning audits/suppressions; guardian custody; report-card jobs/comments; admission offer enrolled student; transfer records; attendance ops tables when present
- **→ enrollments:** `transfer_records.source_enrollment_id` / `destination_enrollment_id`
- **→ parent_fee_invoices:** fee ledger, recon rows, dunning invoice cols, admission offer fee invoice
- **→ fee_structures:** `parent_fee_invoices.structure_id`
- **→ grades:** fee invoice/structure grade; admissions enquiry/application/offer/merit/seat_matrix; curriculum syllabus/outcomes
- **→ grade_entries:** `grade_change_audit.grade_entry_id`

## Invariants

1. New writes against closed-set columns cannot reference missing parents (NOT VALID still enforces on INSERT/UPDATE).
2. Existing orphans are deferred until `072` VALIDATE (fail-closed when dirty).
3. Well-known demo student UUID used by `*b_*_seed.sql` is upserted so VALIDATE + `APPLY_SEEDS=1` can succeed on fresh installs.

## Apply / verify

```bash
# Fresh DB path (Prisma migrate first, then domain SQL)
APPLY_STRICT_FKS=1 APPLY_SEEDS=1 \
  MIGRATOR_DATABASE_URL=postgresql://… \
  bash tools/scripts/apply-sql.sh

# Spot-check (expect 0)
psql "$MIGRATOR_DATABASE_URL" -c "
SELECT c.conname, c.convalidated
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
WHERE c.contype = 'f' AND NOT c.convalidated
  AND r.relname IN (
    'parent_fee_invoices','fee_concessions','transfer_records','grade_change_audit'
  );
"
```

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Hostel / library / LMS / transport `student_id` still UUID-only | **Deferred** — lower blast radius than fee/SIS; follow-up |
| Prisma `student_attendance` / `assessment_results` `student_id` | **Deferred** — FORCE RLS + `app.current_tenant_id` without `missing_ok` / platform_admin breaks migrator VALIDATE |
| Health counselling / special-needs `student_id TEXT` | **Out of scope** — type mismatch; needs typed UUID migration first |
| Intentional bare cross-schema UUIDs (Phase 3–5 institution/attendance boundaries) | **Accepted** — product boundary, not a missing same-schema FK |
| Composite / same-tenant guarantees (`child.tenant_id = parent.tenant_id`) | **Not enforced** — single-column FKs only; cross-tenant same-UUID collision still theoretical |
| Migrator VALIDATE under FORCE RLS may be visibility-scoped (same class as W1-DATA-06 / 068) | **Accepted** — NOT VALID still blocks new dangling writes; full-scan VALIDATE needs BYPASSRLS/superuser |
| Orphan cleanup for non-demo historical data | **Operator** — VALIDATE fails until repaired |

## Rollback

Forward-fix: `ALTER TABLE … DROP CONSTRAINT <name>` per closed-set constraint.
Do not drop `students` / parent rows to “undo”.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).
