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
  throw new Error(`W1-OPS-19: RETENTION_DRY_RUN must be "0" or "1" (got ${JSON.stringify(v)}).`);
}

const PHI_DAYS = Number(process.env.PHI_RETENTION_DAYS ?? '2555');
const MINOR_DAYS = Number(process.env.MINOR_PHI_RETENTION_DAYS ?? '3650');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts/phi-retention';
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
    applied: dryRun ? { counsellingDeleted: 0, specialNeedsDeleted: 0 } : undefined,
  };
}

/** PHI tables swept by the job. `key` names the summary candidate field. */
export const PHI_RETENTION_TABLES = [
  { table: 'counselling_sessions', key: 'counsellingSessions' },
  { table: 'health_special_needs_assessments', key: 'specialNeedsRecords' },
];

/**
 * PRC-M559: one SQL script for the whole run, executed by one psql session
 * under `--single-transaction`, so counts and deletes for every tenant commit
 * or roll back together. The script:
 *   - asserts at startup that the connected role holds the privileges the run
 *     needs (SELECT, plus DELETE when applying);
 *   - enumerates tenants under the platform scope and fails when none are
 *     visible (an RLS-filtered role must not report a run that scanned nothing);
 *   - binds `app.tenant_id` per tenant and checks the tenant row is visible
 *     under that binding, so FORCE RLS cannot silently hide the tenant's rows;
 *   - counts eligible rows per tenant and table and, when applying, deletes
 *     them and raises unless the deleted count equals the eligible count.
 * The final statement prints one JSON line with per-tenant counts.
 *
 * @param {object} args
 * @param {string} args.adultCutoffIso
 * @param {string} args.minorCutoffIso
 * @param {boolean} args.dryRun
 * @returns {string}
 */
export function buildRetentionScript({ adultCutoffIso, minorCutoffIso, dryRun }) {
  const privilegeChecks = PHI_RETENTION_TABLES.flatMap(({ table }) => [
    [table, 'SELECT'],
    ...(dryRun ? [] : [[table, 'DELETE']]),
  ]).concat([
    ['students', 'SELECT'],
    ['tenants', 'SELECT'],
  ]);
  const privilegeSql = privilegeChecks
    .map(
      ([
        table,
        privilege,
      ]) => `  IF NOT has_table_privilege(current_user, '${table}', '${privilege}') THEN
    RAISE EXCEPTION 'PRC-M559: role % lacks ${privilege} on ${table}', current_user
      USING ERRCODE = '42501';
  END IF;`,
    )
    .join('\n');

  const perTable = PHI_RETENTION_TABLES.map(({ table }) => {
    const eligible = `${buildEligibleFrom({ table, adultCutoffIso, minorCutoffIso })}
       AND r.tenant_id::text = v_tenant`;
    const apply = dryRun
      ? `    v_deleted := 0;`
      : `    WITH d AS (
      DELETE FROM "${table}" t
      WHERE t.tenant_id::text = v_tenant
        AND t.id IN (SELECT r.id ${eligible})
      RETURNING t.id
    )
    SELECT count(*)::int INTO v_deleted FROM d;
    IF v_deleted <> v_eligible THEN
      RAISE EXCEPTION 'PRC-M559: tenant % ${table}: deleted % of % eligible rows', v_tenant, v_deleted, v_eligible;
    END IF;`;
    return `    SELECT count(*)::int INTO v_eligible ${eligible};
${apply}
    INSERT INTO phi_retention_result VALUES (v_tenant, '${table}', v_eligible, v_deleted);`;
  }).join('\n');

  return `CREATE TEMP TABLE phi_retention_result (
  tenant_id text NOT NULL,
  table_name text NOT NULL,
  eligible integer NOT NULL,
  deleted integer NOT NULL
) ON COMMIT DROP;
DO $phi_retention$
DECLARE
  v_tenants text[];
  v_tenant text;
  v_eligible integer;
  v_deleted integer;
BEGIN
${privilegeSql}
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.platform_admin', '1', true);
  SELECT coalesce(array_agg(id::text ORDER BY id::text), '{}') INTO v_tenants FROM tenants;
  PERFORM set_config('app.platform_admin', '', true);
  IF cardinality(v_tenants) = 0 THEN
    RAISE EXCEPTION 'PRC-M559: role % sees no tenants; refusing to report a retention run that scanned nothing', current_user
      USING ERRCODE = '42501';
  END IF;
  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant, true);
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id::text = v_tenant) THEN
      RAISE EXCEPTION 'PRC-M559: tenant % is not visible with app.tenant_id bound (RLS)', v_tenant
        USING ERRCODE = '42501';
    END IF;
${perTable}
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$phi_retention$;
SELECT json_build_object(
  'tenantsScanned', (SELECT count(DISTINCT tenant_id) FROM phi_retention_result),
  'rows', coalesce(
    (SELECT json_agg(json_build_object(
       'tenantId', tenant_id, 'table', table_name, 'eligible', eligible, 'deleted', deleted
     ) ORDER BY tenant_id, table_name) FROM phi_retention_result),
    '[]'::json)
)::text;
`;
}

/**
 * Run the retention script in one psql session and one transaction. Any psql
 * error (connection, privilege, RLS assertion, count mismatch) throws; nothing
 * is reported as a zero count.
 *
 * @param {string} sql
 * @param {{ databaseUrl: string, spawn?: typeof spawnSync }} options
 * @returns {{ tenantsScanned: number, rows: Array<{ tenantId: string, table: string, eligible: number, deleted: number }> }}
 */
export function runRetentionScript(sql, { databaseUrl, spawn = spawnSync }) {
  const result = spawn(
    'psql',
    [
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '-d',
      databaseUrl,
      '-f',
      '-',
    ],
    { encoding: 'utf8', input: sql },
  );
  // Never rethrow the spawn error object itself: its spawnargs carry the URL.
  if (result.error) {
    throw new Error(`PRC-M559: could not run psql (${result.error.code ?? 'spawn error'})`);
  }
  if (result.status !== 0) {
    throw new Error(`PRC-M559: psql failed (exit ${result.status}): ${result.stderr || ''}`.trim());
  }
  const lines = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  let parsed;
  try {
    parsed = JSON.parse(last ?? '');
  } catch {
    throw new Error('PRC-M559: psql returned no retention summary');
  }
  if (!parsed || !Number.isInteger(parsed.tenantsScanned) || !Array.isArray(parsed.rows)) {
    throw new Error('PRC-M559: psql returned a malformed retention summary');
  }
  return parsed;
}

/**
 * Sum per-tenant rows into the summary candidate / applied counts.
 * @param {Array<{ table: string, eligible: number, deleted: number }>} rows
 */
export function summariseRetentionRows(rows) {
  const total = (table, field) =>
    rows.filter((row) => row.table === table).reduce((sum, row) => sum + Number(row[field]), 0);
  return {
    counsellingCount: total('counselling_sessions', 'eligible'),
    specialNeedsCount: total('health_special_needs_assessments', 'eligible'),
    counsellingDeleted: total('counselling_sessions', 'deleted'),
    specialNeedsDeleted: total('health_special_needs_assessments', 'deleted'),
  };
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
    plan.note = 'DATABASE_URL unset — wrote policy plan only (CI / local without Postgres).';
    await writeFile(path.join(ARTIFACT_DIR, 'summary.json'), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const adultCutoff = retentionCutoffIso(PHI_DAYS);
  const minorCutoff = retentionCutoffIso(MINOR_DAYS);

  // PRC-H107: minor-linked records are retained for the longer minor window
  // (buildEligibleFrom, used per table inside buildRetentionScript).
  // PRC-M559: counts and deletes run in one psql session / one transaction and
  // every psql failure throws (main().catch exits non-zero).
  const summary = runRetentionScript(
    buildRetentionScript({ adultCutoffIso: adultCutoff, minorCutoffIso: minorCutoff, dryRun }),
    { databaseUrl: DATABASE_URL },
  );
  const totals = summariseRetentionRows(summary.rows);

  const plan = buildRetentionPlan({
    counsellingCount: totals.counsellingCount,
    specialNeedsCount: totals.specialNeedsCount,
    dryRun,
    phiDays: PHI_DAYS,
    minorDays: MINOR_DAYS,
  });
  plan.mode = dryRun ? 'dry-run' : 'apply';
  plan.tenantsScanned = summary.tenantsScanned;
  plan.perTenant = summary.rows;

  if (!dryRun) {
    plan.applied = {
      counsellingDeleted: totals.counsellingDeleted,
      specialNeedsDeleted: totals.specialNeedsDeleted,
    };
  }

  await writeFile(path.join(ARTIFACT_DIR, 'summary.json'), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
