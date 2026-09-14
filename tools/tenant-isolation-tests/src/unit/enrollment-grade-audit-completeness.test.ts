/**
 * W1-DATA-14 — enrollment history + grade-change audit completeness (static).
 *
 * Triggers must ship so status/score changes cannot skip audit rows; audit
 * tables must be append-only with REVOKE from proctira_app; grade_change_audit
 * must FK to grade_entries.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '071_enrollment_grade_audit_completeness.sql';

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

describe('W1-DATA-14 enrollment / grade audit completeness (071)', () => {
  it('ships 071 migration', () => {
    const path = join(sqlDir(), MIGRATION);
    expect(existsSync(path), `missing db/sql/${MIGRATION}`).toBe(true);
  });

  it('writes enrollment_history from enrollments INSERT/UPDATE OF status', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/enrollments_write_history/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_enrollments_write_history[\s\S]*AFTER INSERT OR UPDATE OF status ON enrollments/i,
    );
    expect(sql).toMatch(/INSERT INTO enrollment_history/i);
  });

  it('writes grade_change_audit from grade_entries INSERT/UPDATE', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/grade_entries_write_change_audit/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_grade_entries_write_change_audit[\s\S]*AFTER INSERT OR UPDATE ON grade_entries/i,
    );
    expect(sql).toMatch(/INSERT INTO grade_change_audit/i);
    expect(sql).toMatch(/workflowStatus/);
  });

  it('makes enrollment_history and grade_change_audit append-only + REVOKE', () => {
    const sql = loadSql(MIGRATION);
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

  it('adds grade_change_audit → grade_entries FK', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/grade_change_audit_grade_entry_fk/i);
    expect(sql).toMatch(
      /FOREIGN KEY \(grade_entry_id\) REFERENCES grade_entries\(id\)/i,
    );
  });

  it('records itself in schema_migrations', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/071_enrollment_grade_audit_completeness\.sql/);
  });
});
