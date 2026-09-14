#!/usr/bin/env node
/**
 * W1-DATA-17 COMPLETE — lock-contention recovery drill.
 *
 * Proves: when apply-sql hits lock_timeout mid-file, the ledger does **not**
 * record the file; after the blocker releases, re-running apply-sql resumes
 * and applies the same file successfully.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node tools/scripts/migration-lock-recovery-drill.mjs
 *   node tools/scripts/migration-lock-recovery-drill.mjs --url=postgresql://…
 *   node tools/scripts/migration-lock-recovery-drill.mjs --skip-if-no-db   # exit 0 when URL unset
 *
 * Exit 0 on pass; exit 1 on failure; exit 2 when DB required but missing.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const applySqlPath = join(repoRoot, 'tools/scripts/apply-sql.sh');

/**
 * @param {string[]} argv
 */
export function parseDrillArgs(argv) {
  let url =
    process.env.MIGRATOR_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    '';
  let skipIfNoDb = false;
  for (const arg of argv) {
    if (arg === '--skip-if-no-db') skipIfNoDb = true;
    else if (arg.startsWith('--url=')) url = arg.slice('--url='.length);
  }
  return { url, skipIfNoDb };
}

/**
 * @param {string} url
 * @param {string} sql
 * @param {{ onErrorStop?: boolean }} [opts]
 */
export function psql(url, sql, opts = {}) {
  const args = [url, '-v', 'ON_ERROR_STOP=1', '-At'];
  if (opts.onErrorStop === false) {
    args.splice(1, 2); // drop ON_ERROR_STOP
  }
  args.push('-c', sql);
  const result = spawnSync('psql', args, { encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: result.stderr ?? '',
  };
}

/**
 * @param {Record<string, string>} env
 */
export function runApplySql(env) {
  chmodSync(applySqlPath, 0o755);
  const result = spawnSync('bash', [applySqlPath], {
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

/**
 * Hold ACCESS EXCLUSIVE on a table in a background psql session until killed.
 * @param {string} url
 * @param {string} table
 */
export function holdAccessExclusive(url, table) {
  const child = spawn(
    'psql',
    [url, '-v', 'ON_ERROR_STOP=1', '-c', `BEGIN; LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return child;
}

/**
 * Core drill — exported for unit tests that inject fakes.
 * @param {{
 *   url: string,
 *   psqlFn?: typeof psql,
 *   runApplyFn?: typeof runApplySql,
 *   holdFn?: typeof holdAccessExclusive,
 *   delayMs?: number,
 * }} opts
 */
export async function runLockRecoveryDrill(opts) {
  const {
    url,
    psqlFn = psql,
    runApplyFn = runApplySql,
    holdFn = holdAccessExclusive,
    delayMs = 400,
  } = opts;

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'w1-data17-lock-'));
  const fixtureSql = join(fixtureRoot, 'sql');
  mkdirSync(fixtureSql, { recursive: true });

  const table = 'w1_data17_lock_probe';
  const migrationName = '001_w1_data17_lock_probe.sql';
  /** @type {import('node:child_process').ChildProcess | null} */
  let holder = null;

  try {
    const drop = psqlFn(
      url,
      `DROP TABLE IF EXISTS ${table} CASCADE;
       DROP TABLE IF EXISTS schema_migrations CASCADE;`,
    );
    if (drop.status !== 0) {
      return { ok: false, issues: [`setup drop failed: ${drop.stderr}`] };
    }

    const create = psqlFn(
      url,
      `CREATE TABLE ${table} (id int PRIMARY KEY);
       INSERT INTO ${table} (id) VALUES (1);`,
    );
    if (create.status !== 0) {
      return { ok: false, issues: [`setup create failed: ${create.stderr}`] };
    }

    writeFileSync(
      join(fixtureSql, migrationName),
      `-- W1-DATA-17 lock recovery probe
ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false;
UPDATE ${table} SET recovered = true;
`,
      'utf8',
    );

    const env = {
      DATABASE_URL: url,
      MIGRATOR_DATABASE_URL: url,
      APPLY_SQL_DIR: fixtureSql,
      APPLY_SEEDS: '0',
      APPLY_STRICT_FKS: '0',
      APPLY_SQL_LOCK_TIMEOUT: '1s',
      APPLY_SQL_STATEMENT_TIMEOUT: '30s',
      MIGRATION_LOCK_TIMEOUT: '1s',
      MIGRATION_STATEMENT_TIMEOUT: '30s',
    };

    holder = holdFn(url, table);
    await delay(delayMs);

    const blocked = runApplyFn(env);
    if (blocked.status === 0) {
      return {
        ok: false,
        issues: [
          'expected apply-sql to fail under ACCESS EXCLUSIVE contention, but it succeeded',
          blocked.stdout,
        ],
      };
    }

    const combinedFail = `${blocked.stderr}\n${blocked.stdout}`;
    if (!/lock[_ ]timeout|lock_not_available|canceling statement due to lock/i.test(combinedFail)) {
      return {
        ok: false,
        issues: [
          `blocked apply failed, but not with lock_timeout/lock_not_available: ${combinedFail}`,
        ],
      };
    }

    const ledgerDuring = psqlFn(
      url,
      `SELECT count(*) FROM schema_migrations WHERE filename = '${migrationName}'`,
    );
    if (ledgerDuring.status !== 0) {
      // schema_migrations may not exist if apply died before bootstrap — treat as empty.
    } else if (ledgerDuring.stdout !== '0') {
      return {
        ok: false,
        issues: [
          `ledger recorded ${migrationName} after lock failure (count=${ledgerDuring.stdout}); resume would skip`,
        ],
      };
    }

    if (holder && !holder.killed) {
      holder.kill('SIGTERM');
      holder = null;
    }
    // Ensure lock released even if SIGTERM left a backend.
    psqlFn(url, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query ILIKE '%LOCK TABLE ${table}%';`);
    await delay(delayMs);

    const resume = runApplyFn(env);
    if (resume.status !== 0) {
      return {
        ok: false,
        issues: [
          `resume apply failed after lock release: ${resume.stderr}\n${resume.stdout}`,
        ],
      };
    }
    if (!/Applying .*001_w1_data17_lock_probe\.sql/.test(resume.stdout)) {
      return {
        ok: false,
        issues: [`resume did not apply ${migrationName}: ${resume.stdout}`],
      };
    }

    const ledgerAfter = psqlFn(
      url,
      `SELECT count(*) FROM schema_migrations WHERE filename = '${migrationName}'`,
    );
    if (ledgerAfter.status !== 0 || ledgerAfter.stdout !== '1') {
      return {
        ok: false,
        issues: [`ledger missing ${migrationName} after successful resume (got ${ledgerAfter.stdout})`],
      };
    }

    const col = psqlFn(
      url,
      `SELECT recovered FROM ${table} WHERE id = 1`,
    );
    if (col.status !== 0 || col.stdout !== 't') {
      return {
        ok: false,
        issues: [`probe column not updated after resume (got ${col.stdout})`],
      };
    }

    return {
      ok: true,
      issues: [],
      detail: 'lock_timeout failed closed without ledger write; resume after unlock applied file',
    };
  } finally {
    if (holder && !holder.killed) {
      try {
        holder.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    psqlFn(
      url,
      `DROP TABLE IF EXISTS ${table} CASCADE;
       DROP TABLE IF EXISTS schema_migrations CASCADE;`,
    );
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { url, skipIfNoDb } = parseDrillArgs(process.argv.slice(2));
  if (!url) {
    if (skipIfNoDb) {
      console.log('W1-DATA-17 lock recovery drill: SKIP (no DATABASE_URL)');
      return;
    }
    console.error('W1-DATA-17 lock recovery drill: DATABASE_URL / MIGRATOR_DATABASE_URL required');
    process.exitCode = 2;
    return;
  }

  const hasPsql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if ((hasPsql.status ?? 1) !== 0) {
    console.error('W1-DATA-17 lock recovery drill: psql not found on PATH');
    process.exitCode = 2;
    return;
  }

  const report = await runLockRecoveryDrill({ url });
  if (report.ok) {
    console.log(`W1-DATA-17 lock recovery drill: PASS — ${report.detail}`);
  } else {
    console.error('W1-DATA-17 lock recovery drill: FAIL');
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
