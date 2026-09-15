/**
 * W1-DATA-14 — enrollment history + grade-change audit completeness (static).
 *
 * 071 installs database writers, 080 hardens the writer/FK posture, and 092
 * closes exact-cardinality residuals by quarantining legacy grade-audit
 * orphans, validating both parent FKs, and making trigger-owned audit tables
 * SELECT-only for proctira_app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION_071 = '071_enrollment_grade_audit_completeness.sql';
const MIGRATION_080 = '080_enrollment_grade_audit_harden.sql';
const MIGRATION_092 = '092_w1_data_14_audit_fk_integrity.sql';

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(join(path, '021_wave7_integrity_schema.sql'), 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/');
}

function loadSql(file: string): string {
  return readFileSync(join(sqlDir(), file), 'utf8');
}

describe('W1-DATA-14 enrollment / grade audit completeness (071 + 080 + 092)', () => {
  it('ships the trigger, hardening, and forward integrity migrations', () => {
    for (const file of [MIGRATION_071, MIGRATION_080, MIGRATION_092]) {
      expect(existsSync(join(sqlDir(), file)), `missing db/sql/${file}`).toBe(true);
    }
  });

  it('071 writes enrollment_history from enrollments INSERT/UPDATE OF status', () => {
    const sql = loadSql(MIGRATION_071);
    expect(sql).toMatch(/enrollments_write_history/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_enrollments_write_history[\s\S]*AFTER INSERT OR UPDATE OF status ON enrollments/i,
    );
    expect(sql).toMatch(/INSERT INTO enrollment_history/i);
  });

  it('071 writes grade_change_audit from grade_entries INSERT/UPDATE', () => {
    const sql = loadSql(MIGRATION_071);
    expect(sql).toMatch(/grade_entries_write_change_audit/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_grade_entries_write_change_audit[\s\S]*AFTER INSERT OR UPDATE ON grade_entries/i,
    );
    expect(sql).toMatch(/INSERT INTO grade_change_audit/i);
    expect(sql).toMatch(/workflowStatus/);
  });

  it('071 makes enrollment_history and grade_change_audit append-only', () => {
    const sql = loadSql(MIGRATION_071);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_enrollment_history_append_only[\s\S]*BEFORE UPDATE OR DELETE ON enrollment_history/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_grade_change_audit_append_only[\s\S]*BEFORE UPDATE OR DELETE ON grade_change_audit/i,
    );
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON enrollment_history FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON grade_change_audit FROM proctira_app/i);
  });

  it('080 hardens FKs to ON DELETE RESTRICT and secures writer functions', () => {
    const sql = loadSql(MIGRATION_080);
    expect(sql).toMatch(
      /FOREIGN KEY \(enrollment_id\) REFERENCES enrollments\(id\)\s+ON DELETE RESTRICT/i,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(grade_entry_id\) REFERENCES grade_entries\(id\)\s+ON DELETE RESTRICT/i,
    );
    expect(sql).not.toMatch(
      /FOREIGN KEY \([^)]+\) REFERENCES \w+\(id\)\s+ON DELETE CASCADE/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION enrollments_write_history\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION grade_entries_write_change_audit\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
  });

  it('092 preserves legacy grade-audit orphans in immutable runtime-denied quarantine', () => {
    const sql = loadSql(MIGRATION_092);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS grade_change_audit_orphan_quarantine/i);
    expect(sql).toMatch(/DELETE FROM grade_change_audit[\s\S]*RETURNING a\.\*/i);
    expect(sql).toMatch(/to_jsonb\(orphaned\)/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_grade_change_audit_orphan_quarantine_append_only[\s\S]*BEFORE UPDATE OR DELETE/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON grade_change_audit_orphan_quarantine FROM proctira_app/i,
    );
  });

  it('092 uses NOT VALID then requires validated canonical RESTRICT FKs', () => {
    const sql = loadSql(MIGRATION_092);
    expect(sql).toMatch(
      /ADD CONSTRAINT grade_change_audit_grade_entry_id_fkey[\s\S]*ON DELETE RESTRICT[\s\S]*NOT VALID/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE grade_change_audit\s+VALIDATE CONSTRAINT grade_change_audit_grade_entry_id_fkey/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE enrollment_history\s+VALIDATE CONSTRAINT enrollment_history_enrollment_id_fkey/i,
    );
    expect(sql).toMatch(/c\.convalidated/i);
    expect(sql).toMatch(/duplicate grade_entry_id FKs/i);
    expect(sql).not.toMatch(/skipping VALIDATE/i);
  });

  it('092 removes direct application INSERT while retaining trigger-generated reads', () => {
    const sql = loadSql(MIGRATION_092);
    expect(sql).toMatch(
      /REVOKE ALL ON enrollment_history, grade_change_audit FROM proctira_app/i,
    );
    expect(sql).toMatch(
      /GRANT SELECT ON enrollment_history, grade_change_audit TO proctira_app/i,
    );
    expect(sql).not.toMatch(/GRANT SELECT, INSERT ON enrollment_history/i);
    expect(sql).not.toMatch(/GRANT SELECT, INSERT ON grade_change_audit/i);
  });

  it('records all three migrations in schema_migrations', () => {
    expect(loadSql(MIGRATION_071)).toMatch(/071_enrollment_grade_audit_completeness\.sql/);
    expect(loadSql(MIGRATION_080)).toMatch(/080_enrollment_grade_audit_harden\.sql/);
    expect(loadSql(MIGRATION_092)).toMatch(/092_w1_data_14_audit_fk_integrity\.sql/);
  });
});
