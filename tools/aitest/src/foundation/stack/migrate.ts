/**
 * Schema path = CI e2e path (program plan D5): Prisma migrate deploy as the
 * migrator, then tools/scripts/apply-sql.sh with APPLY_SEEDS=1 and
 * APPLY_STRICT_FKS=1 (.github/workflows/e2e-backend-ready.yml).
 */
import { join } from 'node:path';

import { withPg } from '../db/pg.js';
import { runOrThrow, sleep } from '../exec.js';

import { stackDbUrls } from './state.js';
import type { StackState } from './types.js';

const STRIP = [
  'DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'BOOTSTRAP_DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PGOPTIONS',
  'APPLY_SEEDS',
  'APPLY_STRICT_FKS',
];

function parentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of STRIP) delete env[k];
  return env;
}

/**
 * Waits until the migrator can log in over TCP. The image's init scripts run
 * on a socket-only temporary server, so a TCP login as the migrator proves
 * initialisation (role passwords included) has finished.
 */
export async function waitForPostgres(s: StackState, timeoutMs = 120_000): Promise<void> {
  const url = stackDbUrls(s).migrator;
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      await withPg(url, (c) => c.query('SELECT 1'));
      return;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  throw new Error(`postgres on 127.0.0.1:${s.ports.postgres} not ready: ${last}`);
}

export async function migrateStack(s: StackState): Promise<void> {
  const urls = stackDbUrls(s);
  const logFile = join(s.projectDir, 'logs', 'migrate.log');
  await runOrThrow('pnpm', ['--filter', '@proctira/database', 'run', 'prisma:migrate:deploy'], {
    cwd: s.repoRoot,
    env: { ...parentEnv(), DATABASE_URL: urls.migrator },
    logFile,
    label: 'prisma migrate deploy',
  });
  await runOrThrow('bash', ['tools/scripts/apply-sql.sh'], {
    cwd: s.repoRoot,
    env: {
      ...parentEnv(),
      MIGRATOR_DATABASE_URL: urls.migrator,
      DATABASE_URL: urls.runtime,
      APPLY_SEEDS: '1',
      APPLY_STRICT_FKS: '1',
    },
    logFile,
    label: 'apply-sql.sh',
  });
}
