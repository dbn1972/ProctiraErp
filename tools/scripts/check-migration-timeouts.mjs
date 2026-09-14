#!/usr/bin/env node
/**
 * W1-DATA-17 — Migration lock/statement timeout gate (fail closed).
 *
 * Finding: migration DDL apply paths lacked session lock_timeout /
 * statement_timeout, so ACCESS EXCLUSIVE waits could queue behind app traffic
 * indefinitely. Online-safe rollout also requires documented patterns
 * (CONCURRENTLY, NOT VALID → VALIDATE, no table rewrites without a window).
 *
 * This static gate requires:
 *   1. apply-sql.sh SETs lock_timeout + statement_timeout (via migration-timeouts.sh).
 *   2. prisma-migrate-deploy.sh injects the same timeouts for Prisma migrate.
 *   3. @proctira/database prisma:migrate:deploy invokes the wrapper (not bare prisma).
 *   4. Policy docs exist (audit + db/README online-safe section).
 *
 * Usage:
 *   node tools/scripts/check-migration-timeouts.mjs
 *   node tools/scripts/check-migration-timeouts.mjs --root=/path/to/repo
 *   node tools/scripts/check-migration-timeouts.mjs --json
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLY_SQL_REL = 'tools/scripts/apply-sql.sh';
export const TIMEOUTS_LIB_REL = 'tools/scripts/migration-timeouts.sh';
export const PRISMA_WRAPPER_REL = 'tools/scripts/prisma-migrate-deploy.sh';
export const DATABASE_PKG_REL = 'packages/shared/database/package.json';
export const AUDIT_DOC_REL = 'docs/audits/DATA_W1_DATA_17_TIMEOUTS.md';
export const DB_README_REL = 'db/README.md';

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    applySql: join(root, APPLY_SQL_REL),
    timeoutsLib: join(root, TIMEOUTS_LIB_REL),
    prismaWrapper: join(root, PRISMA_WRAPPER_REL),
    databasePkg: join(root, DATABASE_PKG_REL),
    auditDoc: join(root, AUDIT_DOC_REL),
    dbReadme: join(root, DB_README_REL),
  };
}

/**
 * @param {string} path
 */
function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Shared timeout library contract.
 * @param {string} text
 */
export function timeoutsLibContract(text) {
  const issues = [];
  if (!text) {
    issues.push('migration-timeouts.sh missing');
    return issues;
  }
  if (!/MIGRATION_LOCK_TIMEOUT/.test(text)) {
    issues.push('migration-timeouts.sh must define MIGRATION_LOCK_TIMEOUT');
  }
  if (!/MIGRATION_STATEMENT_TIMEOUT/.test(text)) {
    issues.push('migration-timeouts.sh must define MIGRATION_STATEMENT_TIMEOUT');
  }
  if (!/APPLY_SQL_LOCK_TIMEOUT/.test(text) || !/APPLY_SQL_STATEMENT_TIMEOUT/.test(text)) {
    issues.push('migration-timeouts.sh must expose APPLY_SQL_* timeout aliases');
  }
  if (!/inject_migration_timeout_url/.test(text)) {
    issues.push('migration-timeouts.sh must provide inject_migration_timeout_url');
  }
  if (!/export_migration_timeout_pgoptions/.test(text)) {
    issues.push('migration-timeouts.sh must provide export_migration_timeout_pgoptions');
  }
  return issues;
}

/**
 * apply-sql.sh must source the lib and SET both timeouts on every session.
 * @param {string} text
 */
export function applySqlTimeoutContract(text) {
  const issues = [];
  if (!text) {
    issues.push('apply-sql.sh missing');
    return issues;
  }
  if (!/W1-DATA-17/.test(text)) {
    issues.push('apply-sql.sh must reference W1-DATA-17');
  }
  if (!/migration-timeouts\.sh/.test(text)) {
    issues.push('apply-sql.sh must source migration-timeouts.sh');
  }
  if (!/SET lock_timeout TO/.test(text)) {
    issues.push('apply-sql.sh must SET lock_timeout on psql sessions');
  }
  if (!/SET statement_timeout TO/.test(text)) {
    issues.push('apply-sql.sh must SET statement_timeout on psql sessions');
  }
  if (!/APPLY_SQL_LOCK_TIMEOUT/.test(text) || !/APPLY_SQL_STATEMENT_TIMEOUT/.test(text)) {
    issues.push('apply-sql.sh must honor APPLY_SQL_LOCK_TIMEOUT / APPLY_SQL_STATEMENT_TIMEOUT');
  }
  return issues;
}

/**
 * Prisma wrapper must inject timeouts before migrate deploy.
 * @param {string} text
 */
export function prismaWrapperContract(text) {
  const issues = [];
  if (!text) {
    issues.push('prisma-migrate-deploy.sh missing');
    return issues;
  }
  if (!/W1-DATA-17/.test(text)) {
    issues.push('prisma-migrate-deploy.sh must reference W1-DATA-17');
  }
  if (!/migration-timeouts\.sh/.test(text)) {
    issues.push('prisma-migrate-deploy.sh must source migration-timeouts.sh');
  }
  if (!/inject_migration_timeout_url/.test(text)) {
    issues.push('prisma-migrate-deploy.sh must inject URL options for Prisma');
  }
  if (!/migrate deploy/.test(text)) {
    issues.push('prisma-migrate-deploy.sh must run prisma migrate deploy');
  }
  return issues;
}

/**
 * package.json must not call bare `prisma migrate deploy`.
 * @param {string} pkgJsonText
 */
export function databasePackageMigrateContract(pkgJsonText) {
  const issues = [];
  if (!pkgJsonText) {
    issues.push('packages/shared/database/package.json missing');
    return issues;
  }
  /** @type {{ scripts?: Record<string, string> }} */
  let pkg;
  try {
    pkg = JSON.parse(pkgJsonText);
  } catch {
    issues.push('packages/shared/database/package.json is not valid JSON');
    return issues;
  }
  const script = pkg.scripts?.['prisma:migrate:deploy'] ?? '';
  if (!script) {
    issues.push('prisma:migrate:deploy script missing');
    return issues;
  }
  if (!/prisma-migrate-deploy\.sh/.test(script)) {
    issues.push(
      'prisma:migrate:deploy must invoke tools/scripts/prisma-migrate-deploy.sh (not bare prisma)',
    );
  }
  if (/^prisma\s+migrate\s+deploy\b/.test(script.trim())) {
    issues.push('prisma:migrate:deploy must not be bare `prisma migrate deploy`');
  }
  return issues;
}

/**
 * Policy docs must name timeouts and online-safe patterns.
 * @param {string} auditText
 * @param {string} readmeText
 */
export function policyDocContract(auditText, readmeText) {
  const issues = [];
  if (!auditText) {
    issues.push(`${AUDIT_DOC_REL} missing`);
  } else {
    if (!/lock_timeout/i.test(auditText) || !/statement_timeout/i.test(auditText)) {
      issues.push('audit doc must document lock_timeout and statement_timeout');
    }
    if (!/CONCURRENTLY/i.test(auditText) || !/NOT VALID/i.test(auditText)) {
      issues.push('audit doc must document online-safe DDL patterns (CONCURRENTLY, NOT VALID)');
    }
  }
  if (!readmeText) {
    issues.push(`${DB_README_REL} missing`);
  } else if (!/W1-DATA-17/.test(readmeText)) {
    issues.push('db/README.md must document W1-DATA-17 migration timeouts');
  } else if (!/lock_timeout/i.test(readmeText) || !/online-safe|online safe|CONCURRENTLY/i.test(readmeText)) {
    issues.push('db/README.md W1-DATA-17 section must cover timeouts and online-safe patterns');
  }
  return issues;
}

/**
 * @param {string} root
 * @param {ReturnType<typeof defaultPaths>} [paths]
 */
export function evaluateMigrationTimeouts(root, paths = defaultPaths(root)) {
  /** @type {string[]} */
  const issues = [];
  issues.push(...timeoutsLibContract(readText(paths.timeoutsLib)));
  issues.push(...applySqlTimeoutContract(readText(paths.applySql)));
  issues.push(...prismaWrapperContract(readText(paths.prismaWrapper)));
  issues.push(...databasePackageMigrateContract(readText(paths.databasePkg)));
  issues.push(...policyDocContract(readText(paths.auditDoc), readText(paths.dbReadme)));
  return {
    ok: issues.length === 0,
    issues,
  };
}

function parseArgs(argv) {
  let root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
  }
  return { root, json };
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));
  const report = evaluateMigrationTimeouts(root);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log('W1-DATA-17 migration timeouts: PASS');
  } else {
    console.error('W1-DATA-17 migration timeouts: FAIL');
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
