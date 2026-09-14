/**
 * Smoke tests for tools/scripts/bootstrap-db-roles.sh (W1-DATA-10).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const scriptPath = resolve(here, '..', 'bootstrap-db-roles.sh');
const sqlPath = resolve(repoRoot, 'db/bootstrap/01_runtime_roles.sql');

const SUPER_URL =
  process.env.BOOTSTRAP_DATABASE_URL?.trim() ||
  process.env.POSTGRES_SUPERUSER_URL?.trim() ||
  '';

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('bootstrap-db-roles.sh', () => {
  it('dry-run exits 0 and names the bootstrap SQL', () => {
    const { status, stdout, stderr } = run(['--dry-run']);
    expect(status, stderr).toBe(0);
    expect(stdout).toMatch(/01_runtime_roles\.sql/);
    expect(readFileSync(sqlPath, 'utf8')).toMatch(/proctira_app/);
  });

  it('fails closed without BOOTSTRAP_DATABASE_URL', () => {
    const { status, stderr } = run([], { BOOTSTRAP_DATABASE_URL: '' });
    expect(status).not.toBe(0);
    expect(stderr + '').toMatch(/BOOTSTRAP_DATABASE_URL/);
  });
});

describe.skipIf(!SUPER_URL)('bootstrap-db-roles.sh live (superuser)', () => {
  it('is idempotent: second run still verifies proctira_app OK', () => {
    const env = {
      BOOTSTRAP_DATABASE_URL: SUPER_URL,
      // Do not rotate passwords in shared CI/dev clusters unless explicitly provided.
      MIGRATOR_PASSWORD: process.env.MIGRATOR_PASSWORD ?? '',
      APP_ROLE_PASSWORD: process.env.APP_ROLE_PASSWORD ?? '',
    };
    const first = run([], env);
    expect(first.status, first.stderr + first.stdout).toBe(0);
    expect(first.stdout).toMatch(/proctira_app OK/);

    const second = run([], env);
    expect(second.status, second.stderr + second.stdout).toBe(0);
    expect(second.stdout).toMatch(/proctira_app OK/);
    expect(second.stdout).toMatch(/already exists|bootstrap complete/i);
  });
});
