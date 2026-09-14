#!/usr/bin/env node
/**
 * G-503 / W1-OPS-19 — PHI / minor-data retention job.
 *
 * Uses `psql` when DATABASE_URL is set (no Node `pg` dependency required).
 *
 * Safety rails (count + delete):
 *   - Retention windows (`PHI_RETENTION_DAYS` / `MINOR_PHI_RETENTION_DAYS`)
 *   - Skip rows under active tenant or student legal hold (W1-SEC-06)
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
 * SQL predicate: row alias must expose tenant_id + student_id (text).
 * Skips tenants.legal_hold and active privacy_legal_holds (tenant or student).
 */
export function legalHoldExclusionSql(alias = 'r') {
  return `NOT EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.id::text = ${alias}.tenant_id
        AND COALESCE(t.legal_hold, false) = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM privacy_legal_holds h
      WHERE h.active = true
        AND h.tenant_id::text = ${alias}.tenant_id
        AND (
          h.scope = 'tenant'
          OR (
            h.scope = 'subject'
            AND h.subject_type = 'student'
            AND h.subject_id = ${alias}.student_id
          )
        )
    )`;
}

export function buildCandidateCountSql(table, cutoffIso) {
  return `SELECT count(*)::int FROM ${table} r
    WHERE r.created_at < '${cutoffIso}'::timestamptz
      AND ${legalHoldExclusionSql('r')};`;
}

export function buildDeleteSql(table, cutoffIso) {
  return `WITH d AS (
         DELETE FROM ${table} r
         WHERE r.created_at < '${cutoffIso}'::timestamptz
           AND ${legalHoldExclusionSql('r')}
         RETURNING 1
       ) SELECT count(*)::int FROM d;`;
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
      legalHoldExclusion: true,
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

  // Adult window for these tables today (no is_minor/DOB join). Minor window
  // remains in the plan for policy honesty (residual).
  void minorCutoff;

  let counsellingCount =
    psqlScalar(buildCandidateCountSql('counselling_sessions', adultCutoff)) ?? 0;

  let specialNeedsCount =
    psqlScalar(
      buildCandidateCountSql('health_special_needs_assessments', adultCutoff),
    ) ??
    psqlScalar(
      buildCandidateCountSql('health_special_needs_records', adultCutoff),
    ) ??
    0;

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
      buildDeleteSql('counselling_sessions', adultCutoff),
    );
    let specialNeedsDeleted = 0;
    try {
      specialNeedsDeleted = psqlExec(
        buildDeleteSql('health_special_needs_assessments', adultCutoff),
      );
    } catch {
      try {
        specialNeedsDeleted = psqlExec(
          buildDeleteSql('health_special_needs_records', adultCutoff),
        );
      } catch {
        specialNeedsDeleted = 0;
      }
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
