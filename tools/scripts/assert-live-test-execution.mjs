#!/usr/bin/env node
/**
 * W3-TEST-03 — assert live Postgres suites actually executed.
 *
 * Reads a Vitest JSON report and fails when:
 * - DATABASE_URL is required but missing
 * - any *.live.test.ts / rls-live case was skipped under CI
 * - executed (non-skipped) live cases are below LIVE_TEST_MIN_EXECUTED (default 10)
 *
 * Usage:
 *   node tools/scripts/assert-live-test-execution.mjs path/to/vitest-report.json
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_MIN_EXECUTED = 10;

export function liveTestsRequired(env = process.env) {
  if (env.ALLOW_LIVE_TEST_SKIP === '1') return false;
  if (env.REQUIRE_LIVE_TESTS === '1') return true;
  return env.CI === 'true' || env.CI === '1';
}

export function isLiveTestFile(file = '') {
  const n = String(file).replace(/\\/g, '/');
  return n.includes('.live.test.') || n.endsWith('/rls-live.test.ts') || n.endsWith('rls-live.test.ts');
}

/**
 * @param {unknown} report Vitest JSON reporter payload
 * @returns {{ executed: number, skipped: number, files: string[] }}
 */
export function summarizeLiveTests(report) {
  const files = [];
  let executed = 0;
  let skipped = 0;

  const testResults = Array.isArray(report?.testResults) ? report.testResults : [];

  for (const file of testResults) {
    const name = String(file?.name ?? '');
    if (!isLiveTestFile(name)) continue;
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
        // Vitest may mark skipped cases as status "passed" at the file level;
        // assertion status is authoritative.
        executed += 1;
      }
    }
  }

  return { executed, skipped, files: [...new Set(files)] };
}

export function evaluateLiveReport(
  report,
  env = process.env,
  minExecuted = Number(env.LIVE_TEST_MIN_EXECUTED ?? DEFAULT_MIN_EXECUTED),
) {
  const errors = [];
  const url = env.DATABASE_URL?.trim();

  if (liveTestsRequired(env) && !url) {
    errors.push(
      'DATABASE_URL is required when CI=true or REQUIRE_LIVE_TESTS=1 (W3-TEST-03)',
    );
  }

  const summary = summarizeLiveTests(report);

  if (liveTestsRequired(env) && summary.skipped > 0) {
    errors.push(
      `Live suites skipped ${summary.skipped} case(s); silent skip is forbidden in CI (W3-TEST-03)`,
    );
  }

  if (url && summary.executed < minExecuted) {
    errors.push(
      `Live suites executed ${summary.executed} case(s); minimum is ${minExecuted} (W3-TEST-03)`,
    );
  }

  return { ok: errors.length === 0, errors, summary, minExecuted };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const reportPath = argv[0];
  if (!reportPath) {
    console.error('Usage: assert-live-test-execution.mjs <vitest-json-report>');
    return 2;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.error(`[W3-TEST-03] Failed to read Vitest JSON report: ${err}`);
    return 2;
  }

  const result = evaluateLiveReport(report, env);
  console.log(
    `[W3-TEST-03] live files=${result.summary.files.length} executed=${result.summary.executed} skipped=${result.summary.skipped} min=${result.minExecuted}`,
  );
  if (!result.ok) {
    for (const e of result.errors) console.error(`[W3-TEST-03] FAIL: ${e}`);
    return 1;
  }
  console.log('[W3-TEST-03] OK: live suites executed above minimum with no skips');
  return 0;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  process.exit(main());
}
