#!/usr/bin/env node
/**
 * W1-DATA-04 — Prisma ↔ numbered SQL schema drift gate (fail closed).
 *
 * Schema authority (documented in db/README.md, enforced here):
 *   1. Apply order is mandatory: `prisma migrate deploy` THEN `apply-sql.sh`.
 *   2. Prisma migrations own platform tables that ship under
 *      packages/shared/database/prisma/migrations/.
 *   3. Numbered SQL under db/sql/ owns domain schemas AND any Prisma-mapped
 *      tables that lack a Prisma migration (auth session models today).
 *   4. Critical Prisma models (auth sessions) must keep CREATE TABLE + required
 *      columns in db/sql so apply-sql cannot leave durable auth persistence
 *      missing after a fresh Postgres provision.
 *
 * Usage:
 *   node tools/scripts/check-prisma-sql-drift.mjs
 *   node tools/scripts/check-prisma-sql-drift.mjs --root=/path/to/repo
 *   node tools/scripts/check-prisma-sql-drift.mjs --json
 *
 * Exit 0 on pass; exit 1 on drift.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Prisma models that MUST have executable DDL in db/sql (not Prisma-only). */
export const CRITICAL_SQL_BACKED_MODELS = Object.freeze([
  { model: 'RefreshToken', table: 'refresh_tokens' },
  { model: 'UserSession', table: 'user_sessions' },
]);

const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    prismaSchema: join(root, 'packages/shared/database/prisma/schema.prisma'),
    prismaMigrations: join(root, 'packages/shared/database/prisma/migrations'),
    sqlDir: join(root, 'db/sql'),
    applySqlScript: join(root, 'tools/scripts/apply-sql.sh'),
    dbReadme: join(root, 'db/README.md'),
  };
}

/**
 * @param {string} name
 */
export function camelToSnake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Parse Prisma models from schema text.
 * @param {string} schemaText
 * @returns {{ name: string, table: string, columns: string[] }[]}
 */
export function parsePrismaModels(schemaText) {
  const models = [];
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = modelRe.exec(schemaText)) !== null) {
    const name = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const table = mapMatch?.[1] ?? camelToSnake(name);
    const columns = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('///')) {
        continue;
      }
      // Relation-only fields: ModelName or ModelName[] without a scalar type token.
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1];
      const typeName = fieldMatch[2];
      if (!SCALAR_TYPES.has(typeName)) continue;

      const mapped = line.match(/@map\(\s*"([^"]+)"\s*\)/);
      columns.push(mapped?.[1] ?? camelToSnake(fieldName));
    }

    models.push({ name, table, columns: [...new Set(columns)] });
  }
  return models;
}

/**
 * Collect CREATE TABLE names from a SQL corpus (Prisma migrations + db/sql).
 * @param {string} sqlText
 * @returns {Set<string>}
 */
export function extractCreatedTables(sqlText) {
  const tables = new Set();
  const re =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let match;
  while ((match = re.exec(sqlText)) !== null) {
    tables.add(match[1].toLowerCase());
  }
  return tables;
}

/**
 * Extract column names declared inside CREATE TABLE <table> (...);
 * @param {string} sqlText
 * @param {string} table
 * @returns {Set<string>}
 */
export function extractTableColumns(sqlText, table) {
  const columns = new Set();
  const tableRe = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)`,
    'i',
  );
  const block = sqlText.match(tableRe);
  if (!block) return columns;

  for (const rawLine of block[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(line)) continue;
    const colMatch = line.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/);
    if (colMatch) columns.add(colMatch[1].toLowerCase());
  }
  return columns;
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} [filter]
 * @returns {string[]}
 */
export function listFilesRecursive(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (filter(entry)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * @param {string} root
 * @param {ReturnType<typeof defaultPaths>} [paths]
 */
export function loadSqlCorpus(root, paths = defaultPaths(root)) {
  const sqlFiles = [
    ...listFilesRecursive(paths.prismaMigrations, (n) => n.endsWith('.sql')),
    ...listFilesRecursive(paths.sqlDir, (n) => /^[0-9].*\.sql$/.test(n)),
  ];
  const parts = sqlFiles.map((file) => ({
    file: relative(root, file),
    text: readFileSync(file, 'utf8'),
  }));
  const combined = parts.map((p) => p.text).join('\n\n');
  const domainSqlOnly = parts
    .filter((p) => p.file.startsWith('db/sql/'))
    .map((p) => p.text)
    .join('\n\n');
  return { sqlFiles: parts.map((p) => p.file), combined, domainSqlOnly };
}

/**
 * @param {{
 *   root: string,
 *   prismaSchemaText?: string,
 *   combinedSql?: string,
 *   domainSql?: string,
 *   applySqlText?: string,
 *   dbReadmeText?: string,
 * }} input
 */
export function evaluateDrift(input) {
  const errors = [];
  const warnings = [];
  const paths = defaultPaths(input.root);

  const prismaText =
    input.prismaSchemaText ??
    (existsSync(paths.prismaSchema) ? readFileSync(paths.prismaSchema, 'utf8') : null);
  if (!prismaText) {
    errors.push(`missing Prisma schema at ${relative(input.root, paths.prismaSchema)}`);
    return { ok: false, errors, warnings, modelsChecked: 0 };
  }

  const corpus =
    input.combinedSql != null && input.domainSql != null
      ? {
          combined: input.combinedSql,
          domainSqlOnly: input.domainSql,
          sqlFiles: [],
        }
      : loadSqlCorpus(input.root, paths);

  const applySqlText =
    input.applySqlText ??
    (existsSync(paths.applySqlScript) ? readFileSync(paths.applySqlScript, 'utf8') : '');
  const dbReadmeText =
    input.dbReadmeText ??
    (existsSync(paths.dbReadme) ? readFileSync(paths.dbReadme, 'utf8') : '');

  if (!/prisma migrate deploy|prisma:migrate:deploy/i.test(applySqlText + dbReadmeText)) {
    errors.push(
      'apply order authority missing: db/README.md or apply-sql.sh must document Prisma migrate before numbered SQL',
    );
  }
  if (!/W1-DATA-04|schema authority|canonical apply order/i.test(dbReadmeText)) {
    errors.push(
      'db/README.md must document schema authority (W1-DATA-04 / canonical apply order)',
    );
  }

  const models = parsePrismaModels(prismaText);
  const created = extractCreatedTables(corpus.combined);

  for (const model of models) {
    if (!created.has(model.table.toLowerCase())) {
      errors.push(
        `Prisma model ${model.name} maps to "${model.table}" but no CREATE TABLE found in prisma/migrations or db/sql`,
      );
    }
  }

  for (const crit of CRITICAL_SQL_BACKED_MODELS) {
    const model = models.find((m) => m.name === crit.model);
    if (!model) {
      errors.push(`critical Prisma model ${crit.model} missing from schema.prisma`);
      continue;
    }
    if (model.table !== crit.table) {
      errors.push(
        `critical model ${crit.model} must @@map("${crit.table}") (found "${model.table}")`,
      );
    }

    const domainTables = extractCreatedTables(corpus.domainSqlOnly);
    if (!domainTables.has(crit.table.toLowerCase())) {
      errors.push(
        `critical table "${crit.table}" (${crit.model}) must be CREATE TABLE'd under db/sql/ (Prisma-only DDL is not enough for apply-sql paths)`,
      );
      continue;
    }

    const sqlCols = extractTableColumns(corpus.domainSqlOnly, crit.table);
    for (const col of model.columns) {
      if (!sqlCols.has(col.toLowerCase())) {
        errors.push(
          `critical table "${crit.table}": Prisma column "${col}" missing from db/sql CREATE TABLE`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    modelsChecked: models.length,
    criticalModels: CRITICAL_SQL_BACKED_MODELS.map((c) => c.model),
  };
}

function parseArgs(argv) {
  let root = null;
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node tools/scripts/check-prisma-sql-drift.mjs [--root=DIR] [--json]`);
      process.exit(0);
    }
  }
  if (!root) {
    const here = dirname(fileURLToPath(import.meta.url));
    root = join(here, '../..');
  }
  return { root, json };
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));
  const report = evaluateDrift({ root });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(
      `W1-DATA-04 OK: Prisma↔SQL drift gate passed (${report.modelsChecked} models; critical: ${report.criticalModels.join(', ')})`,
    );
  } else {
    console.error('W1-DATA-04 FAIL: Prisma↔SQL schema drift detected:');
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  main();
}
