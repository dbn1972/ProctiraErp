#!/usr/bin/env node
/**
 * Check 5 — API Schema Presence (Typebox).
 *
 * Charter §6 (API Standards) and §32 require every public route to publish a
 * Typebox schema for request bodies, query params, and responses, so that:
 *   - clients can generate types
 *   - the developer portal can render docs
 *   - validation runs at the gateway
 *
 * For every backend service that defines routes, this check verifies one of:
 *   - a dedicated `*schema*.ts` file references `@sinclair/typebox`, or
 *   - the route file itself imports `@sinclair/typebox` and uses `Type.Object`
 *     (acceptable for small services).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS, KNOWN_SERVICES } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';

const TITLE = 'API Schema Presence (Typebox schemas for every route)';

const TYPEBOX_PATTERNS = [
  /@sinclair\/typebox/,
  /\bType\.(Object|String|Number|Array|Union|Literal|Optional)\b/,
];

function usesTypebox(text) {
  return TYPEBOX_PATTERNS.some((p) => p.test(text));
}

export async function runApiSchemaCheck() {
  const report = new Report(CHECK_IDS.API_SCHEMA, TITLE);
  let scanned = 0;

  for (const svc of KNOWN_SERVICES) {
    const svcDir = resolve(BACKEND_DIR, svc, 'src');
    const routeFiles = await findFiles(svcDir, (n) => isProductionTsFile(n) && n.includes('route'));
    if (routeFiles.length === 0) continue;

    scanned += routeFiles.length;
    const schemaFiles = await findFiles(svcDir, (n) => isProductionTsFile(n) && n.includes('schema'));

    let typeboxFound = false;
    for (const f of schemaFiles) {
      if (usesTypebox(await safeReadFile(f))) {
        typeboxFound = true;
        break;
      }
    }
    if (!typeboxFound) {
      for (const f of routeFiles) {
        if (usesTypebox(await safeReadFile(f))) {
          typeboxFound = true;
          break;
        }
      }
    }

    if (!typeboxFound) {
      const reportTarget = schemaFiles[0] ?? routeFiles[0];
      report.addError(
        reportTarget,
        `Service "${svc}" exposes routes but no Typebox schema (file or inline) was found.`,
        {
          suggestion:
            'Add `import { Type } from "@sinclair/typebox"` and define request/response schemas; wire them into Fastify route options.',
          ruleRef: 'Charter §6 + §32',
        },
      );
    } else if (schemaFiles.length > 0) {
      // Soft-warn on schema files that don't actually use Typebox (e.g. legacy Joi).
      for (const f of schemaFiles) {
        if (!usesTypebox(await safeReadFile(f))) {
          report.addWarning(f, 'Schema file exists but does not appear to use @sinclair/typebox.', {
            suggestion: 'Migrate this schema file to Typebox to align with the platform contract.',
            ruleRef: 'Charter §6',
          });
        }
      }
    }
  }

  report.filesScanned = scanned;
  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runApiSchemaCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
