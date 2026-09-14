#!/usr/bin/env node
/**
 * W3-TEST-04 — assert Vitest JSON reports contain no forbidden skips.
 *
 * Used for Postgres repository suites in CI (pg-gate) and reusable for other
 * gate runners. W3-TEST-03 covers *.live.test.ts via assert-live-test-execution.
 *
 * Usage:
 *   node tools/scripts/assert-vitest-skips.mjs <vitest-json-report> [--profile pg]
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_MIN_EXECUTED = 25;
/** Inverse skip: `it.skipIf(!!DATABASE_URL)` when DB is present (pg-store.test.ts). */
const DEFAULT_MAX_ALLOWED_SKIPS = 1;

export function skipsForbidden(env = process.env) {
  if (env.ALLOW_TEST_SKIP === '1') return false;
  if (env.FORBID_TEST_SKIPS === '1') return true;
  if (env.REQUIRE_LIVE_TESTS === '1') return true;
  return env.CI === 'true' || env.CI === '1';
}

export function isLiveTestFile(file = '') {
  const n = String(file).replace(/\\/g, '/');
  return n.includes('.live.test.') || n.endsWith('/rls-live.test.ts') || n.endsWith('rls-live.test.ts');
}

export function isPgGateFile(file = '') {
  const n = String(file).replace(/\\/g, '/');
  if (isLiveTestFile(n)) return false;
  if (n.includes('/pg-') && n.endsWith('.test.ts')) return true;
  if (n.endsWith('.integration.test.ts')) return true;
  if (n.endsWith('/create-admissions-pipeline-store.test.ts')) return true;
  if (n.endsWith('/bed-assignment.test.ts')) return true;
  return false;
}

function fileMatchesProfile(name, profile) {
  if (profile === 'pg') return isPgGateFile(name);
  if (profile === 'live') return isLiveTestFile(name);
  return true;
}

/**
 * @param {unknown} report Vitest JSON reporter payload
 * @param {{ profile?: string }} [options]
 * @returns {{ executed: number, skipped: number, files: string[] }}
 */
export function summarizeReport(report, options = {}) {
  const profile = options.profile ?? 'all';
  const files = [];
  let executed = 0;
  let skipped = 0;

  const testResults = Array.isArray(report?.testResults) ? report.testResults : [];

  for (const file of testResults) {
    const name = String(file?.name ?? '');
    if (!fileMatchesProfile(name, profile)) continue;
    files.push(name);

    const assertions = Array.isArray(file?.assertionResults) ? file.assertionResults : [];
    if (assertions.length === 0) {
      if (file?.status === 'skipped') skipped += 1;
      continue;
    }
    for (const assertion of assertions) {
      const status = String(assertion?.status ?? '');
      if (status === 'skipped' || status === 'pending' || status === 'todo') {
        skipped += 1;
      } else {
        executed += 1;
      }
    }
  }

  return { executed, skipped, files: [...new Set(files)] };
}

export function evaluateVitestReport(
  report,
  env = process.env,
  options = {},
) {
  const profile = options.profile ?? 'pg';
  const minExecuted = Number(
    options.minExecuted ?? env.PG_TEST_MIN_EXECUTED ?? DEFAULT_MIN_EXECUTED,
  );
  const maxAllowedSkips = Number(
    options.maxAllowedSkips ?? env.PG_TEST_MAX_ALLOWED_SKIPS ?? DEFAULT_MAX_ALLOWED_SKIPS,
  );

  const errors = [];
  const url = env.DATABASE_URL?.trim();

  if (skipsForbidden(env) && !url) {
    errors.push(
      'DATABASE_URL is required when CI=true or FORBID_TEST_SKIPS=1 (W3-TEST-04)',
    );
  }

  const summary = summarizeReport(report, { profile });

  if (skipsForbidden(env) && summary.skipped > maxAllowedSkips) {
    errors.push(
      `Profile "${profile}" skipped ${summary.skipped} case(s); max allowed is ${maxAllowedSkips} (W3-TEST-04)`,
    );
  }

  if (url && summary.executed < minExecuted) {
    errors.push(
      `Profile "${profile}" executed ${summary.executed} case(s); minimum is ${minExecuted} (W3-TEST-04)`,
    );
  }

  return { ok: errors.length === 0, errors, summary, minExecuted, maxAllowedSkips, profile };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  let profile = 'pg';
  if (args[0] === '--profile') {
    profile = args[1] ?? 'pg';
    args.splice(0, 2);
  }

  const reportPath = args[0];
  if (!reportPath) {
    console.error('Usage: assert-vitest-skips.mjs [--profile pg|live|all] <vitest-json-report>');
    return 2;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.error(`[W3-TEST-04] Failed to read Vitest JSON report: ${err}`);
    return 2;
  }

  const result = evaluateVitestReport(report, env, { profile });
  console.log(
    `[W3-TEST-04] profile=${result.profile} files=${result.summary.files.length} executed=${result.summary.executed} skipped=${result.summary.skipped} min=${result.minExecuted} maxSkips=${result.maxAllowedSkips}`,
  );
  if (!result.ok) {
    for (const e of result.errors) console.error(`[W3-TEST-04] FAIL: ${e}`);
    return 1;
  }
  console.log('[W3-TEST-04] OK: no forbidden skips; executed count above minimum');
  return 0;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  process.exit(main());
}
