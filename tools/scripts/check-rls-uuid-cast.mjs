#!/usr/bin/env node
/**
 * PRC-L294 — fail closed when an RLS policy casts the tenant GUC to uuid.
 *
 * `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
 * raises 22P02 (invalid input syntax for type uuid) when the GUC is bound to a
 * non-UUID string, so a malformed tenant context becomes a 500 instead of a
 * deny. 095/099/240 rewrote every such policy to a safe-deny text compare
 * (`tenant_id::text = app_tenant_id()`); this gate keeps new ones out.
 *
 * Two modes:
 *   1. Static (always): every CREATE/ALTER POLICY statement in db/sql files
 *      numbered above STATIC_BASELINE must not cast the tenant GUC to uuid.
 *      Older files are checksum-locked and were rewritten by later forward
 *      migrations, so only the live catalog can judge them.
 *   2. Live (--live): reads pg_policies from MIGRATOR_DATABASE_URL /
 *      DATABASE_URL and fails on any policy whose USING or WITH CHECK both
 *      references the tenant GUC and contains a ::uuid cast. --require-live
 *      makes a missing database URL a failure instead of a skip.
 *
 * The safe uuid helper `app_tenant_uuid()` (PRC-L091) returns NULL for a
 * malformed GUC and does not match: it neither reads the GUC by name nor casts
 * in the policy text.
 *
 * Usage:
 *   node tools/scripts/check-rls-uuid-cast.mjs
 *   node tools/scripts/check-rls-uuid-cast.mjs --live --require-live
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** db/sql files at or below this number predate the gate (see header). */
export const STATIC_BASELINE = 240;

const TENANT_GUC_RE = /app\.(?:current_)?tenant_id|\bapp_tenant_id\s*\(\s*\)/i;
const UUID_CAST_RE = /::\s*uuid\b|\bas\s+uuid\b/i;

/**
 * True when a policy expression reads the tenant GUC and casts something to
 * uuid. Both halves are required so unrelated uuid literals stay legal.
 * @param {string} expr
 */
export function castsTenantGucToUuid(expr) {
  if (!expr) return false;
  return TENANT_GUC_RE.test(expr) && UUID_CAST_RE.test(expr);
}

/** Strip `--` line comments so commented-out examples do not trip the scan. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Policy statements (CREATE POLICY / ALTER POLICY up to the next `;`) whose
 * text casts the tenant GUC to uuid.
 * @param {string} sql
 * @returns {string[]} offending statement heads
 */
export function findStaticViolations(sql) {
  const body = stripLineComments(sql);
  const out = [];
  const re = /\b(?:CREATE|ALTER)\s+POLICY\b[^;]*;/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (castsTenantGucToUuid(m[0])) {
      out.push(m[0].replace(/\s+/g, ' ').slice(0, 160));
    }
  }
  return out;
}

/** @param {string} root */
export function listGatedSqlFiles(root, baseline = STATIC_BASELINE) {
  const dir = join(root, 'db/sql');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => {
      const n = Number.parseInt(f.slice(0, 3), 10);
      return Number.isFinite(n) && n > baseline;
    })
    .sort()
    .map((f) => join(dir, f));
}

export const LIVE_POLICY_QUERY = `SELECT coalesce(json_agg(json_build_object(
  'schema', schemaname, 'table', tablename, 'policy', policyname,
  'qual', qual, 'withCheck', with_check) ORDER BY schemaname, tablename, policyname), '[]')
  FROM pg_policies`;

/** @param {{ databaseUrl: string }} input */
export function queryLivePolicies({ databaseUrl }) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', LIVE_POLICY_QUERY],
    { encoding: 'utf8' },
  );
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    error: result.error ? String(result.error.message ?? result.error) : '',
  };
}

/**
 * @param {Array<{schema: string, table: string, policy: string, qual: string|null, withCheck: string|null}>} policies
 * @returns {string[]}
 */
export function findLiveViolations(policies) {
  return policies
    .filter((p) => castsTenantGucToUuid(`${p.qual ?? ''} ${p.withCheck ?? ''}`))
    .map((p) => `${p.schema}.${p.table} policy ${p.policy}`);
}

/**
 * @param {{
 *   root: string,
 *   live?: boolean,
 *   requireLive?: boolean,
 *   databaseUrl?: string,
 *   queryLive?: typeof queryLivePolicies,
 *   readFile?: (path: string) => string,
 * }} input
 */
export function evaluateRlsUuidCast({
  root,
  live = false,
  requireLive = false,
  databaseUrl = process.env.MIGRATOR_DATABASE_URL || process.env.DATABASE_URL || '',
  queryLive = queryLivePolicies,
  readFile = (p) => readFileSync(p, 'utf8'),
}) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  for (const file of listGatedSqlFiles(root)) {
    for (const v of findStaticViolations(readFile(file))) {
      failures.push(`${file.slice(root.length + 1)}: policy casts the tenant GUC to uuid: ${v}`);
    }
  }

  if (requireLive && !live) failures.push('--require-live was set without --live');
  if (live) {
    if (!databaseUrl) {
      if (requireLive) failures.push('--live needs MIGRATOR_DATABASE_URL or DATABASE_URL');
      else notes.push('live catalog check skipped: no database URL');
    } else {
      const result = queryLive({ databaseUrl });
      if (result.status !== 0) {
        failures.push(
          `live pg_policies query failed (exit ${result.status}): ${result.stderr || result.error}`,
        );
      } else {
        let policies;
        try {
          policies = JSON.parse(result.stdout || '[]');
        } catch {
          failures.push(`live pg_policies output is not JSON: ${result.stdout.slice(0, 200)}`);
          policies = [];
        }
        for (const v of findLiveViolations(policies)) {
          failures.push(`live catalog: ${v} casts the tenant GUC to uuid`);
        }
        notes.push(`live catalog: ${policies.length} policies checked`);
      }
    }
  }
  return { failures, notes };
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const live = argv.includes('--live');
  const requireLive = argv.includes('--require-live');
  const { failures, notes } = evaluateRlsUuidCast({ root, live, requireLive });
  for (const n of notes) console.log(`check-rls-uuid-cast: ${n}`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`ERROR: PRC-L294 ${f}`);
    console.error(
      'Compare as text instead: tenant_id::text = app_tenant_id() (or tenant_id = app_tenant_uuid()).',
    );
    return 1;
  }
  console.log('check-rls-uuid-cast: OK (no policy casts the tenant GUC to uuid)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
