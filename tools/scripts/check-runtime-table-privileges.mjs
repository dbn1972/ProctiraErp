#!/usr/bin/env node
/**
 * W1-DATA-11 COMPLETE — CI catalog gate for runtime table privileges.
 *
 * Fails closed when:
 *   - any public CREATE TABLE is missing from db/runtime-table-privileges.json
 *   - 050 still installs blanket TABLE DEFAULT PRIVILEGES for proctira_app
 *   - 076 does not revoke those defaults
 *   - apply-sql.sh does not sync privileges from the catalog
 *
 * Usage:
 *   node tools/scripts/check-runtime-table-privileges.mjs
 *   node tools/scripts/check-runtime-table-privileges.mjs --root=/path/to/repo
 *   node tools/scripts/check-runtime-table-privileges.mjs --json
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CATALOG_REL,
  evaluateRepo,
  generateSyncSql,
  loadCatalog,
  defaultPaths,
} from './runtime-table-privileges-lib.mjs';

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ root: string, json: boolean, printSql: boolean }} */
  const out = {
    root: join(dirname(fileURLToPath(import.meta.url)), '../..'),
    json: false,
    printSql: false,
  };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--print-sql') out.printSql = true;
    else if (arg.startsWith('--root=')) out.root = arg.slice('--root='.length);
  }
  return out;
}

/**
 * @param {string} root
 * @param {{ json?: boolean, printSql?: boolean }} opts
 */
export function main(root, opts = {}) {
  if (opts.printSql) {
    const catalog = loadCatalog(defaultPaths(root).catalog);
    process.stdout.write(generateSyncSql(catalog));
    return 0;
  }

  const report = evaluateRepo(root);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(
      `W1-DATA-11 privilege catalog gate PASS (${report.counts.catalog} tables in ${CATALOG_REL})`,
    );
    console.log(`  classes: ${JSON.stringify(report.counts.byClass)}`);
  } else {
    console.error('W1-DATA-11 privilege catalog gate FAIL:');
    for (const issue of report.issues) {
      console.error(`  - ${issue}`);
    }
  }
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  process.exitCode = main(args.root, args);
}
