#!/usr/bin/env node
/**
 * F-D1 / F-D2 — read-only detection report for scholarship nettings that credited less
 * than the disbursement amount (₹0 credit on ad-hoc/plan invoices, excess over the invoice
 * dropped, legacy "credit reserved" rows that never reached an invoice).
 *
 * The query lives in fees-scholarship-netting-report.sql. This runner opens a
 * `BEGIN READ ONLY` transaction, binds the tenant GUC when --tenant is given (RLS), runs
 * the query, prints the rows and rolls back. It never writes; it does not correct data.
 * Remediation: docs/runbooks/fees-scholarship-netting-remediation.md.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node tools/scripts/fees-scholarship-netting-report.mjs \
 *     --tenant=<tenant uuid> [--format=table|json|csv]
 *   # Every tenant at once needs a read-only role that bypasses RLS:
 *   DATABASE_URL=… node tools/scripts/fees-scholarship-netting-report.mjs --all-tenants
 *
 * Env: DATABASE_URL (connection string; never printed).
 * Exit: 0 = no affected disbursements, 3 = affected rows listed, 1 = error, 2 = usage.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPORT_SQL_PATH = join(HERE, 'fees-scholarship-netting-report.sql');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REPORT_COLUMNS = [
  'tenant_id',
  'disbursement_id',
  'student_id',
  'disbursement_status',
  'expected_credit_cents',
  'recorded_credit_cents',
  'applied_credit_cents',
  'reserved_cents',
  'uncredited_cents',
  'remaining_cents',
  'reversal_overstated_cents',
  'netting_rows',
  'invoice_ids',
  'findings',
];

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ tenant: string | null, allTenants: boolean, format: string }} */
  const out = { tenant: null, allTenants: false, format: 'table' };
  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) out.tenant = arg.slice('--tenant='.length).trim();
    else if (arg === '--all-tenants') out.allTenants = true;
    else if (arg.startsWith('--format=')) out.format = arg.slice('--format='.length).trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.tenant && !UUID.test(out.tenant)) throw new Error('--tenant must be a uuid');
  if (out.tenant) out.tenant = out.tenant.toLowerCase();
  if (!out.tenant && !out.allTenants) throw new Error('pass --tenant=<uuid> or --all-tenants');
  if (out.tenant && out.allTenants) throw new Error('--tenant and --all-tenants are exclusive');
  if (!['table', 'json', 'csv'].includes(out.format)) throw new Error('--format: table|json|csv');
  return out;
}

export function loadReportSql() {
  return readFileSync(REPORT_SQL_PATH, 'utf8');
}

/**
 * Run the report on an open client inside a READ ONLY transaction that is always rolled back.
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }} client
 * @param {string | null} tenantId
 */
export async function runReport(client, tenantId) {
  await client.query('BEGIN READ ONLY');
  try {
    if (tenantId) {
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
    }
    const { rows } = await client.query(loadReportSql(), [tenantId]);
    return rows.map(normalizeRow);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

/** @param {Record<string, unknown>} row */
function normalizeRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const column of REPORT_COLUMNS) {
    const value = row[column];
    out[column] =
      column.endsWith('_cents') || column === 'netting_rows'
        ? value == null
          ? null
          : Number(value)
        : value == null
          ? null
          : String(value);
  }
  return out;
}

/** @param {Record<string, unknown>[]} rows @param {string} format */
export function formatRows(rows, format) {
  if (format === 'json') return JSON.stringify(rows, null, 2);
  if (format === 'csv') {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      REPORT_COLUMNS.join(','),
      ...rows.map((r) => REPORT_COLUMNS.map((c) => esc(r[c])).join(',')),
    ].join('\n');
  }
  if (rows.length === 0) return 'No affected scholarship disbursements.';
  return rows
    .map((r) => REPORT_COLUMNS.map((c) => `${c.padEnd(26)} ${r[c] == null ? '' : r[c]}`).join('\n'))
    .join('\n\n');
}

function loadPg() {
  const require = createRequire(import.meta.url);
  try {
    return require('pg');
  } catch {
    return require(join(HERE, '../../packages/shared/database/node_modules/pg'));
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    console.error('error: DATABASE_URL is not set');
    return 2;
  }
  const pg = loadPg();
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const rows = await runReport(client, args.tenant);
    console.log(formatRows(rows, args.format));
    return rows.length > 0 ? 3 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
