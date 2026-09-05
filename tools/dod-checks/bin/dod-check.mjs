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
 * Baseline gate (Charter §32 rollout):
 *   Pre-existing findings live in reports/baseline.json. CI fails only when
 *   the current run introduces *additional* error debt beyond that baseline
 *   (per-check error counts, overall error total, or net-new fingerprints).
 *   Warnings never fail unless `--strict` is set.
 *
 * Exit codes:
 *   0 — within baseline (warnings allowed unless --strict)
 *   1 — new error findings beyond baseline (or --strict warning regression)
 *   2 — runtime failure (uncaught exception)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const DEFAULT_BASELINE = resolve(REPORTS_DIR, 'baseline.json');

function parseArgs(argv) {
  const args = {
    only: null,
    strict: false,
    report: null,
    jsonOnly: false,
    baseline: DEFAULT_BASELINE,
    noBaseline: false,
    updateBaseline: false,
  };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',');
    else if (a === '--strict') args.strict = true;
    else if (a.startsWith('--report=')) args.report = a.slice('--report='.length);
    else if (a === '--json') args.jsonOnly = true;
    else if (a.startsWith('--baseline=')) args.baseline = resolve(a.slice('--baseline='.length));
    else if (a === '--no-baseline') args.noBaseline = true;
    else if (a === '--update-baseline') args.updateBaseline = true;
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
  --only=<id,id>       Run only the listed checks (comma-separated). Valid ids:
                         ${Object.values(CHECK_IDS).join(', ')}
  --strict             Treat warnings as failures (exit 1), including warning
                         count regressions against the baseline.
  --report=<path>      Path to the JSON report (default: tools/dod-checks/reports/dod-report.json).
  --baseline=<path>    Baseline JSON used as the allowed-debt ceiling
                         (default: tools/dod-checks/reports/baseline.json).
  --no-baseline        Ignore baseline; fail on any error finding.
  --update-baseline    Write the current report to the baseline path (after run).
  --json               Suppress human output; emit only the JSON report path.
  -h, --help           Show this help.
`);
}

/** Fingerprint omitting line numbers so pure refactors do not fail CI. */
function fingerprint(finding) {
  return [finding.check, finding.severity, finding.file ?? '', finding.message].join('|');
}

async function loadBaseline(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function compareToBaseline(reports, baseline, { strict }) {
  if (!baseline) {
    return { ok: true, regressions: [], summary: 'no baseline on disk' };
  }

  const baselineByCheck = new Map((baseline.checks ?? []).map((c) => [c.check, c]));
  const baselineFingerprints = new Set();
  for (const c of baseline.checks ?? []) {
    for (const f of c.findings ?? []) {
      if (f.severity === 'error' || (strict && f.severity === 'warning')) {
        baselineFingerprints.add(fingerprint(f));
      }
    }
  }

  const regressions = [];
  let currentErrors = 0;
  let baselineErrorsForRun = 0;

  for (const report of reports) {
    const json = report.toJSON();
    const base = baselineByCheck.get(json.check);
    const baseErrors = base?.errorCount ?? 0;
    const baseWarnings = base?.warningCount ?? 0;
    currentErrors += json.errorCount;
    baselineErrorsForRun += baseErrors;

    if (json.errorCount > baseErrors) {
      regressions.push({
        check: json.check,
        kind: 'error-count',
        baseline: baseErrors,
        current: json.errorCount,
        delta: json.errorCount - baseErrors,
      });
    }
    if (strict && json.warningCount > baseWarnings) {
      regressions.push({
        check: json.check,
        kind: 'warning-count',
        baseline: baseWarnings,
        current: json.warningCount,
        delta: json.warningCount - baseWarnings,
      });
    }

    for (const f of json.findings) {
      if (f.severity !== 'error' && !(strict && f.severity === 'warning')) continue;
      if (!baselineFingerprints.has(fingerprint(f))) {
        regressions.push({
          check: json.check,
          kind: 'new-finding',
          file: f.file,
          line: f.line,
          message: f.message,
        });
      }
    }
  }

  const baselineTotal = baseline.totals?.totalErrors ?? baselineErrorsForRun;

  return {
    ok: regressions.length === 0 && currentErrors <= baselineTotal,
    regressions,
    summary: `baseline errors=${baselineTotal}, current errors=${currentErrors}, regressions=${regressions.length}`,
  };
}

function printBaselineResult(comparison) {
  console.log('\n' + '─'.repeat(70));
  console.log(' Baseline comparison');
  console.log('─'.repeat(70));
  console.log(` ${comparison.summary}`);
  if (comparison.ok) {
    console.log(' ✅ Within baseline — no new Charter §32 error debt.');
    return;
  }
  console.log(' ❌ New findings beyond baseline:');
  for (const r of comparison.regressions.slice(0, 40)) {
    if (r.kind === 'new-finding') {
      const loc = r.line ? `${r.file}:${r.line}` : r.file;
      console.log(`   • [${r.check}] ${loc} — ${r.message}`);
    } else {
      console.log(
        `   • [${r.check}] ${r.kind} baseline=${r.baseline} current=${r.current} (Δ+${r.delta})`,
      );
    }
  }
  if (comparison.regressions.length > 40) {
    console.log(`   … and ${comparison.regressions.length - 40} more`);
  }
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

  if (args.updateBaseline) {
    await mkdir(dirname(args.baseline), { recursive: true });
    await writeFile(args.baseline, JSON.stringify(json, null, 2));
    if (!args.jsonOnly) {
      console.log(`\n📌 Baseline updated at ${args.baseline}`);
    }
  }

  let comparison = { ok: true, regressions: [], summary: 'baseline disabled' };
  if (!args.noBaseline && !args.updateBaseline) {
    const baseline = await loadBaseline(args.baseline);
    comparison = compareToBaseline(reports, baseline, { strict: args.strict });
    if (!args.jsonOnly) printBaselineResult(comparison);
  } else if (args.noBaseline && !args.jsonOnly) {
    console.log('\n(Baseline comparison skipped via --no-baseline)');
  }

  if (!args.jsonOnly) {
    console.log(`\n📄 JSON report written to ${reportPath}`);
  } else {
    console.log(reportPath);
  }

  const absoluteFail =
    args.noBaseline && (totals.totalErrors > 0 || (args.strict && totals.totalWarnings > 0));
  const baselineFail = !args.noBaseline && !args.updateBaseline && !comparison.ok;
  const failed = args.updateBaseline ? false : absoluteFail || baselineFail;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in dod-check aggregator:', err);
  process.exit(2);
});
