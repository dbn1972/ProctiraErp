#!/usr/bin/env node
/**
 * G-503 / W1-OPS-19 — PHI / minor-data retention job.
 *
 * Uses `psql` when DATABASE_URL is set (no Node `pg` dependency required).
 *
 * Env:
 *   DATABASE_URL              optional; without it writes policy plan only
 *   PHI_RETENTION_DAYS        default 2555 (~7y)
 *   MINOR_PHI_RETENTION_DAYS  default 3650 (~10y)
 *   RETENTION_DRY_RUN         required: "0" (enforce deletion) or "1" (sandbox dry-run)
 *                             Unset / other values fail closed (no silent dry-run default).
 *   ARTIFACT_DIR              evidence output directory
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve RETENTION_DRY_RUN. Fail closed when unset — dry-run is opt-in via "1".
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} true when dry-run
 */
export function resolveRetentionDryRun(env = process.env) {
  const raw = env.RETENTION_DRY_RUN;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error(
      'W1-OPS-19: RETENTION_DRY_RUN must be explicitly set to "0" (apply/enforce) or "1" (sandbox dry-run). Unset mode is refuse.',
    );
  }
  const v = String(raw).trim();
  if (v === '1') return true;
  if (v === '0') return false;
  throw new Error(
    `W1-OPS-19: RETENTION_DRY_RUN must be "0" or "1" (got ${JSON.stringify(v)}).`,
  );
}

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

/**
 * PRC-H107: build the SQL eligibility predicate that honours the minor
 * retention period. A record whose subject was a minor at the time the record
 * was created is only eligible for deletion once it is older than the (longer)
 * minor cutoff; adult records use the adult cutoff.
 *
 * The record is joined to `students.date_of_birth` by `student_id`. When the
 * student cannot be resolved (orphan row, or DOB unknown) we fail SAFE and keep
 * the row until the longer minor cutoff — never delete a possibly-minor record
 * at the adult cutoff.
 *
 * @param {object} args
 * @param {string} args.table            record table name (aliased `r`)
 * @param {string} args.adultCutoffIso   ISO timestamp for the adult cutoff
 * @param {string} args.minorCutoffIso   ISO timestamp for the (longer) minor cutoff
 * @returns {string} a boolean SQL expression over alias `r`
 */
export function buildRetentionPredicate({ table, adultCutoffIso, minorCutoffIso }) {
  void table;
  // was_minor: student existed and was < 18 years old at r.created_at.
  // If no student row / NULL DOB, was_minor is FALSE here but the COALESCE
  // below forces the minor (longer) cutoff for the unresolved case.
  const wasMinor = `(
    s.date_of_birth IS NOT NULL
    AND r.created_at < (s.date_of_birth + INTERVAL '18 years')
  )`;
  const studentResolved = `s.id IS NOT NULL AND s.date_of_birth IS NOT NULL`;
  // Effective cutoff: minor rows and unresolved rows -> minor cutoff; only a
  // confirmed adult uses the shorter adult cutoff.
  return `(
    CASE
      WHEN ${wasMinor} THEN r.created_at < '${minorCutoffIso}'::timestamptz
      WHEN (${studentResolved}) THEN r.created_at < '${adultCutoffIso}'::timestamptz
      ELSE r.created_at < '${minorCutoffIso}'::timestamptz
    END
  )`;
}

/**
 * Build a full count/delete body for a PHI table using the minor-aware
 * predicate. Joins the record table to `students` on `student_id = students.id`.
 * @param {object} args
 * @param {string} args.table
 * @param {string} args.adultCutoffIso
 * @param {string} args.minorCutoffIso
 * @returns {string} SQL FROM/JOIN/WHERE fragment selecting eligible rows (alias r)
 */
export function buildEligibleFrom({ table, adultCutoffIso, minorCutoffIso }) {
  const predicate = buildRetentionPredicate({ table, adultCutoffIso, minorCutoffIso });
  return `FROM "${table}" r
       LEFT JOIN students s ON s.id::text = r.student_id
     WHERE ${predicate}`;
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
  const dryRun = resolveRetentionDryRun(process.env);
  await mkdir(ARTIFACT_DIR, { recursive: true });

  if (!DATABASE_URL) {
    const plan = buildRetentionPlan({
      counsellingCount: 0,
      specialNeedsCount: 0,
      dryRun,
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

  // PRC-H107: minor-linked records are retained for the longer minor window.
  const counsellingFrom = buildEligibleFrom({
    table: 'counselling_sessions',
    adultCutoffIso: adultCutoff,
    minorCutoffIso: minorCutoff,
  });
  const specialNeedsFrom = buildEligibleFrom({
    table: 'health_special_needs_assessments',
    adultCutoffIso: adultCutoff,
    minorCutoffIso: minorCutoff,
  });

  const counsellingCount =
    psqlScalar(`SELECT count(*)::int ${counsellingFrom};`) ?? 0;

  const specialNeedsCount =
    psqlScalar(`SELECT count(*)::int ${specialNeedsFrom};`) ?? 0;

  const plan = buildRetentionPlan({
    counsellingCount,
    specialNeedsCount,
    dryRun,
    phiDays: PHI_DAYS,
    minorDays: MINOR_DAYS,
  });
  plan.mode = dryRun ? 'dry-run' : 'apply';

  if (!dryRun) {
    const counsellingDeleted = psqlExec(
      `WITH d AS (
         DELETE FROM counselling_sessions
         WHERE id IN (SELECT r.id ${counsellingFrom})
         RETURNING 1
       ) SELECT count(*)::int FROM d;`,
    );
    // PRC-H107/H259: a failure here must not be swallowed as a zero count and
    // reported as success. Let psqlExec throw so main().catch exits non-zero.
    const specialNeedsDeleted = psqlExec(
      `WITH d AS (
         DELETE FROM health_special_needs_assessments
         WHERE id IN (SELECT r.id ${specialNeedsFrom})
         RETURNING 1
       ) SELECT count(*)::int FROM d;`,
    );
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
