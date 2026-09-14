/**
 * W1-DATA-10 — static contract for documented DB role bootstrap on fresh installs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bootstrapSql = join(root, 'db/bootstrap/01_runtime_roles.sql');
const bootstrapReadme = join(root, 'db/bootstrap/README.md');
const bootstrapScript = join(root, 'tools/scripts/bootstrap-db-roles.sh');
const applySql = join(root, 'tools/scripts/apply-sql.sh');
const onboard = join(root, 'tools/scripts/setup-live-db-and-onboard.sh');
const compose = join(root, 'docker-compose.yml');
const dockerInitPw = join(root, 'db/docker-init/02_local_passwords.sql');
const dbReadme = join(root, 'db/README.md');
const audit = join(root, 'docs/audits/DATA_W1_DATA_10_DB_BOOTSTRAP.md');

describe('W1-DATA-10 db role bootstrap (static)', () => {
  it('ships idempotent bootstrap SQL for proctira + proctira_app', () => {
    expect(existsSync(bootstrapSql), 'missing db/bootstrap/01_runtime_roles.sql').toBe(true);
    const sql = readFileSync(bootstrapSql, 'utf8');
    expect(sql).toMatch(/W1-DATA-10/);
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*proctira_app/i);
    expect(sql).toMatch(/CREATE ROLE proctira_app/i);
    expect(sql).toMatch(/CREATE ROLE proctira\b/i);
    expect(sql).toMatch(/NOSUPERUSER/);
    expect(sql).toMatch(/NOBYPASSRLS/);
    expect(sql).toMatch(/GRANT CONNECT ON DATABASE/i);
    // Passwords must not be baked into canonical bootstrap SQL.
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
  });

  it('ships bootstrap-db-roles.sh with dry-run and password env wiring', () => {
    expect(existsSync(bootstrapScript)).toBe(true);
    const sh = readFileSync(bootstrapScript, 'utf8');
    expect(sh).toMatch(/BOOTSTRAP_DATABASE_URL/);
    expect(sh).toMatch(/MIGRATOR_PASSWORD/);
    expect(sh).toMatch(/APP_ROLE_PASSWORD/);
    expect(sh).toMatch(/BOOTSTRAP_DB_NAME/);
    expect(sh).toMatch(/BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES/);
    expect(sh).toMatch(/--dry-run/);

    const dry = spawnSync('bash', [bootstrapScript, '--dry-run'], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env },
    });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/W1-DATA-10 dry-run/);
    expect(dry.stdout).toMatch(/01_runtime_roles\.sql/);
  });

  it('apply-sql.sh and setup-live-db-and-onboard.sh invoke bootstrap when URL set', () => {
    const apply = readFileSync(applySql, 'utf8');
    expect(apply).toMatch(/W1-DATA-10/);
    expect(apply).toMatch(/bootstrap-db-roles\.sh/);
    expect(apply).toMatch(/BOOTSTRAP_DATABASE_URL/);
    expect(apply).toMatch(/maybe_bootstrap_roles/);

    const onb = readFileSync(onboard, 'utf8');
    expect(onb).toMatch(/W1-DATA-10/);
    expect(onb).toMatch(/bootstrap-db-roles\.sh/);
    expect(onb).toMatch(/BOOTSTRAP_DATABASE_URL/);
  });

  it('docker-compose mounts canonical bootstrap SQL for fresh volumes', () => {
    const yml = readFileSync(compose, 'utf8');
    expect(yml).toMatch(/db\/bootstrap\/01_runtime_roles\.sql/);
    expect(yml).toMatch(/db\/docker-init\/02_local_passwords\.sql/);
    expect(existsSync(dockerInitPw)).toBe(true);
    expect(readFileSync(dockerInitPw, 'utf8')).toMatch(/proctira_app_dev_password/);
  });

  it('documents bootstrap in db/README and ships audit evidence pack', () => {
    expect(readFileSync(dbReadme, 'utf8')).toMatch(/W1-DATA-10/);
    expect(existsSync(bootstrapReadme)).toBe(true);
    expect(existsSync(audit), 'missing docs/audits/DATA_W1_DATA_10_DB_BOOTSTRAP.md').toBe(
      true,
    );
    expect(readFileSync(audit, 'utf8')).toMatch(/W1-DATA-10/);
  });
});
