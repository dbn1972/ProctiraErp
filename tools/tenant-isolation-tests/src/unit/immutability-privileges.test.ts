/**
 * W1-DATA-08 (A3) — immutability privilege hardening static contract.
 *
 * Append-only tables must ship immutability triggers and REVOKE UPDATE/DELETE
 * (and TRUNCATE/TRIGGER) from the runtime role `proctira_app`. Live negative
 * proofs run in packages/shared/database/src/immutability-privileges.live.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const IMMUTABILITY_MIGRATION = '053_immutability_privileges.sql';

/** Tables that must reject runtime UPDATE/DELETE (ledger, audit, transcripts). */
const IMMUTABLE_TABLES = [
  'fee_ledger_entries',
  'audit_log_entries',
  'workflow_transition_audit',
  'transcript_issuances',
] as const;

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(join(path, '050_app_runtime_role.sql'), 'utf8');
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

describe('W1-DATA-08 immutability privileges (053_immutability_privileges.sql)', () => {
  it('ships 053 migration with append-only trigger on transcript_issuances', () => {
    const path = join(sqlDir(), IMMUTABILITY_MIGRATION);
    expect(existsSync(path), `missing db/sql/${IMMUTABILITY_MIGRATION}`).toBe(true);
    const sql = loadSql(IMMUTABILITY_MIGRATION);
    expect(sql).toMatch(/transcript_issuances_append_only/i);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_transcript_issuances_append_only[\s\S]*BEFORE UPDATE OR DELETE ON transcript_issuances/i,
    );
  });

  it('053 REVOKEs UPDATE/DELETE/TRUNCATE/TRIGGER on every immutable table for proctira_app', () => {
    const sql = loadSql(IMMUTABILITY_MIGRATION);
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON %I FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE TRUNCATE ON %I FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE TRIGGER ON %I FROM proctira_app/i);
    for (const table of IMMUTABLE_TABLES) {
      expect(sql, `${table} listed in immutable REVOKE loop`).toMatch(
        new RegExp(`['"]${table}['"]`),
      );
    }
  });

  it('prior migrations already append-only guard fee_ledger and audit_log (re-verify tip)', () => {
    const feeLedger = loadSql('023_fee_ledger_schema.sql');
    expect(feeLedger).toMatch(/fee_ledger_entries_append_only/);
    expect(feeLedger).toMatch(
      /CREATE TRIGGER trg_fee_ledger_append_only[\s\S]*BEFORE UPDATE OR DELETE ON fee_ledger_entries/i,
    );

    const audit = loadSql('022_control_plane_schema.sql');
    expect(audit).toMatch(/audit_log_append_only/);
    expect(audit).toMatch(
      /CREATE TRIGGER trg_audit_log_append_only[\s\S]*BEFORE UPDATE OR DELETE ON audit_log_entries/i,
    );

    const workflow = loadSql('025_workflow_engine_schema.sql');
    expect(workflow).toMatch(/proctira_workflow_audit_immutable/);
    expect(workflow).toMatch(
      /CREATE TRIGGER trg_workflow_transition_audit_immutable[\s\S]*ON workflow_transition_audit/i,
    );
  });

  it('050 grants DML to proctira_app but 053 narrows immutable tables (role split intact)', () => {
    const roleSplit = loadSql('050_app_runtime_role.sql');
    expect(roleSplit).toMatch(/GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE/i);
    expect(roleSplit).toMatch(/proctira_app/);

    const immutability = loadSql(IMMUTABILITY_MIGRATION);
    expect(immutability).toMatch(/053_immutability_privileges\.sql/);
    expect(immutability).toMatch(/proctira_app/);
  });
});
