/**
 * W1-DATA-07 COMPLETE — static SQL contract for append-only versions + payroll
 * reverse/replace (083_w1_data_07_append_only_versions.sql).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '083_w1_data_07_append_only_versions.sql';

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(join(path, '070_academic_fee_effective_dating.sql'), 'utf8');
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

describe('W1-DATA-07 COMPLETE append-only versions SQL (076)', () => {
  it('ships 076 migration', () => {
    expect(existsSync(join(sqlDir(), MIGRATION))).toBe(true);
  });

  it('guards academic date/code/version mutability and rejects overlaps', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/academic_periods_dates_immutable/);
    expect(sql).toMatch(/academic_periods_reject_overlap/);
    expect(sql).toMatch(/academic_periods_tenant_code_version_uidx/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS academic_periods_tenant_id_code_key/);
  });

  it('guards fee structure amount/valid_from immutability with close-only valid_to', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/fee_structures_effective_immutable/);
    expect(sql).toMatch(/fee_structures_reject_overlap/);
    expect(sql).toMatch(/valid_to can only narrow/);
    expect(sql).toMatch(/fee_structures_tenant_code_version_uidx/);
  });

  it('makes payroll posted rows immutable and removes ON CONFLICT overwrite path', () => {
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/staff_payroll_runs_posted_immutable/);
    expect(sql).toMatch(/status IN \('posted', 'reversal'\)/);
    expect(sql).toMatch(/reverses_run_id/);
    expect(sql).toMatch(/replaces_run_id/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS staff_payroll_runs_tenant_id_month_key/);

    const store = readFileSync(
      join(sqlDir(), '../../packages/backend/staff/src/pg-hr-ops-store.ts'),
      'utf8',
    );
    expect(store).not.toMatch(/ON CONFLICT \(tenant_id, month\) DO UPDATE/);
    expect(store).toMatch(/reverseAndReplacePayrollExport/);
  });
});
