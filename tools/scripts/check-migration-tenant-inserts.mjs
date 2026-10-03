#!/usr/bin/env node
/**
 * PRC-M205: numbered schema migrations must not create tenants.
 *
 * Demo/fixture tenants belong in `NNNb_*_seed.sql` files (applied only with APPLY_SEEDS=1).
 * 021a / 071 / 082 / 085 predate this gate and are checksum-ledgered, so they stay on the
 * allowlist; 120_remove_demo_fk_tenant_without_seeds.sql removes their tenant again on
 * databases applied without seeds.
 *
 * Run: node tools/scripts/check-migration-tenant-inserts.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_ALLOWLIST = new Set([
  '021a_strict_fk_prerequisite_tenants.sql',
  '071_cross_domain_fk_constraints.sql',
  '082_repair_strict_tenant_fk_validate.sql',
  '085_cross_domain_fk_staff_ops.sql',
]);

const SEED_FILE = /^[0-9]+b_.*_seed\.sql$/;
const MIGRATION_FILE = /^[0-9]+[a-z]?_.*\.sql$/;
const TENANT_INSERT = /\bINSERT\s+INTO\s+(?:public\.)?"?tenants"?\s*[(\s]/i;

/** Strip `--` line comments and block comments so prose never trips the gate. */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** @returns {string[]} offending migration file names */
export function findTenantInserts(files, allowlist = LEGACY_ALLOWLIST) {
  const offenders = [];
  for (const { name, sql } of files) {
    if (!MIGRATION_FILE.test(name) || SEED_FILE.test(name) || allowlist.has(name)) continue;
    if (TENANT_INSERT.test(stripSqlComments(sql))) offenders.push(name);
  }
  return offenders;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = join(root, 'db/sql');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
  const offenders = findTenantInserts(files);
  if (offenders.length > 0) {
    console.error(
      `PRC-M205: numbered migrations must not INSERT INTO tenants (move demo rows to a NNNb_*_seed.sql file):\n${offenders
        .map((f) => `  - db/sql/${f}`)
        .join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `PRC-M205: ${files.length} db/sql files scanned; no tenant inserts in schema migrations.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
