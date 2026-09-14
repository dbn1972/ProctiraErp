#!/usr/bin/env node
/**
 * W1-DATA-16 — Leading tenant_id index invariant (fail closed).
 *
 * Finding: tenant-scoped tables could ship without a btree index (or UNIQUE/PK)
 * whose **first** column is `tenant_id`. RLS and service filters almost always
 * predicate on tenant_id first; a composite index that buries tenant_id (or an
 * index that omits it) does not satisfy the invariant.
 *
 * This static gate scans numbered `db/sql/` plus Prisma migration SQL and
 * fails when any table that declares a `tenant_id` column lacks leading
 * coverage — unless the table is listed in
 * `tools/scripts/tenant-id-index-allowlist.json` with a documented reason.
 *
 * Usage:
 *   node tools/scripts/check-tenant-id-indexes.mjs
 *   node tools/scripts/check-tenant-id-indexes.mjs --root=/path/to/repo
 *   node tools/scripts/check-tenant-id-indexes.mjs --json
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWLIST_REL = 'tools/scripts/tenant-id-index-allowlist.json';
export const SQL_FIX_HINT = '071_tenant_id_leading_indexes.sql';

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    sqlDir: join(root, 'db/sql'),
    prismaMigrations: join(root, 'packages/shared/database/prisma/migrations'),
    allowlistPath: join(root, ALLOWLIST_REL),
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
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isFile())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkSqlFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkSqlFiles(abs));
    else if (st.isFile() && name.endsWith('.sql')) out.push(abs);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @param {string} root
 * @param {ReturnType<typeof defaultPaths>} paths
 */
export function collectSqlCorpus(root, paths = defaultPaths(root)) {
  const files = [...listNumberedSql(paths.sqlDir), ...walkSqlFiles(paths.prismaMigrations)];
  return {
    files: files.map((abs) => relative(root, abs).replace(/\\/g, '/')),
    text: files.map((abs) => readFileSync(abs, 'utf8')).join('\n\n'),
  };
}

/**
 * @param {string} allowlistPath
 * @returns {{ table: string, reason: string }[]}
 */
export function loadAllowlist(allowlistPath) {
  if (!existsSync(allowlistPath)) {
    throw new Error(`missing allowlist at ${allowlistPath}`);
  }
  const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const entries = Array.isArray(raw?.allowlist) ? raw.allowlist : [];
  /** @type {{ table: string, reason: string }[]} */
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('allowlist entries must be objects with table + reason');
    }
    const table = String(entry.table ?? '')
      .trim()
      .toLowerCase();
    const reason = String(entry.reason ?? '').trim();
    if (!table) throw new Error('allowlist entry missing table');
    if (!reason) throw new Error(`allowlist entry for ${table} missing reason`);
    out.push({ table, reason });
  }
  return out;
}

/**
 * Tables that declare a tenant_id column via CREATE TABLE or ADD COLUMN.
 * @param {string} sqlText
 * @returns {Set<string>}
 */
export function extractTenantScopedTables(sqlText) {
  const tables = new Set();

  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = createRe.exec(sqlText)) !== null) {
    const name = match[1].toLowerCase();
    const body = match[2];
    if (/(?:^|,|\n)\s*"?tenant_id"?\s+/i.test(body)) {
      tables.add(name);
    }
  }

  const alterRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?tenant_id"?\b/gi;
  while ((match = alterRe.exec(sqlText)) !== null) {
    tables.add(match[1].toLowerCase());
  }

  return tables;
}

/**
 * Tables with a leading tenant_id btree index, UNIQUE, or PRIMARY KEY.
 * Non-leading composites (e.g. (collection, tenant_id)) do **not** count.
 * @param {string} sqlText
 * @returns {Set<string>}
 */
export function extractLeadingTenantIdCoverage(sqlText) {
  const covered = new Set();

  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = createRe.exec(sqlText)) !== null) {
    const name = match[1].toLowerCase();
    const body = match[2];
    if (/(?:PRIMARY\s+KEY|UNIQUE)\s*\(\s*"?tenant_id"?\b/i.test(body)) {
      covered.add(name);
    }
    if (/"?tenant_id"?\b[^,\n]*\bPRIMARY\s+KEY\b/i.test(body)) {
      covered.add(name);
    }
  }

  const indexRe =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["\w]+\s+ON\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(\s*"?tenant_id"?\b/gi;
  while ((match = indexRe.exec(sqlText)) !== null) {
    covered.add(match[1].toLowerCase());
  }

  // Dynamic loops: FOREACH t IN ARRAY ARRAY['a','b'] … CREATE INDEX … (tenant_id)
  const dynRe =
    /FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([^\]]+)\]([\s\S]{0,800}?)(?=FOREACH\s+\w+\s+IN\s+ARRAY|INSERT\s+INTO\s+schema_migrations|$)/gi;
  while ((match = dynRe.exec(sqlText)) !== null) {
    const block = match[2] ?? '';
    if (!/\(tenant_id\)/i.test(block) && !/\(\s*tenant_id\b/i.test(block)) continue;
    if (!/CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(block)) continue;
    for (const nameMatch of match[1].matchAll(/'([^']+)'/g)) {
      covered.add(nameMatch[1].toLowerCase());
    }
  }

  const alterConstRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?[\s\S]{0,240}?(?:ADD\s+(?:CONSTRAINT\s+\w+\s+)?)?(?:UNIQUE|PRIMARY\s+KEY)\s*\(\s*"?tenant_id"?\b/gi;
  while ((match = alterConstRe.exec(sqlText)) !== null) {
    covered.add(match[1].toLowerCase());
  }

  return covered;
}

/**
 * @param {{
 *   root: string,
 *   paths?: ReturnType<typeof defaultPaths>,
 *   sqlText?: string,
 *   allowlist?: { table: string, reason: string }[],
 * }} input
 */
export function evaluateTenantIdIndexes({
  root,
  paths = defaultPaths(root),
  sqlText,
  allowlist,
}) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  const corpus = sqlText == null ? collectSqlCorpus(root, paths) : { files: ['(inline)'], text: sqlText };
  const allow =
    allowlist ??
    (() => {
      try {
        return loadAllowlist(paths.allowlistPath);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
        return [];
      }
    })();

  const tenantTables = extractTenantScopedTables(corpus.text);
  const covered = extractLeadingTenantIdCoverage(corpus.text);
  const allowSet = new Set(allow.map((e) => e.table));

  for (const entry of allow) {
    if (!tenantTables.has(entry.table)) {
      notes.push(
        `allowlist entry "${entry.table}" has no tenant_id column in scanned SQL (stale?) — reason: ${entry.reason}`,
      );
    } else if (covered.has(entry.table)) {
      notes.push(
        `allowlist entry "${entry.table}" already has leading tenant_id coverage — consider removing — reason: ${entry.reason}`,
      );
    } else {
      notes.push(`allowlisted: ${entry.table} — ${entry.reason}`);
    }
  }

  /** @type {string[]} */
  const missing = [];
  for (const table of [...tenantTables].sort()) {
    if (covered.has(table)) continue;
    if (allowSet.has(table)) continue;
    missing.push(table);
  }

  if (missing.length) {
    failures.push(
      `tenant-scoped tables missing leading tenant_id index/UNIQUE/PK (${missing.length}): ${missing.join(', ')} ` +
        `(add CREATE INDEX … (tenant_id[, …]) e.g. via db/sql/${SQL_FIX_HINT}, or document in ${ALLOWLIST_REL})`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    notes,
    tenantTableCount: tenantTables.size,
    coveredCount: [...tenantTables].filter((t) => covered.has(t) || allowSet.has(t)).length,
    missing,
    allowlistCount: allow.length,
    sqlFileCount: corpus.files.length,
  };
}

function formatReport(report) {
  const lines = ['## Leading tenant_id index gate (W1-DATA-16)', ''];
  if (report.ok) {
    lines.push(
      `**Status:** pass — ${report.coveredCount}/${report.tenantTableCount} tenant-scoped tables have leading tenant_id coverage` +
        (report.allowlistCount ? ` (${report.allowlistCount} allowlisted)` : '') +
        '.',
    );
  } else {
    lines.push('**Status:** fail — tenant_id index residual remains.');
  }
  lines.push('');
  lines.push(`SQL files scanned: ${report.sqlFileCount}`);
  lines.push('');
  if (report.failures.length) {
    lines.push('### Failures');
    for (const f of report.failures) lines.push(`- ${f}`);
    lines.push('');
  }
  if (report.missing.length) {
    lines.push('### Missing (not allowlisted)');
    for (const t of report.missing) lines.push(`- \`${t}\``);
    lines.push('');
  }
  if (report.notes.length) {
    lines.push('### Notes');
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  return lines.join('\n');
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
  const report = evaluateTenantIdIndexes({ root });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
