#!/usr/bin/env node
/**
 * Check 1 — Service-Prefixed Table Naming.
 *
 * Charter §4 (Service-Owned Table Naming) and §32 (Definition of Done) require
 * every persistent table to carry the owning service's prefix, e.g.
 *   - student_students
 *   - auth_users
 *   - institution_institutions
 * with the only exceptions being shared/cross-cutting tables like
 * `tenants` and the framework-owned `_prisma_migrations`.
 *
 * Implementation notes:
 *   - Prisma schema is not standard TypeScript, so ts-morph cannot parse it.
 *     We use a deliberately small parser that walks `model … { … }` blocks,
 *     reads any `@@map("…")` value, and handles the implicit table-name case
 *     (model name lower-cased) where no `@@map` is given.
 *   - The check is exposed both as a standalone runnable module and as a
 *     reusable function for the aggregator.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS, KNOWN_SERVICES, SHARED_TABLES, servicePrefix } from '../lib/constants.mjs';
import { findFiles, safeReadFile } from '../lib/fs-utils.mjs';
import { PACKAGES_DIR } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';

const TITLE = 'Service-Prefixed Table Naming (every table → <service>_<name>)';

/**
 * Parse a Prisma schema text into an array of
 *   { kind: 'model'|'view', modelName, tableName, line }
 * Each entry corresponds to one persisted relation.
 */
function parsePrismaModels(text) {
  const out = [];
  // Match every top-level `model X { … }` or `view X { … }` block.
  const blockRegex = /(model|view)\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const [, kind, modelName, body] = m;
    const lineOfBlock = text.slice(0, m.index).split('\n').length;
    const mapMatch = body.match(/@@map\s*\(\s*"([^"]+)"\s*\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase();
    out.push({ kind, modelName, tableName, line: lineOfBlock });
  }
  return out;
}

/** Returns true when `tableName` starts with a known service prefix. */
function hasServicePrefix(tableName) {
  return KNOWN_SERVICES.some((svc) => tableName.startsWith(`${servicePrefix(svc)}_`));
}

/**
 * Run the check. Returns a populated `Report`.
 */
export async function runTableNamingCheck() {
  const report = new Report(CHECK_IDS.TABLE_NAMING, TITLE);
  const schemas = await findFiles(PACKAGES_DIR, (name) => name === 'schema.prisma');
  report.filesScanned = schemas.length;

  for (const schemaPath of schemas) {
    const text = await safeReadFile(schemaPath);
    const models = parsePrismaModels(text);
    for (const model of models) {
      if (SHARED_TABLES.has(model.tableName)) continue;
      if (hasServicePrefix(model.tableName)) continue;
      // Allow tables defined in the explicitly-shared database package.
      if (schemaPath.includes('/packages/shared/database/')) continue;

      report.addError(
        schemaPath,
        `${model.kind} "${model.modelName}" maps to table "${model.tableName}" which lacks a service prefix.`,
        {
          line: model.line,
          suggestion:
            'Rename via @@map("<service>_<name>") where <service> is one of: ' +
            KNOWN_SERVICES.slice(0, 6).join(', ') + ', …',
          ruleRef: 'Charter §4 + §32',
        },
      );
    }
  }

  return report.finish();
}

// Standalone CLI entrypoint.
const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runTableNamingCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
