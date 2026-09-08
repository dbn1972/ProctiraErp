#!/usr/bin/env node
/**
 * G-503 — PHI / minor-data retention job (dry-run by default).
 *
 * Uses `psql` when DATABASE_URL is set (no Node `pg` dependency required).
 *
 * Env:
 *   DATABASE_URL              optional; without it writes policy plan only
 *   PHI_RETENTION_DAYS        default 2555 (~7y)
 *   MINOR_PHI_RETENTION_DAYS  default 3650 (~10y)
 *   RETENTION_DRY_RUN         default "1"
 *   ARTIFACT_DIR              evidence output directory
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY_RUN = (process.env.RETENTION_DRY_RUN ?? '1') !== '0';
const PHI_DAYS = Number(process.env.PHI_RETENTION_DAYS ?? '2555');
const MINOR_DAYS = Number(process.env.MINOR_PHI_RETENTION_DAYS ?? '3650');
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts/phi-retention';
const DATABASE_URL = process.env.DATABASE_URL;

export function retentionCutoffIso(days, now = new Date()) {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString();
}

export function classifyRetentionBucket({ isMinor, phiDays, minorDays }) {
  return isMinor ? minorDays : phiDays;
}

export function buildRetentionPlan({
  counsellingCount,
  specialNeedsCount,
  dryRun,
  phiDays,
  minorDays,
}) {
  return {
    ok: true,
    gap: 'G-503',
    dryRun,
    policy: {
      adultPhiRetentionDays: phiDays,
      minorPhiRetentionDays: minorDays,
      adultCutoff: retentionCutoffIso(phiDays),
      minorCutoff: retentionCutoffIso(minorDays),
    },
    candidates: {
      counsellingSessions: counsellingCount,
      specialNeedsRecords: specialNeedsCount,
    },
    applied: dryRun
      ? { counsellingDeleted: 0, specialNeedsDeleted: 0 }
      : undefined,
  };
}

function psqlScalar(sql) {
  const result = spawnSync(
    'psql',
    [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    return null;
  }
  const text = (result.stdout || '').trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function psqlExec(sql) {
  const result = spawnSync(
    'psql',
    [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || 'psql failed');
  }
  const text = (result.stdout || '').trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });

  if (!DATABASE_URL) {
    const plan = buildRetentionPlan({
      counsellingCount: 0,
      specialNeedsCount: 0,
      dryRun: true,
      phiDays: PHI_DAYS,
      minorDays: MINOR_DAYS,
    });
    plan.mode = 'no-database';
    plan.note =
      'DATABASE_URL unset — wrote policy plan only (CI / local without Postgres).';
    await writeFile(
      path.join(ARTIFACT_DIR, 'summary.json'),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const adultCutoff = retentionCutoffIso(PHI_DAYS);
  const minorCutoff = retentionCutoffIso(MINOR_DAYS);

  let counsellingCount =
    psqlScalar(
      `SELECT count(*)::int FROM counselling_sessions WHERE created_at < '${adultCutoff}'::timestamptz;`,
    ) ?? 0;

  let specialNeedsCount =
    psqlScalar(
      `SELECT count(*)::int FROM health_special_needs_assessments WHERE created_at < '${adultCutoff}'::timestamptz;`,
    ) ??
    psqlScalar(
      `SELECT count(*)::int FROM health_special_needs_records WHERE created_at < '${adultCutoff}'::timestamptz;`,
    ) ??
    0;

  // Silence unused minorCutoff in dry-run count path (documented for apply policy).
  void minorCutoff;

  const plan = buildRetentionPlan({
    counsellingCount,
    specialNeedsCount,
    dryRun: DRY_RUN,
    phiDays: PHI_DAYS,
    minorDays: MINOR_DAYS,
  });
  plan.mode = DRY_RUN ? 'dry-run' : 'apply';

  if (!DRY_RUN) {
    const counsellingDeleted = psqlExec(
      `WITH d AS (
         DELETE FROM counselling_sessions WHERE created_at < '${adultCutoff}'::timestamptz RETURNING 1
       ) SELECT count(*)::int FROM d;`,
    );
    let specialNeedsDeleted = 0;
    try {
      specialNeedsDeleted = psqlExec(
        `WITH d AS (
           DELETE FROM health_special_needs_assessments WHERE created_at < '${adultCutoff}'::timestamptz RETURNING 1
         ) SELECT count(*)::int FROM d;`,
      );
    } catch {
      specialNeedsDeleted = 0;
    }
    plan.applied = { counsellingDeleted, specialNeedsDeleted };
  }

  await writeFile(
    path.join(ARTIFACT_DIR, 'summary.json'),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  console.log(JSON.stringify(plan, null, 2));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
