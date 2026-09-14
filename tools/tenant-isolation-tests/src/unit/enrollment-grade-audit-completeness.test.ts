/**
 * W1-DATA-14 — enrollment history + grade-change audit completeness (static).
 *
 * 071 ships write triggers + append-only + REVOKE. 076 hardens REGRESSED gaps:
 * RESTRICT FKs (no CASCADE erase), SECURITY DEFINER + search_path on writers,
 * and re-asserted SELECT/INSERT-only grants for proctira_app.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION_071 = '071_enrollment_grade_audit_completeness.sql';
const MIGRATION_076 = '076_enrollment_grade_audit_harden.sql';

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

describe('W1-DATA-14 enrollment / grade audit completeness (071 + 076)', () => {
  it('ships 071 and 076 migrations', () => {
    expect(existsSync(join(sqlDir(), MIGRATION_071)), `missing db/sql/${MIGRATION_071}`).toBe(
      true,
    );
    expect(existsSync(join(sqlDir(), MIGRATION_076)), `missing db/sql/${MIGRATION_076}`).toBe(
      true,
    );
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

  it('071 makes enrollment_history and grade_change_audit append-only + REVOKE', () => {
    const sql = loadSql(MIGRATION_071);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_enrollment_history_append_only[\s\S]*BEFORE UPDATE OR DELETE ON enrollment_history/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_grade_change_audit_append_only[\s\S]*BEFORE UPDATE OR DELETE ON grade_change_audit/i,
    );
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON enrollment_history FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON grade_change_audit FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE TRIGGER ON enrollment_history FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE TRIGGER ON grade_change_audit FROM proctira_app/i);
  });

  it('076 hardens FKs to ON DELETE RESTRICT (no CASCADE erase)', () => {
    const sql = loadSql(MIGRATION_076);
    expect(sql).toMatch(/enrollment_history_enrollment_id_fkey/);
    expect(sql).toMatch(/grade_change_audit_grade_entry_id_fkey/);
    expect(sql).toMatch(
      /FOREIGN KEY \(enrollment_id\) REFERENCES enrollments\(id\)\s+ON DELETE RESTRICT/i,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(grade_entry_id\) REFERENCES grade_entries\(id\)\s+ON DELETE RESTRICT/i,
    );
    // DDL must not recreate CASCADE FKs (comments may still name the prior bug).
    expect(sql).not.toMatch(
      /FOREIGN KEY \([^)]+\) REFERENCES \w+\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  it('076 SECURITY DEFINER + search_path on write functions; SELECT/INSERT-only for runtime', () => {
    const sql = loadSql(MIGRATION_076);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION enrollments_write_history\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION grade_entries_write_change_audit\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
    expect(sql).toMatch(/REVOKE ALL ON enrollment_history FROM proctira_app/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON enrollment_history TO proctira_app/i);
    expect(sql).toMatch(/REVOKE ALL ON grade_change_audit FROM proctira_app/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON grade_change_audit TO proctira_app/i);
  });

  it('records both migrations in schema_migrations', () => {
    expect(loadSql(MIGRATION_071)).toMatch(/071_enrollment_grade_audit_completeness\.sql/);
    expect(loadSql(MIGRATION_076)).toMatch(/076_enrollment_grade_audit_harden\.sql/);
  });
});
