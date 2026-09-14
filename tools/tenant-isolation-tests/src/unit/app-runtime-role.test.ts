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
const secretsPath = join(
  root,
  'infrastructure/k8s/overlays/development/secrets.yaml',
);

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

  it('tenant-isolation CI job runs live integration as proctira_app, not table owner', () => {
    const ci = readFileSync(ciPath, 'utf8');
    const jobMatch = ci.match(
      /\n  tenant-isolation:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|\n# -----|$)/,
    );
    expect(jobMatch, 'tenant-isolation job block missing').toBeTruthy();
    const job = jobMatch![0];
    expect(job).toMatch(/CREATE ROLE proctira_app/);
    expect(job).toMatch(
      /Run integration isolation tests[\s\S]*?DATABASE_URL:\s*postgresql:\/\/proctira_app:proctira_app_test@/,
    );
    expect(job).not.toMatch(
      /Run integration isolation tests[\s\S]*?DATABASE_URL:\s*postgresql:\/\/proctira:proctira_test@/,
    );
  });

  it('k8s development overlay runtime secret uses proctira_app', () => {
    expect(existsSync(secretsPath)).toBe(true);
    const secrets = readFileSync(secretsPath, 'utf8');
    // Avoid matching MIGRATOR_DATABASE_URL suffix by requiring line start.
    expect(secrets).toMatch(
      /(^|\n)\s*DATABASE_URL:\s*'postgresql:\/\/proctira_app:[^']+@postgres:5432\/proctira'/,
    );
    expect(secrets).toMatch(
      /(^|\n)\s*MIGRATOR_DATABASE_URL:\s*'postgresql:\/\/proctira:[^']+@postgres:5432\/proctira'/,
    );
    expect(secrets).not.toMatch(
      /(^|\n)\s*DATABASE_URL:\s*'postgresql:\/\/proctira:[^']+@postgres:5432\/proctira'/,
    );
  });
});
