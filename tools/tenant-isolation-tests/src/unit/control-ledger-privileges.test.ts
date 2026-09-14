/**
 * W1-DATA-11 — static contract: runtime must not see/mutate global control ledgers.
 *
 * Live negative proofs:
 * packages/shared/database/src/control-ledger-privileges.live.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '072_control_ledger_privileges.sql';

/** Migrator-owned global control tables (non-tenant ledgers). */
const CONTROL_LEDGERS = ['schema_migrations', '_prisma_migrations'] as const;

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

describe('W1-DATA-11 control ledger privileges (072)', () => {
  it('ships 072 after 050/053 and REVOKEs ALL on control ledgers from proctira_app', () => {
    const path = join(sqlDir(), MIGRATION);
    expect(existsSync(path), `missing db/sql/${MIGRATION}`).toBe(true);
    const sql = loadSql(MIGRATION);
    expect(sql).toMatch(/W1-DATA-11/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE %I FROM proctira_app/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE %I FROM PUBLIC/i);
    for (const table of CONTROL_LEDGERS) {
      expect(sql, `${table} listed in control-ledger REVOKE loop`).toMatch(
        new RegExp(`['"]${table}['"]`),
      );
    }
    expect(sql).toMatch(/072_control_ledger_privileges\.sql/);
  });

  it('050 still grants broad DML; 072 is the narrowing step (role split intact)', () => {
    const roleSplit = loadSql('050_app_runtime_role.sql');
    expect(roleSplit).toMatch(/GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE/i);
    expect(roleSplit).toMatch(/ALL TABLES IN SCHEMA public/i);
    expect(roleSplit).toMatch(/proctira_app/);

    const narrowing = loadSql(MIGRATION);
    expect(narrowing).toMatch(/proctira_app/);
    expect(narrowing).toMatch(/schema_migrations/);
  });

  it('documents W1-DATA-11 in db README / bootstrap README and ships audit pack', () => {
    const root = join(sqlDir(), '..', '..');
    const dbReadme = readFileSync(join(root, 'db/README.md'), 'utf8');
    expect(dbReadme).toMatch(/W1-DATA-11/);
    expect(dbReadme).toMatch(/schema_migrations/);
    expect(dbReadme).toMatch(/_prisma_migrations/);

    const bootstrapReadme = readFileSync(join(root, 'db/bootstrap/README.md'), 'utf8');
    expect(bootstrapReadme).toMatch(/W1-DATA-11/);
    expect(bootstrapReadme).toMatch(/schema_migrations/);

    expect(existsSync(join(root, 'docs/audits/DATA_W1_DATA_11_PRIVILEGES.md'))).toBe(
      true,
    );
  });
});
