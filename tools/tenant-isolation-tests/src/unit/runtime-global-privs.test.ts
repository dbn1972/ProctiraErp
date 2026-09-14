/**
 * W1-DATA-11 residual — platform-global catalog privileges (073).
 *
 * Ledgers are covered by 072_control_ledger_privileges.sql (#235).
 * 073 narrows insights platform catalogs to SELECT/INSERT and re-asserts
 * ledger REVOKE ALL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const LEDGER_MIGRATION = '072_control_ledger_privileges.sql';
const CATALOG_MIGRATION = '073_runtime_global_table_privileges.sql';

const LEDGER_TABLES = ['schema_migrations', '_prisma_migrations'] as const;
const GLOBAL_CATALOG_TABLES = [
  'insights_ui_templates',
  'insights_ui_indicators',
  'insights_ui_geo_features',
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

describe('W1-DATA-11 runtime global table privileges (072 + 073)', () => {
  it('ships 072 ledger REVOKE and 073 catalog narrow', () => {
    expect(existsSync(join(sqlDir(), LEDGER_MIGRATION))).toBe(true);
    expect(existsSync(join(sqlDir(), CATALOG_MIGRATION))).toBe(true);
    const ledger = loadSql(LEDGER_MIGRATION);
    const catalogs = loadSql(CATALOG_MIGRATION);
    expect(ledger).toMatch(/W1-DATA-11/);
    expect(catalogs).toMatch(/W1-DATA-11/);
    expect(catalogs).toMatch(/073_runtime_global_table_privileges\.sql/);
  });

  it('072 REVOKEs ALL on migration ledgers from proctira_app (+ PUBLIC)', () => {
    const sql = loadSql(LEDGER_MIGRATION);
    expect(sql).toMatch(/REVOKE ALL ON TABLE %I FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE %I FROM PUBLIC/i);
    for (const table of LEDGER_TABLES) {
      expect(sql).toMatch(new RegExp(`['"]${table}['"]`));
    }
  });

  it('073 grants SELECT, INSERT only on platform-global catalogs', () => {
    const sql = loadSql(CATALOG_MIGRATION);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE %I TO proctira_app/i);
    for (const table of GLOBAL_CATALOG_TABLES) {
      expect(sql).toMatch(new RegExp(`['"]${table}['"]`));
    }
    expect(sql).not.toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+%I\s+TO\s+proctira_app/i,
    );
  });

  it('073 re-asserts ledger REVOKE (idempotent with 072)', () => {
    const sql = loadSql(CATALOG_MIGRATION);
    for (const table of LEDGER_TABLES) {
      expect(sql).toMatch(new RegExp(`['"]${table}['"]`));
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE %I FROM proctira_app/i);
  });

  it('audit packs document ledger + catalog halves', () => {
    const root = join(sqlDir(), '..', '..');
    const privileges = join(root, 'docs/audits/DATA_W1_DATA_11_PRIVILEGES.md');
    const privs = join(root, 'docs/audits/DATA_W1_DATA_11_PRIVS.md');
    expect(existsSync(privileges)).toBe(true);
    expect(existsSync(privs)).toBe(true);
    expect(readFileSync(privileges, 'utf8')).toMatch(/072_control_ledger_privileges/);
    expect(readFileSync(privs, 'utf8')).toMatch(/073_runtime_global_table_privileges/);
  });
});
