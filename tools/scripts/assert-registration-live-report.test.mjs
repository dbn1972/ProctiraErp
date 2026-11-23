/**
 * UAT-API-004 — the registration live report check fails closed on skipped,
 * flaky, failed or missing tests and on unreadable reports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRegistrationLiveReport } from './assert-registration-live-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, 'assert-registration-live-report.mjs');

function report(statuses, stats = {}) {
  const tests = statuses.map((status) => ({ status }));
  const counts = { expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  for (const s of statuses) counts[s] += 1;
  return {
    stats: { ...counts, ...stats },
    errors: [],
    suites: [
      {
        title: '03-registration-live-journey.spec.ts',
        specs: [],
        suites: [
          {
            title: 'live submit and track',
            specs: tests.map((t, i) => ({ title: `test ${i}`, tests: [t] })),
          },
        ],
      },
    ],
  };
}

test('all tests expected passes', () => {
  assert.deepEqual(checkRegistrationLiveReport(report(['expected', 'expected'])), []);
});

for (const status of ['skipped', 'flaky', 'unexpected']) {
  test(`a ${status} test fails`, () => {
    const problems = checkRegistrationLiveReport(report(['expected', status]));
    assert.ok(
      problems.some((p) => p.startsWith(`${status}: `)),
      problems.join('\n'),
    );
    assert.ok(
      problems.some((p) => p.startsWith(`stats.${status} = 1`)),
      problems.join('\n'),
    );
  });
}

test('an empty run fails', () => {
  assert.ok(checkRegistrationLiveReport(report([])).includes('no tests ran'));
});

test('a top-level error fails', () => {
  const r = report(['expected']);
  r.errors = [{ message: 'webServer did not start\nstack' }];
  assert.deepEqual(checkRegistrationLiveReport(r), ['top-level error: webServer did not start']);
});

test('stats that disagree with the listed tests fail', () => {
  const problems = checkRegistrationLiveReport(report(['expected'], { expected: 5 }));
  assert.deepEqual(problems, ['stats.expected = 5 but 1 test(s) in the report']);
});

test('a non-report fails', () => {
  assert.deepEqual(checkRegistrationLiveReport({}), [
    'report is not a Playwright JSON report (no suites)',
  ]);
});

test('CLI exits 1 on a missing file and 0 on a passing report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-live-report-'));
  try {
    const missing = spawnSync('node', [cli, '--report', join(dir, 'none.json')], {
      encoding: 'utf8',
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /cannot read Playwright report/);
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify(report(['expected', 'expected', 'expected'])));
    const ok = spawnSync('node', [cli, '--report', file], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /3 passed, 0 skipped, 0 flaky/);
    assert.equal(spawnSync('node', [cli], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
