#!/usr/bin/env node
/**
 * W3-D6 — assert Definition-of-Done closure evidence artifacts.
 *
 * Fails closed when the DoD aggregator did not emit a complete JSON report,
 * when the committed baseline pack is missing or incoherent, or when CI ran
 * fewer than the seven Charter §32 checks.
 *
 * Usage:
 *   node tools/scripts/assert-dod-evidence.mjs [dod-report.json]
 *
 * Env:
 *   DOD_BASELINE_PATH — override baseline.json location
 *   DOD_REQUIRE_CI    — when "1", require process.env.CI (for unit tests)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');

/** Charter §32 check ids — must match tools/dod-checks/src/lib/constants.mjs */
export const REQUIRED_CHECK_IDS = Object.freeze([
  'table-naming',
  'cross-service-joins',
  'tenant-id',
  'audit-events',
  'api-schema',
  'error-envelope',
  'i18n-readiness',
]);

export const DEFAULT_REPORT_PATH = resolve(
  REPO_ROOT,
  'tools/dod-checks/reports/dod-report.json',
);
export const DEFAULT_BASELINE_PATH = resolve(
  REPO_ROOT,
  'tools/dod-checks/reports/baseline.json',
);

function isIsoTimestamp(value) {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t);
}

/**
 * @param {unknown} report
 * @param {{ requireAllChecks?: boolean }} [options]
 */
export function evaluateDodReport(report, options = {}) {
  const errors = [];
  const requireAllChecks = options.requireAllChecks !== false;

  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['report must be a JSON object'], checkIds: [] };
  }

  const obj = /** @type {Record<string, unknown>} */ (report);

  if (obj.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${String(obj.schemaVersion)})`);
  }
  if (!String(obj.charterRef ?? '').includes('Section 32')) {
    errors.push('charterRef must reference Section 32 (Definition of Done)');
  }
  if (!isIsoTimestamp(obj.generatedAt)) {
    errors.push('generatedAt must be a valid ISO-8601 timestamp');
  }

  const totals = obj.totals;
  if (!totals || typeof totals !== 'object') {
    errors.push('totals object is required');
  } else {
    for (const key of ['totalErrors', 'totalWarnings', 'totalFiles']) {
      if (typeof /** @type {Record<string, unknown>} */ (totals)[key] !== 'number') {
        errors.push(`totals.${key} must be a number`);
      }
    }
  }

  const checks = Array.isArray(obj.checks) ? obj.checks : null;
  if (!checks) {
    errors.push('checks must be a non-empty array');
    return { ok: false, errors, checkIds: [] };
  }

  const checkIds = [];
  for (const entry of checks) {
    if (!entry || typeof entry !== 'object') {
      errors.push('each checks[] entry must be an object');
      continue;
    }
    const row = /** @type {Record<string, unknown>} */ (entry);
    const id = String(row.check ?? '');
    if (!id) {
      errors.push('checks[].check id is required');
      continue;
    }
    checkIds.push(id);
    for (const key of ['title', 'filesScanned', 'errorCount', 'warningCount']) {
      if (!(key in row)) errors.push(`checks[${id}].${key} is required`);
    }
    if (!Array.isArray(row.findings)) {
      errors.push(`checks[${id}].findings must be an array`);
    }
  }

  if (requireAllChecks) {
    const missing = REQUIRED_CHECK_IDS.filter((id) => !checkIds.includes(id));
    const extra = checkIds.filter((id) => !REQUIRED_CHECK_IDS.includes(id));
    if (missing.length) {
      errors.push(`missing required DoD checks: ${missing.join(', ')}`);
    }
    if (extra.length) {
      errors.push(`unexpected DoD check ids: ${extra.join(', ')}`);
    }
    if (checkIds.length !== REQUIRED_CHECK_IDS.length) {
      errors.push(
        `expected exactly ${REQUIRED_CHECK_IDS.length} checks, got ${checkIds.length}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, checkIds };
}

/** @param {unknown} baseline */
export function evaluateBaselinePack(baseline) {
  const errors = [];
  if (!baseline || typeof baseline !== 'object') {
    return { ok: false, errors: ['baseline must be a JSON object'] };
  }
  const reportEval = evaluateDodReport(baseline, { requireAllChecks: true });
  if (!reportEval.ok) {
    errors.push(...reportEval.errors.map((e) => `baseline: ${e}`));
  }
  const totals = /** @type {Record<string, unknown>} */ (baseline).totals;
  if (totals && typeof totals.totalErrors === 'number' && totals.totalErrors < 0) {
    errors.push('baseline totals.totalErrors must be >= 0');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{
 *   reportPath?: string,
 *   baselinePath?: string,
 *   requireReportFile?: boolean,
 *   requireBaselineFile?: boolean,
 * }} [options]
 */
export function evaluateEvidencePaths(options = {}) {
  const errors = [];
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  const baselinePath = options.baselinePath ?? DEFAULT_BASELINE_PATH;
  const requireReport = options.requireReportFile !== false;
  const requireBaseline = options.requireBaselineFile !== false;

  if (requireBaseline && !existsSync(baselinePath)) {
    errors.push(`missing committed baseline artifact: ${baselinePath}`);
  }

  if (requireReport && !existsSync(reportPath)) {
    errors.push(`missing DoD JSON report artifact: ${reportPath}`);
    return { ok: false, errors, reportPath, baselinePath };
  }

  if (requireBaseline && existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      const baseEval = evaluateBaselinePack(baseline);
      if (!baseEval.ok) errors.push(...baseEval.errors);
    } catch (err) {
      errors.push(`failed to parse baseline JSON: ${err}`);
    }
  }

  if (requireReport && existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      const reportEval = evaluateDodReport(report);
      if (!reportEval.ok) errors.push(...reportEval.errors);
    } catch (err) {
      errors.push(`failed to parse DoD report JSON: ${err}`);
    }
  }

  return { ok: errors.length === 0, errors, reportPath, baselinePath };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const baselineOnly = argv.includes('--baseline-only');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const reportPath = positional[0] ? resolve(positional[0]) : DEFAULT_REPORT_PATH;
  const baselinePath = env.DOD_BASELINE_PATH
    ? resolve(env.DOD_BASELINE_PATH)
    : DEFAULT_BASELINE_PATH;

  if (env.DOD_REQUIRE_CI === '1' && !env.CI) {
    console.error('[W3-D6] CI context required but not set');
    return 1;
  }

  const result = evaluateEvidencePaths({
    reportPath,
    baselinePath,
    requireReportFile: !baselineOnly,
  });
  console.log(
    `[W3-D6] report=${reportPath} baseline=${baselinePath} checks=${REQUIRED_CHECK_IDS.length}`,
  );

  if (!result.ok) {
    for (const e of result.errors) console.error(`[W3-D6] FAIL: ${e}`);
    return 1;
  }

  console.log('[W3-D6] OK: DoD evidence artifacts present and schema-complete');
  return 0;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  process.exit(main());
}
