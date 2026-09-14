#!/usr/bin/env node
/**
 * W1-DATA-01 — Prove the *actual* runtime DATABASE_URL is a non-owner role.
 *
 * PostgreSQL table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.
 * Production pods must therefore connect as proctira_app (or equivalent):
 *   - NOSUPERUSER
 *   - NOBYPASSRLS
 *   - owns zero application tables in schema public
 *   - is not a member of any role that owns application tables
 *
 * Fail-closed: when RUNTIME_ROLE_GATE_REQUIRED=1 (or ENVIRONMENT=production),
 * a missing/empty DATABASE_URL exits non-zero.
 *
 * Usage:
 *   DATABASE_URL=postgresql://proctira_app:…@host/db \
 *     node tools/scripts/assert-runtime-database-role.mjs
 *
 *   RUNTIME_ROLE_GATE_REQUIRED=1 node tools/scripts/assert-runtime-database-role.mjs
 *
 * Env:
 *   DATABASE_URL                 Runtime connection string (required when gate required)
 *   RUNTIME_ROLE_GATE_REQUIRED   1/true → fail if URL unset or probe fails
 *   ENVIRONMENT / GITHUB_ENV     production → gate required
 *   RUNTIME_ROLE_EXPECTED        Default: proctira_app (set empty to skip name check)
 *   RUNTIME_ROLE_JSON            1 → print JSON result
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * @param {string | undefined} value
 */
export function truthy(value) {
  return TRUTHY.has(String(value ?? '').toLowerCase());
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isRuntimeRoleGateRequired(env = process.env) {
  if (truthy(env.RUNTIME_ROLE_GATE_REQUIRED)) return true;
  const environment = String(env.ENVIRONMENT ?? env.GITHUB_ENV ?? '').toLowerCase();
  return environment === 'production';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveExpectedRole(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'RUNTIME_ROLE_EXPECTED')) {
    const raw = env.RUNTIME_ROLE_EXPECTED;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).trim();
  }
  return 'proctira_app';
}

/**
 * Pure evaluation of a live probe row.
 * @param {{
 *   currentUser: string,
 *   rolsuper: boolean,
 *   rolbypassrls: boolean,
 *   ownedTableCount: number,
 *   ownerRoleMember: boolean,
 * }} row
 * @param {{ expectedRole?: string | null }} [opts]
 * @returns {string[]}
 */
export function evaluateRuntimeRoleProbe(row, opts = {}) {
  const issues = [];
  const expectedRole =
    opts.expectedRole === undefined ? 'proctira_app' : opts.expectedRole;

  if (!row.currentUser) {
    issues.push('current_user is empty');
  }
  if (row.rolsuper) {
    issues.push(`role ${row.currentUser} is superuser (rolsuper)`);
  }
  if (row.rolbypassrls) {
    issues.push(`role ${row.currentUser} has BYPASSRLS`);
  }
  if (Number(row.ownedTableCount) > 0) {
    issues.push(
      `role ${row.currentUser} owns ${row.ownedTableCount} application table(s) in schema public`,
    );
  }
  if (row.ownerRoleMember) {
    issues.push(
      `role ${row.currentUser} is a member of a role that owns application tables`,
    );
  }
  if (expectedRole && row.currentUser !== expectedRole) {
    issues.push(
      `current_user is ${row.currentUser}, expected runtime role ${expectedRole}`,
    );
  }
  return issues;
}

export const RUNTIME_ROLE_PROBE_SQL = `
SELECT
  current_user AS current_user,
  (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS rolsuper,
  (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) AS rolbypassrls,
  (
    SELECT count(*)::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) AS owned_table_count,
  EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles parent ON parent.oid = m.roleid
    WHERE member.rolname = current_user
      AND parent.oid IN (
        SELECT DISTINCT c.relowner
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      )
  ) AS owner_role_member
`.trim();

/**
 * @param {unknown} value
 */
function asBool(value) {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeProbeRow(raw) {
  return {
    currentUser: String(raw.current_user ?? raw.currentUser ?? ''),
    rolsuper: asBool(raw.rolsuper),
    rolbypassrls: asBool(raw.rolbypassrls),
    ownedTableCount: Number(raw.owned_table_count ?? raw.ownedTableCount ?? 0),
    ownerRoleMember: asBool(raw.owner_role_member ?? raw.ownerRoleMember),
  };
}

/**
 * @param {string} databaseUrl
 * @returns {Promise<ReturnType<typeof normalizeProbeRow>>}
 */
export async function probeRuntimeRole(databaseUrl) {
  const require = createRequire(import.meta.url);
  /** @type {typeof import('pg')} */
  let pg;
  try {
    pg = require('pg');
  } catch {
    // Prefer workspace package dependency when root node_modules lacks pg.
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    pg = require(join(root, 'packages/shared/database/node_modules/pg'));
  }

  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const { rows } = await client.query(RUNTIME_ROLE_PROBE_SQL);
    if (!rows[0]) {
      throw new Error('probe returned no rows');
    }
    return normalizeProbeRow(rows[0]);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function runRuntimeRoleGate(env = process.env) {
  const required = isRuntimeRoleGateRequired(env);
  const databaseUrl = String(env.DATABASE_URL ?? '').trim();
  const expectedRole = resolveExpectedRole(env);

  if (!databaseUrl) {
    if (required) {
      return {
        ok: false,
        required: true,
        issues: [
          'DATABASE_URL unset — W1-DATA-01 runtime role gate fails closed in production / when RUNTIME_ROLE_GATE_REQUIRED=1',
        ],
        row: null,
      };
    }
    return {
      ok: true,
      required: false,
      skipped: true,
      issues: [],
      row: null,
      message: 'DATABASE_URL unset — advisory skip (gate not required)',
    };
  }

  const row = await probeRuntimeRole(databaseUrl);
  const issues = evaluateRuntimeRoleProbe(row, { expectedRole });
  return {
    ok: issues.length === 0,
    required,
    skipped: false,
    issues,
    row,
    expectedRole,
  };
}

async function main() {
  const result = await runRuntimeRoleGate(process.env);
  if (truthy(process.env.RUNTIME_ROLE_JSON)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.skipped) {
    console.log(`assert-runtime-database-role: SKIP — ${result.message}`);
  } else if (result.ok) {
    console.log(
      `assert-runtime-database-role: PASS — ${result.row?.currentUser} is NOSUPERUSER NOBYPASSRLS, owns 0 public tables, not owner-role member`,
    );
  } else {
    console.error('assert-runtime-database-role: FAIL');
    for (const issue of result.issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

const isDirect =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirect) {
  main().catch((err) => {
    console.error(`assert-runtime-database-role: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
