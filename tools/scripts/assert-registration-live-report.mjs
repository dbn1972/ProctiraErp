#!/usr/bin/env node
/**
 * UAT-API-004 / PRC-M568 — fail closed on the registration live journey report.
 *
 * Reads a Playwright JSON report and fails unless at least one test ran and
 * every test passed on its first attempt: no skipped, flaky or failed test and
 * no top-level error. A green Playwright exit with skipped tests is not a pass.
 *
 *   node tools/scripts/assert-registration-live-report.mjs --report <file.json>
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function* walkTests(suite, titles = []) {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      yield { title: [...path, spec.title].join(' > '), status: test.status };
    }
  }
  for (const child of suite.suites ?? []) yield* walkTests(child, path);
}

/** Returns a list of problems; an empty list means the report passes. */
export function checkRegistrationLiveReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites)) {
    return ['report is not a Playwright JSON report (no suites)'];
  }
  const problems = [];
  for (const error of report.errors ?? []) {
    problems.push(`top-level error: ${String(error?.message ?? error).split('\n')[0]}`);
  }
  const tests = report.suites.flatMap((suite) => [...walkTests(suite)]);
  if (tests.length === 0) problems.push('no tests ran');
  for (const t of tests) {
    if (t.status !== 'expected') problems.push(`${t.status ?? 'unknown'}: ${t.title}`);
  }
  const stats = report.stats ?? {};
  for (const key of ['skipped', 'flaky', 'unexpected']) {
    if ((stats[key] ?? 0) !== 0) problems.push(`stats.${key} = ${stats[key]} (expected 0)`);
  }
  if ((stats.expected ?? 0) !== tests.length) {
    problems.push(
      `stats.expected = ${stats.expected ?? 0} but ${tests.length} test(s) in the report`,
    );
  }
  return problems;
}

function main(argv) {
  const at = argv.indexOf('--report');
  const file = at >= 0 ? argv[at + 1] : undefined;
  if (!file) {
    console.error('usage: assert-registration-live-report.mjs --report <file.json>');
    return 2;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`error: cannot read Playwright report ${file}: ${error.message}`);
    return 1;
  }
  const problems = checkRegistrationLiveReport(report);
  if (problems.length > 0) {
    for (const p of problems) console.error(`error: ${p}`);
    return 1;
  }
  console.log(`registration live report OK: ${report.stats.expected} passed, 0 skipped, 0 flaky`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
