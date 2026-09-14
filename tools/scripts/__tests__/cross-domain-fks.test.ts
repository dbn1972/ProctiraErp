/**
 * W1-DATA-15 — static contract for cross-domain FK migrations.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const ADD = join(ROOT, 'db/sql/071_cross_domain_fk_constraints.sql');
const VALIDATE = join(ROOT, 'db/sql/072_validate_cross_domain_fk_constraints.sql');
const AUDIT = join(ROOT, 'docs/audits/DATA_W1_DATA_15_FKS.md');

describe('W1-DATA-15 cross-domain FKs', () => {
  it('ships additive NOT VALID + VALIDATE SQL and audit', () => {
    expect(existsSync(ADD)).toBe(true);
    expect(existsSync(VALIDATE)).toBe(true);
    expect(existsSync(AUDIT)).toBe(true);

    const addSql = readFileSync(ADD, 'utf8');
    const valSql = readFileSync(VALIDATE, 'utf8');
    const audit = readFileSync(AUDIT, 'utf8');

    expect(addSql).toMatch(/NOT VALID/);
    expect(addSql).toMatch(/parent_fee_invoices_student_id_fkey/);
    expect(addSql).toMatch(/transfer_records_source_enrollment_id_fkey/);
    expect(addSql).toMatch(/fee_ledger_entries_invoice_id_fkey/);
    expect(addSql).toMatch(/admission_offers_grade_id_fkey/);
    expect(addSql).not.toMatch(/student_attendance_student_id_fkey/);
    expect(addSql).not.toMatch(/assessment_results_student_id_fkey/);

    expect(valSql).toMatch(/VALIDATE CONSTRAINT/);
    expect(valSql).toMatch(/parent_fee_invoices_student_id_fkey/);

    expect(audit).toMatch(/W1-DATA-15/);
    expect(audit).toMatch(/Residuals/);
  });
});
