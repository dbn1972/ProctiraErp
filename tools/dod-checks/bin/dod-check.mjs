#!/usr/bin/env node
/**
 * Definition-of-Done aggregator.
 *
 * Runs every check in `src/checks/*` (or only those listed via `--only=…`)
 * and produces:
 *   - human-readable colorized output on stdout
 *   - a structured JSON report at tools/dod-checks/reports/dod-report.json
 *     (path overridable via --report=<path>)
 *
 * Exit codes:
 *   0 — all checks pass (warnings allowed unless --strict)
 *   1 — at least one check produced an error finding
 *   2 — runtime failure (uncaught exception)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { runApiSchemaCheck } from '../src/checks/api-schema.mjs';
import { runAuditEventsCheck } from '../src/checks/audit-events.mjs';
import { runCrossServiceJoinsCheck } from '../src/checks/cross-service-joins.mjs';
import { runErrorEnvelopeCheck } from '../src/checks/error-envelope.mjs';
import { runI18nCheck } from '../src/checks/i18n-readiness.mjs';
import { runTableNamingCheck } from '../src/checks/table-naming.mjs';
import { runTenantIdCheck } from '../src/checks/tenant-id.mjs';
import { CHECK_IDS } from '../src/lib/constants.mjs';
import { REPORTS_DIR } from '../src/lib/paths.mjs';
import { printReport, printSummary } from '../src/lib/reporter.mjs';

const ALL_CHECKS = [
  { id: CHECK_IDS.TABLE_NAMING, run: runTableNamingCheck },
  { id: CHECK_IDS.CROSS_SERVICE_JOINS, run: runCrossServiceJoinsCheck },
  { id: CHECK_IDS.TENANT_ID, run: runTenantIdCheck },
  { id: CHECK_IDS.AUDIT_EVENTS, run: runAuditEventsCheck },
  { id: CHECK_IDS.API_SCHEMA, run: runApiSchemaCheck },
  { id: CHECK_IDS.ERROR_ENVELOPE, run: runErrorEnvelopeCheck },
  { id: CHECK_IDS.I18N, run: runI18nCheck },
];

function parseArgs(argv) {
  const args = { only: null, strict: false, report: null, jsonOnly: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',');
    else if (a === '--strict') args.strict = true;
    else if (a.startsWith('--report=')) args.report = a.slice('--report='.length);
    else if (a === '--json') args.jsonOnly = true;
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: dod-check [options]

Options:
  --only=<id,id>    Run only the listed checks (comma-separated). Valid ids:
                      ${Object.values(CHECK_IDS).join(', ')}
  --strict          Treat warnings as failures (exit 1).
  --report=<path>   Path to the JSON report (default: tools/dod-checks/reports/dod-report.json).
  --json            Suppress human output; emit only the JSON report path.
  -h, --help        Show this help.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const targets = args.only ? ALL_CHECKS.filter((c) => args.only.includes(c.id)) : ALL_CHECKS;
  if (args.only && targets.length !== args.only.length) {
    const valid = new Set(ALL_CHECKS.map((c) => c.id));
    const bad = args.only.filter((id) => !valid.has(id));
    console.error(`Unknown check id(s): ${bad.join(', ')}`);
    printUsage();
    process.exit(2);
  }

  if (!args.jsonOnly) {
    console.log('═'.repeat(70));
    console.log(' Definition-of-Done CI Checks');
    console.log(' Charter §32 (Definition of Done)');
    console.log('═'.repeat(70));
  }

  const reports = [];
  for (const t of targets) {
    const report = await t.run();
    reports.push(report);
    if (!args.jsonOnly) printReport(report);
  }

  const totals = args.jsonOnly
    ? {
        totalErrors: reports.reduce((s, r) => s + r.errorCount, 0),
        totalWarnings: reports.reduce((s, r) => s + r.warningCount, 0),
        totalFiles: reports.reduce((s, r) => s + r.filesScanned, 0),
      }
    : printSummary(reports);

  // Emit structured JSON report.
  const reportPath = args.report ?? resolve(REPORTS_DIR, 'dod-report.json');
  const json = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    charterRef: 'Section 32 (Definition of Done)',
    totals,
    checks: reports.map((r) => r.toJSON()),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(json, null, 2));

  if (!args.jsonOnly) {
    console.log(`\n📄 JSON report written to ${reportPath}`);
  } else {
    console.log(reportPath);
  }

  const failed = totals.totalErrors > 0 || (args.strict && totals.totalWarnings > 0);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in dod-check aggregator:', err);
  process.exit(2);
});
