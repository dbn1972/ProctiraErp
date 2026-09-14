#!/usr/bin/env node
/**
 * W1-DATA-17 — Migration lock/statement timeout + online DDL hazard gate (fail closed).
 *
 * Finding: migration DDL apply paths lacked session lock_timeout /
 * statement_timeout, so ACCESS EXCLUSIVE waits could queue behind app traffic
 * indefinitely. Online-safe rollout also requires documented patterns
 * (CONCURRENTLY, NOT VALID → VALIDATE, no table rewrites without a window).
 *
 * PARTIAL residual (COMPLETE closes it):
 *   - CI only checked wrappers, not DDL for long-lock ops.
 *   - Retry/resume after lock failure was unproven.
 *
 * This static gate requires:
 *   1. apply-sql.sh SETs lock_timeout + statement_timeout (via migration-timeouts.sh).
 *   2. prisma-migrate-deploy.sh injects the same timeouts for Prisma migrate.
 *   3. @proctira/database prisma:migrate:deploy invokes the wrapper (not bare prisma).
 *   4. Policy docs exist (timeouts audit + COMPLETE audit + db/README).
 *   5. New migrations (after baseline cutover) pass expand/contract DDL hazard
 *      scan, or carry an approved maintenance-window waiver.
 *   6. Lock-contention recovery drill artifact + apply-sql recovery contract exist.
 *
 * Usage:
 *   node tools/scripts/check-migration-timeouts.mjs
 *   node tools/scripts/check-migration-timeouts.mjs --root=/path/to/repo
 *   node tools/scripts/check-migration-timeouts.mjs --json
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLY_SQL_REL = 'tools/scripts/apply-sql.sh';
export const TIMEOUTS_LIB_REL = 'tools/scripts/migration-timeouts.sh';
export const PRISMA_WRAPPER_REL = 'tools/scripts/prisma-migrate-deploy.sh';
export const DATABASE_PKG_REL = 'packages/shared/database/package.json';
export const AUDIT_DOC_REL = 'docs/audits/DATA_W1_DATA_17_TIMEOUTS.md';
export const COMPLETE_AUDIT_REL = 'docs/audits/DATA_W1_DATA_17_COMPLETE.md';
export const DB_README_REL = 'db/README.md';
export const WAIVER_REL = 'tools/scripts/migration-ddl-hazard-waiver.json';
export const LOCK_DRILL_REL = 'tools/scripts/migration-lock-recovery-drill.mjs';
export const SQL_DIR_REL = 'db/sql';
export const PRISMA_MIGRATIONS_REL = 'packages/shared/database/prisma/migrations';

/** @typedef {'blocking_index'|'validating_constraint'|'blocking_unique_or_pk'|'set_not_null'|'column_type_rewrite'} HazardKind */

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
    completeAudit: join(root, COMPLETE_AUDIT_REL),
    dbReadme: join(root, DB_README_REL),
    waiver: join(root, WAIVER_REL),
    lockDrill: join(root, LOCK_DRILL_REL),
    sqlDir: join(root, SQL_DIR_REL),
    prismaMigrations: join(root, PRISMA_MIGRATIONS_REL),
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
 * apply-sql must document lock-failure resume (ledger-safe re-run).
 * @param {string} text
 */
export function applySqlLockRecoveryContract(text) {
  const issues = [];
  if (!text) {
    issues.push('apply-sql.sh missing (lock recovery contract)');
    return issues;
  }
  if (!/lock_timeout|lock_not_available|W1-DATA-17.*recover|recover.*lock/i.test(text)) {
    issues.push('apply-sql.sh must document lock_timeout / lock_not_available recovery guidance');
  }
  if (!/--single-transaction/.test(text)) {
    issues.push('apply-sql.sh must use per-file --single-transaction so lock failure does not ledger-write');
  }
  if (!/schema_migrations/.test(text)) {
    issues.push('apply-sql.sh must record schema_migrations only after successful apply');
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
 * Policy docs must name timeouts, online-safe patterns, and COMPLETE residual closure.
 * @param {string} auditText
 * @param {string} readmeText
 * @param {string} [completeText]
 */
export function policyDocContract(auditText, readmeText, completeText = '') {
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
  if (!completeText) {
    issues.push(`${COMPLETE_AUDIT_REL} missing`);
  } else {
    if (!/COMPLETE|PARTIAL/i.test(completeText)) {
      issues.push('COMPLETE audit must state PARTIAL→COMPLETE closure');
    }
    if (!/hazard|expand.?contract|maintenance.?window/i.test(completeText)) {
      issues.push('COMPLETE audit must document DDL hazard / expand-contract / waiver posture');
    }
    if (!/lock.?contention|recovery.?drill|resume/i.test(completeText)) {
      issues.push('COMPLETE audit must document lock-contention recovery drill');
    }
  }
  if (!readmeText) {
    issues.push(`${DB_README_REL} missing`);
  } else if (!/W1-DATA-17/.test(readmeText)) {
    issues.push('db/README.md must document W1-DATA-17 migration timeouts');
  } else if (!/lock_timeout/i.test(readmeText) || !/online-safe|online safe|CONCURRENTLY/i.test(readmeText)) {
    issues.push('db/README.md W1-DATA-17 section must cover timeouts and online-safe patterns');
  } else if (!/DDL hazard|hazard waiver|expand.?contract/i.test(readmeText)) {
    issues.push('db/README.md W1-DATA-17 section must cover DDL hazard gate / waiver');
  }
  return issues;
}

/**
 * Lock recovery drill artifact must exist and mention ledger resume.
 * @param {string} text
 */
export function lockRecoveryDrillContract(text) {
  const issues = [];
  if (!text) {
    issues.push(`${LOCK_DRILL_REL} missing`);
    return issues;
  }
  if (!/W1-DATA-17/.test(text)) {
    issues.push('lock recovery drill must reference W1-DATA-17');
  }
  if (!/ACCESS EXCLUSIVE|lock_timeout|lock_not_available/i.test(text)) {
    issues.push('lock recovery drill must contend with ACCESS EXCLUSIVE / lock_timeout');
  }
  if (!/schema_migrations/.test(text)) {
    issues.push('lock recovery drill must assert schema_migrations resume safety');
  }
  if (!/runLockRecoveryDrill|resume/i.test(text)) {
    issues.push('lock recovery drill must export/run a resume path after unlock');
  }
  return issues;
}

/**
 * Strip SQL line/block comments for hazard scanning.
 * @param {string} sql
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Tables created in this file (empty/new → blocking indexes/constraints OK).
 * @param {string} sql
 * @returns {Set<string>}
 */
export function extractCreatedTables(sql) {
  const cleaned = stripSqlComments(sql);
  const tables = new Set();
  const re =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    tables.add(m[1].toLowerCase());
  }
  return tables;
}

/**
 * @param {string} sql
 * @returns {{ kind: HazardKind, detail: string, table?: string }[]}
 */
export function findDdlHazards(sql) {
  const cleaned = stripSqlComments(sql);
  const created = extractCreatedTables(cleaned);
  /** @type {{ kind: HazardKind, detail: string, table?: string }[]} */
  const hazards = [];

  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON [ONLY] table — without CONCURRENTLY
  const indexRe =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w]+"?\s+)?ON\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let m;
  while ((m = indexRe.exec(cleaned)) !== null) {
    const table = m[2].toLowerCase();
    if (created.has(table)) continue;
    hazards.push({
      kind: 'blocking_index',
      table,
      detail: `CREATE INDEX without CONCURRENTLY on existing table "${table}" (use CONCURRENTLY outside a transaction, or waive for a maintenance window)`,
    });
  }

  // ALTER TABLE … ADD CONSTRAINT … without NOT VALID (FK / CHECK)
  const addConstraintRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ADD\s+CONSTRAINT\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?\s+([\s\S]*?)(?=;)/gi;
  while ((m = addConstraintRe.exec(cleaned)) !== null) {
    const table = m[1].toLowerCase();
    const body = m[2];
    if (created.has(table)) continue;
    const isFkOrCheck = /\bFOREIGN\s+KEY\b|\bCHECK\s*\(/i.test(body);
    const isUniqueOrPk = /\bUNIQUE\b|\bPRIMARY\s+KEY\b|\bEXCLUDE\b/i.test(body);
    const hasNotValid = /\bNOT\s+VALID\b/i.test(body);
    if (isFkOrCheck && !hasNotValid) {
      hazards.push({
        kind: 'validating_constraint',
        table,
        detail: `ADD CONSTRAINT FK/CHECK on "${table}" without NOT VALID (prefer NOT VALID then VALIDATE CONSTRAINT)`,
      });
    } else if (isUniqueOrPk) {
      hazards.push({
        kind: 'blocking_unique_or_pk',
        table,
        detail: `ADD CONSTRAINT UNIQUE/PK/EXCLUDE on existing table "${table}" (requires maintenance window or new-table-only)`,
      });
    }
  }

  // ALTER TABLE … SET NOT NULL
  const notNullRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?[\s\S]*?\bALTER\s+COLUMN\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?\s+SET\s+NOT\s+NULL\b/gi;
  while ((m = notNullRe.exec(cleaned)) !== null) {
    const table = m[1].toLowerCase();
    if (created.has(table)) continue;
    hazards.push({
      kind: 'set_not_null',
      table,
      detail: `SET NOT NULL on existing table "${table}" (expand: backfill then separate not-null; or maintenance-window waiver)`,
    });
  }

  // Shorthand: ALTER TABLE t ALTER COLUMN c SET NOT NULL (single statement forms already covered)
  // Also catch: ALTER TABLE t ALTER c TYPE …
  const typeRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?[\s\S]*?\bALTER\s+(?:COLUMN\s+)?(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+TYPE\b/gi;
  while ((m = typeRe.exec(cleaned)) !== null) {
    const table = m[1].toLowerCase();
    if (created.has(table)) continue;
    hazards.push({
      kind: 'column_type_rewrite',
      table,
      detail: `ALTER COLUMN TYPE on existing table "${table}" (table rewrite — needs maintenance window waiver)`,
    });
  }

  return hazards;
}

/**
 * @param {string} waiverPath
 * @returns {{
 *   baseline: { dbSqlMaxFilename: string, prismaMigrationMaxDir: string, reason?: string },
 *   waivers: { path: string, hazards: string[], reason: string, maintenanceWindow: string, approvedBy?: string, expires?: string }[]
 * }}
 */
export function loadDdlHazardWaiver(waiverPath) {
  if (!existsSync(waiverPath)) {
    throw new Error(`missing DDL hazard waiver at ${waiverPath}`);
  }
  const raw = JSON.parse(readFileSync(waiverPath, 'utf8'));
  const baseline = raw?.baseline ?? {};
  const dbSqlMaxFilename = String(baseline.dbSqlMaxFilename ?? '').trim();
  const prismaMigrationMaxDir = String(baseline.prismaMigrationMaxDir ?? '').trim();
  if (!dbSqlMaxFilename) throw new Error('waiver baseline.dbSqlMaxFilename required');
  if (!prismaMigrationMaxDir) throw new Error('waiver baseline.prismaMigrationMaxDir required');

  const waivers = Array.isArray(raw?.waivers) ? raw.waivers : [];
  /** @type {{ path: string, hazards: string[], reason: string, maintenanceWindow: string, approvedBy?: string, expires?: string }[]} */
  const out = [];
  for (const entry of waivers) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('waiver entries must be objects');
    }
    const path = String(entry.path ?? '')
      .trim()
      .replace(/\\/g, '/');
    const reason = String(entry.reason ?? '').trim();
    const maintenanceWindow = String(entry.maintenanceWindow ?? '').trim();
    const hazards = Array.isArray(entry.hazards)
      ? entry.hazards.map((h) => String(h))
      : [];
    if (!path) throw new Error('waiver entry missing path');
    if (!reason) throw new Error(`waiver entry for ${path} missing reason`);
    if (!maintenanceWindow) {
      throw new Error(`waiver entry for ${path} missing maintenanceWindow`);
    }
    if (!hazards.length) throw new Error(`waiver entry for ${path} missing hazards[]`);
    out.push({
      path,
      hazards,
      reason,
      maintenanceWindow,
      approvedBy: entry.approvedBy ? String(entry.approvedBy) : undefined,
      expires: entry.expires ? String(entry.expires) : undefined,
    });
  }
  return {
    baseline: {
      dbSqlMaxFilename,
      prismaMigrationMaxDir,
      reason: baseline.reason ? String(baseline.reason) : undefined,
    },
    waivers: out,
  };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listNumberedSql(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^[0-9].*\.sql$/i.test(name))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @param {string} dir
 * @returns {{ dirName: string, sqlPath: string }[]}
 */
function listPrismaMigrationSql(dir) {
  if (!existsSync(dir)) return [];
  /** @type {{ dirName: string, sqlPath: string }[]} */
  const out = [];
  for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const abs = join(dir, name);
    if (!statSync(abs).isDirectory()) continue;
    const sqlPath = join(abs, 'migration.sql');
    if (existsSync(sqlPath)) out.push({ dirName: name, sqlPath });
  }
  return out;
}

/**
 * LC_ALL=C string compare — true when candidate is at or before baseline max.
 * @param {string} candidate
 * @param {string} maxInclusive
 */
export function isAtOrBeforeBaseline(candidate, maxInclusive) {
  return candidate <= maxInclusive;
}

/**
 * @param {string} root
 * @param {ReturnType<typeof defaultPaths>} [paths]
 * @param {ReturnType<typeof loadDdlHazardWaiver>} [waiver]
 * @param {Date} [now]
 */
export function evaluateDdlHazards(root, paths = defaultPaths(root), waiver, now = new Date()) {
  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {{ path: string, kind: HazardKind, detail: string }[]} */
  const findings = [];

  let loaded = waiver;
  if (!loaded) {
    try {
      loaded = loadDdlHazardWaiver(paths.waiver);
    } catch (err) {
      return {
        ok: false,
        issues: [err instanceof Error ? err.message : String(err)],
        notes: [],
        findings: [],
        scannedFileCount: 0,
        enforcedFileCount: 0,
      };
    }
  }

  const waiverByPath = new Map(loaded.waivers.map((w) => [w.path, w]));

  /** @type {{ rel: string, abs: string, track: 'db_sql'|'prisma' }[]} */
  const candidates = [];

  for (const name of listNumberedSql(paths.sqlDir)) {
    if (isAtOrBeforeBaseline(name, loaded.baseline.dbSqlMaxFilename)) continue;
    candidates.push({
      rel: `${SQL_DIR_REL}/${name}`,
      abs: join(paths.sqlDir, name),
      track: 'db_sql',
    });
  }

  for (const { dirName, sqlPath } of listPrismaMigrationSql(paths.prismaMigrations)) {
    if (isAtOrBeforeBaseline(dirName, loaded.baseline.prismaMigrationMaxDir)) continue;
    candidates.push({
      rel: relative(root, sqlPath).replace(/\\/g, '/'),
      abs: sqlPath,
      track: 'prisma',
    });
  }

  for (const file of candidates) {
    const sql = readFileSync(file.abs, 'utf8');
    const hazards = findDdlHazards(sql);
    if (!hazards.length) continue;

    const waiverEntry = waiverByPath.get(file.rel);
    for (const h of hazards) {
      findings.push({ path: file.rel, kind: h.kind, detail: h.detail });
      if (waiverEntry) {
        if (waiverEntry.expires) {
          const exp = new Date(waiverEntry.expires);
          if (!Number.isNaN(exp.getTime()) && exp.getTime() < now.getTime()) {
            issues.push(
              `${file.rel}: waived hazard ${h.kind} but waiver expired ${waiverEntry.expires} — ${h.detail}`,
            );
            continue;
          }
        }
        if (!waiverEntry.hazards.includes(h.kind) && !waiverEntry.hazards.includes('*')) {
          issues.push(
            `${file.rel}: hazard ${h.kind} not covered by waiver hazards[] — ${h.detail}`,
          );
          continue;
        }
        notes.push(
          `waived ${h.kind} in ${file.rel} (window ${waiverEntry.maintenanceWindow}): ${waiverEntry.reason}`,
        );
        continue;
      }
      issues.push(`${file.rel}: ${h.detail}`);
    }
  }

  // Stale waiver paths (no longer present / no longer after baseline) are notes only.
  for (const w of loaded.waivers) {
    const abs = join(root, w.path);
    if (!existsSync(abs)) {
      notes.push(`waiver path missing on disk (stale?): ${w.path}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    notes,
    findings,
    scannedFileCount:
      listNumberedSql(paths.sqlDir).length + listPrismaMigrationSql(paths.prismaMigrations).length,
    enforcedFileCount: candidates.length,
  };
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
  issues.push(...applySqlLockRecoveryContract(readText(paths.applySql)));
  issues.push(...prismaWrapperContract(readText(paths.prismaWrapper)));
  issues.push(...databasePackageMigrateContract(readText(paths.databasePkg)));
  issues.push(
    ...policyDocContract(
      readText(paths.auditDoc),
      readText(paths.dbReadme),
      readText(paths.completeAudit),
    ),
  );
  issues.push(...lockRecoveryDrillContract(readText(paths.lockDrill)));

  const ddl = evaluateDdlHazards(root, paths);
  issues.push(...ddl.issues);

  return {
    ok: issues.length === 0,
    issues,
    ddl,
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
    console.log('W1-DATA-17 migration timeouts + DDL hazard gate: PASS');
    if (report.ddl?.enforcedFileCount != null) {
      console.log(
        `  DDL scan: ${report.ddl.enforcedFileCount} post-baseline file(s) enforced ` +
          `(${report.ddl.scannedFileCount} total in corpus)`,
      );
    }
    for (const note of report.ddl?.notes ?? []) {
      console.log(`  note: ${note}`);
    }
  } else {
    console.error('W1-DATA-17 migration timeouts + DDL hazard gate: FAIL');
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
