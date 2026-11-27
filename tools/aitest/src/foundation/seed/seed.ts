/**
 * Synthetic multi-tenant seed (program plan D6), applied as the migrator
 * (proctira, NOSUPERUSER NOBYPASSRLS) in the uatenv-seed.sh order. Each
 * guarded seed gets its guard GUC through PGOPTIONS for its own psql call.
 */
import { join } from 'node:path';

import { baseServiceEnv, runOrThrow } from '../exec.js';
import { MIGRATOR_USER, pgEnv, readEnvFile, secretsFromEnv } from '../stack/secrets.js';
import type { StackState } from '../stack/types.js';

import { REGISTRATION_INSTITUTION_ID, TENANTS } from './tenants.js';

export const AITEST_SEED_REL = 'tools/aitest/src/foundation/seed/aitest-tenants.sql';

export interface SeedStep {
  label: string;
  file: string;
  vars?: Record<string, string>;
  pgOptions?: string;
}

export function seedSteps(): SeedStep[] {
  return [
    { label: 'e2e tenants', file: 'tools/e2e/seed-e2e-tenants.sql' },
    {
      label: 'e2e registration tenant',
      file: 'tools/e2e/seed-e2e-registration.sql',
      vars: {
        tenant_id: TENANTS.REG.id,
        slug: TENANTS.REG.slug,
        institution_id: REGISTRATION_INSTITUTION_ID,
      },
    },
    {
      label: 'Sunrise demo (006)',
      file: 'db/seeds/006_sunrise_public_school_demo.sql',
      pgOptions: '-c proctira.allow_demo_seed=on',
    },
    {
      label: 'UAT detail records',
      file: 'tools/scripts/uatenv/uatenv-detail-records.sql',
      pgOptions: '-c proctira.allow_uat_seed=on',
    },
    {
      label: 'aitest tenants',
      file: AITEST_SEED_REL,
      pgOptions: '-c proctira.allow_aitest_seed=on',
    },
  ];
}

function migratorEnv(s: StackState, pgOptions?: string): NodeJS.ProcessEnv {
  const secrets = secretsFromEnv(readEnvFile(s.envFile));
  return {
    ...baseServiceEnv(),
    ...pgEnv(MIGRATOR_USER, secrets.migratorPassword, s.ports.postgres),
    ...(pgOptions ? { PGOPTIONS: pgOptions } : {}),
  };
}

export async function applySyntheticSeed(s: StackState): Promise<void> {
  const log = join(s.projectDir, 'logs', 'seed.log');
  for (const step of seedSteps()) {
    const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-q'];
    for (const [k, v] of Object.entries(step.vars ?? {})) args.push('-v', `${k}=${v}`);
    args.push('-f', join(s.repoRoot, step.file));
    await runOrThrow('psql', args, {
      env: migratorEnv(s, step.pgOptions),
      logFile: log,
      label: `seed ${step.label}`,
    });
  }
}

/**
 * Per-tenant row counts of every tenant-scoped table
 * (db/seeds/006_sunrise_demo_rowcounts.sql, the CI idempotency gate), sorted.
 */
export async function seedRowCounts(s: StackState): Promise<string[]> {
  const r = await runOrThrow(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-t',
      '-A',
      '-f',
      join(s.repoRoot, 'db/seeds/006_sunrise_demo_rowcounts.sql'),
    ],
    { env: migratorEnv(s), label: 'seed row counts' },
  );
  return r.stdout
    .split('\n')
    .filter((l) => /=[0-9]+$/.test(l))
    .sort();
}
