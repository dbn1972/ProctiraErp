/**
 * W1-DATA-01 — static contract for the migrator vs runtime role split.
 *
 * Live RLS behaviour is covered by
 * packages/shared/database/src/app-runtime-role.live.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlPath = join(root, 'db/sql/050_app_runtime_role.sql');
const envExamplePath = join(root, '.env.example');
const ciPath = join(root, '.github/workflows/ci.yml');

describe('W1-DATA-01 app runtime role split (static)', () => {
  it('ships db/sql/050_app_runtime_role.sql granting DML to proctira_app', () => {
    expect(existsSync(sqlPath), 'missing db/sql/050_app_runtime_role.sql').toBe(true);
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/proctira_app/);
    expect(sql).toMatch(/GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE/i);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES/i);
    expect(sql).toMatch(/NOSUPERUSER/);
    expect(sql).toMatch(/NOBYPASSRLS/);
  });

  it('documents DATABASE_URL as proctira_app and migrator URL separately', () => {
    const env = readFileSync(envExamplePath, 'utf8');
    expect(env).toMatch(/MIGRATOR_DATABASE_URL/);
    expect(env).toMatch(/proctira_app/);
    expect(env).toMatch(/DATABASE_URL=postgresql:\/\/proctira_app/);
  });

  it('CI provisions proctira_app and runs suites as that role', () => {
    const ci = readFileSync(ciPath, 'utf8');
    expect(ci).toMatch(/CREATE ROLE proctira_app/);
    expect(ci).toMatch(/postgresql:\/\/proctira_app:proctira_app_test@/);
  });
});
