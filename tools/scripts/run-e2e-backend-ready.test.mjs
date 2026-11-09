/**
 * PRC-L389 — run-e2e-backend-ready.sh is fail-closed by default: an unset
 * DATABASE_URL exits non-zero unless E2E_ALLOW_SKIP=1, and the harness
 * gateway binds to loopback. Only the pre-stack paths run (no DB, no build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'run-e2e-backend-ready.sh');
const workflowPath = resolve(here, '../../.github/workflows/e2e-backend-ready.yml');
const skipGate = resolve(here, 'assert-playwright-skips.mjs');
const allowlistPath = resolve(here, 'e2e-backend-ready-skip-allowlist.json');
const playwrightConfigPath = resolve(here, '../../apps/web/playwright.config.ts');
const e2eDir = resolve(here, '../../apps/web/e2e');

function runHarness(env, args = []) {
  const base = { ...process.env };
  for (const k of [
    'DATABASE_URL',
    'E2E_ALLOW_SKIP',
    'E2E_REQUIRE_LIVE',
    'E2E_SKIP_STACK',
    'GITHUB_STEP_SUMMARY',
  ]) {
    delete base[k];
  }
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...base, ...env } });
}

test('unset DATABASE_URL exits non-zero by default', () => {
  const r = runHarness({});
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(r.stdout, /SKIP SUMMARY/);
});

test('E2E_ALLOW_SKIP=1 restores the local skip summary', () => {
  const r = runHarness({ E2E_ALLOW_SKIP: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SKIP SUMMARY/);
  assert.match(r.stdout, /DATABASE_URL unset/);
});

test('E2E_REQUIRE_LIVE=1 overrides E2E_ALLOW_SKIP=1', () => {
  const r = runHarness({ E2E_ALLOW_SKIP: '1', E2E_REQUIRE_LIVE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DATABASE_URL is required/);
});

test('explicit --skip-stack stays an opt-in scaffolding exit', () => {
  const r = runHarness({}, ['--skip-stack']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SKIP SUMMARY/);
});

test('harness gateway binds to loopback, not 0.0.0.0', () => {
  const text = readFileSync(script, 'utf8');
  assert.doesNotMatch(text, /HOST=0\.0\.0\.0/);
  assert.match(text, /HOST="\$\{E2E_GATEWAY_HOST:-127\.0\.0\.1\}"/);
});

test('workflow only allows a skip when the operator disabled require_live', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
  const mode = steps.find((s) => s.id === 'mode');
  assert.ok(mode, 'mode step present');
  const allowLines = mode.run.split('\n').filter((l) => l.includes('allow_skip=1'));
  assert.equal(allowLines.length, 1, 'exactly one allow_skip=1 branch');
  const beforeAllow = mode.run.slice(0, mode.run.indexOf('allow_skip=1'));
  assert.match(beforeAllow.slice(beforeAllow.lastIndexOf('if ')), /INPUT_REQUIRE_LIVE" = "false"/);
  const harness = steps.find((s) => (s.run ?? '').includes('run-e2e-backend-ready.sh'));
  assert.equal(harness.env.E2E_ALLOW_SKIP, "${{ steps.mode.outputs.allow_skip || '0' }}");
});

// UAT-ENV-007: skip gate for the shard and merged Playwright JSON reports.
// The gate module is imported per test so the harness tests above still run
// (and these fail individually) on a tree without it.
const loadGate = () => import(pathToFileURL(skipGate).href);
const GW = [
  '16f-institutions-profile-write.spec.ts',
  ['Institution gateway down', 'gateway down shows an error state instead of a green Active pill'],
];
const AX = [
  'a11y-axe.spec.ts',
  [
    'a11y — authenticated surfaces (E2E_BACKEND_READY=1)',
    'registration portal wizard — step 1 is WCAG 2.1 AA clean',
  ],
];
const PASS_A = ['08b-legal-pages.spec.ts', ['Legal pages', 'privacy page renders']];
const PASS_B = ['17c-module-a11y-smoke.spec.ts', ['17c', 'health page is axe clean']];

/** Minimal Playwright JSON report: rows are [file, titlePath, status]. */
function pwReport(rows, overrides = {}) {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const files = new Map();
  rows.forEach(([file, titles, status], i) => {
    stats[status] += 1;
    if (!files.has(file)) files.set(file, { title: file, file, specs: [], suites: [] });
    let suite = files.get(file);
    for (const t of titles.slice(0, -1)) {
      const child = { title: t, file, specs: [], suites: [] };
      suite.suites.push(child);
      suite = child;
    }
    suite.specs.push({
      title: titles.at(-1),
      file,
      line: 10 + i,
      tests: [
        {
          projectName: 'chromium',
          status,
          expectedStatus: status === 'skipped' ? 'skipped' : 'passed',
          results: [],
        },
      ],
    });
  });
  return {
    config: { rootDir: '/w/apps/web/e2e' },
    suites: [...files.values()],
    errors: [],
    stats: { ...stats, ...overrides },
  };
}
const allowlistDoc = () => JSON.parse(readFileSync(allowlistPath, 'utf8'));
async function gate(rows, options, overrides) {
  const { evaluatePlaywrightReport } = await loadGate();
  return evaluatePlaywrightReport(pwReport(rows, overrides), allowlistDoc(), options);
}

test('skip gate: zero skips passes', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...PASS_B, 'expected'],
    ],
    { mode: 'shard' },
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.counts.skipped, 0);
  assert.equal(r.executed, 2);
});

test('skip gate: only the allowlisted skips passes, in a shard and merged with all required', async () => {
  const rows = [
    [...PASS_A, 'expected'],
    [...GW, 'skipped'],
    [...AX, 'skipped'],
  ];
  for (const options of [{ mode: 'shard' }, { mode: 'merged', requireAllowlisted: true }]) {
    const r = await gate(rows, options);
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.equal(r.counts.skipped, 2);
  }
});

test('skip gate: one unlisted skip fails', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...GW, 'skipped'],
      [...PASS_B, 'skipped'],
    ],
    {
      mode: 'shard',
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1, r.errors.join('\n'));
  assert.match(r.errors[0], /unlisted skip: 17c-module-a11y-smoke\.spec\.ts:\d+ 17c > health page/);
});

test('skip gate: the same title in another spec file is not allowlisted', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      ['16f-other.spec.ts', GW[1], 'skipped'],
    ],
    {
      mode: 'shard',
    },
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /unlisted skip: 16f-other\.spec\.ts/);
});

test('skip gate: missing, unreadable or empty report fails closed', async () => {
  const { main } = await loadGate();
  const dir = mkdtempSync(join(tmpdir(), 'pw-skip-gate-'));
  const quiet = { log() {}, error() {} };
  assert.equal(main(['--report', join(dir, 'absent.json')], quiet), 1);
  writeFileSync(join(dir, 'empty.json'), '');
  assert.equal(main(['--report', join(dir, 'empty.json')], quiet), 1);
  writeFileSync(join(dir, 'nosuites.json'), '{}');
  assert.equal(main(['--report', join(dir, 'nosuites.json')], quiet), 1);
  const none = await gate([], { mode: 'shard' });
  assert.equal(none.ok, false);
  assert.match(none.errors.join('\n'), /executed no tests/);
  assert.equal(main([], quiet), 2, 'usage error without --report');
});

test('skip gate: an allowlisted test that ran and did not skip fails as stale', async () => {
  for (const status of ['expected', 'flaky']) {
    const r = await gate(
      [
        [...PASS_A, 'expected'],
        [...GW, status],
      ],
      { mode: 'shard' },
    );
    assert.equal(r.ok, false);
    assert.match(
      r.errors.join('\n'),
      /stale allowlist entry: 16f-institutions-profile-write\.spec\.ts/,
    );
  }
});

test('skip gate: an allowlisted test absent from a shard passes (sharding)', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...GW, 'skipped'],
    ],
    { mode: 'shard' },
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.match(r.notes.join('\n'), /not in this shard: a11y-axe\.spec\.ts/);
});

test('skip gate: merged run fails when an allowlisted test is missing but its file ran', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...GW, 'skipped'],
      ['a11y-axe.spec.ts', [AX[1][0], 'renamed'], 'expected'],
    ],
    { mode: 'merged' },
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /missing although a11y-axe\.spec\.ts ran/);
});

test('skip gate: merged run requires every allowlisted test only with --require-allowlisted', async () => {
  const rows = [
    [...PASS_A, 'expected'],
    [...GW, 'skipped'],
  ];
  const lenient = await gate(rows, { mode: 'merged' });
  assert.equal(lenient.ok, true, lenient.errors.join('\n'));
  const strict = await gate(rows, { mode: 'merged', requireAllowlisted: true });
  assert.equal(strict.ok, false);
  assert.match(
    strict.errors.join('\n'),
    /allowlisted test missing from the run: a11y-axe\.spec\.ts/,
  );
});

test('skip gate: unexpected tests, top-level errors and stats drift fail', async () => {
  const failed = await gate([[...PASS_A, 'unexpected']], { mode: 'shard' });
  assert.match(failed.errors.join('\n'), /1 unexpected/);
  const drift = await gate([[...PASS_A, 'expected']], { mode: 'shard' }, { skipped: 3 });
  assert.match(drift.errors.join('\n'), /stats\.skipped=3 but the report lists 0/);
  const { evaluatePlaywrightReport } = await loadGate();
  const withErr = { ...pwReport([[...PASS_A, 'expected']]), errors: [{ message: 'boom' }] };
  const r = evaluatePlaywrightReport(withErr, allowlistDoc());
  assert.match(r.errors.join('\n'), /1 top-level error/);
});

test('skip gate CLI exits 1 on an unlisted skip and 0 on the allowlisted skip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pw-skip-gate-cli-'));
  const bad = join(dir, 'bad.json');
  const good = join(dir, 'good.json');
  writeFileSync(
    bad,
    JSON.stringify(
      pwReport([
        [...PASS_A, 'skipped'],
        [...PASS_B, 'expected'],
      ]),
    ),
  );
  writeFileSync(
    good,
    JSON.stringify(
      pwReport([
        [...AX, 'skipped'],
        [...PASS_B, 'expected'],
      ]),
    ),
  );
  const rb = spawnSync(process.execPath, [skipGate, '--report', bad], { encoding: 'utf8' });
  assert.equal(rb.status, 1, rb.stdout + rb.stderr);
  assert.match(rb.stderr, /\[UAT-ENV-007\] FAIL: unlisted skip: 08b-legal-pages\.spec\.ts/);
  const rg = spawnSync(process.execPath, [skipGate, '--report', good], { encoding: 'utf8' });
  assert.equal(rg.status, 0, rg.stdout + rg.stderr);
  assert.match(rg.stdout, /mode=shard executed=1 skipped=1/);
});

test('skip allowlist holds exactly the two Q6-accepted skips, keyed by file + title', () => {
  const doc = allowlistDoc();
  assert.equal(doc.entries.length, 2);
  assert.deepEqual(
    doc.entries.map((e) => [e.file, e.title]),
    [GW, AX],
  );
  for (const e of doc.entries) {
    assert.match(e.reason, /\S/);
    assert.match(e.decision, /Q6 A/);
    assert.match(e.decision, /Q9 A/);
    // Each title segment is a literal in the spec source, so a rename shows here too.
    const source = readFileSync(join(e2eDir, e.file), 'utf8');
    for (const t of e.title) assert.ok(source.includes(`'${t}'`), `${e.file} has title '${t}'`);
  }
});

test('playwright config adds the JSON reporter when PLAYWRIGHT_JSON_OUTPUT_FILE is set', () => {
  const text = readFileSync(playwrightConfigPath, 'utf8');
  assert.match(text, /const jsonFile = process\.env\.PLAYWRIGHT_JSON_OUTPUT_FILE;/);
  assert.match(text, /\[\['json', \{ outputFile: jsonFile \}\]\]/);
  const reporterFn = text.slice(
    text.indexOf('function ciReporter'),
    text.indexOf('export default'),
  );
  assert.equal(reporterFn.match(/\.\.\.json\]/g)?.length, 3, 'every reporter branch keeps ...json');
});

test('harness runs the skip gate on a fresh shard report and fails when it fails', () => {
  const text = readFileSync(script, 'utf8');
  assert.match(text, /rm -f "\$PW_JSON_REPORT"/);
  assert.match(
    text,
    /PLAYWRIGHT_JSON_OUTPUT_FILE="\$PW_JSON_REPORT" \\\n\s+pnpm --filter @proctira\/web exec playwright test/,
  );
  assert.match(
    text,
    /assert-playwright-skips\.mjs" --mode shard --report "\$PW_JSON_REPORT"\nSKIP_GATE_EXIT=\$\?/,
  );
  assert.match(text, /if \[\[ "\$SKIP_GATE_EXIT" -ne 0 \]\]; then[\s\S]*?exit 1/);
  assert.ok(text.indexOf('rm -f "$PW_JSON_REPORT"') < text.indexOf('playwright test'));
});

test('live gate merges a JSON report and runs the merged skip gate', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const live = wf.jobs['e2e-backend-ready'];
  const merge = live.steps.find((s) => s.id === 'merge');
  assert.match(
    merge.run,
    /PLAYWRIGHT_JSON_OUTPUT_FILE="\$GITHUB_WORKSPACE\/e2e-backend-ready-merged\.json" \\\n\s+pnpm --filter @proctira\/web exec playwright merge-reports --reporter=json/,
  );
  const req = live.steps.find((s) => s.name === 'Require every shard and the merged report');
  assert.equal(req.if, 'always()');
  assert.match(req.run, /assert-playwright-skips\.mjs "\$\{GATE_ARGS\[@\]\}"/);
  assert.match(
    req.run,
    /--mode merged --report "\$GITHUB_WORKSPACE\/e2e-backend-ready-merged\.json"/,
  );
  assert.match(
    req.run,
    /if \[\[ -z "\$CUSTOM_SPECS" \]\]; then\n\s+GATE_ARGS\+=\(--require-allowlisted\)/,
  );
  assert.equal(
    req.env.CUSTOM_SPECS,
    "${{ github.event_name == 'workflow_dispatch' && inputs.specs || '' }}",
  );
  // The skip gate runs after the merge-outcome check, so a missing merge fails first.
  assert.ok(
    req.run.indexOf('MERGE_OUTCOME" != "success"') < req.run.indexOf('assert-playwright-skips'),
  );
  // --require-allowlisted is only sound because both default spec sets hold every entry.
  for (const set of ['PR_SPECS', 'NIGHTLY_SPECS']) {
    for (const e of allowlistDoc().entries) {
      assert.ok(wf.env[set].split(/\s+/).includes(`e2e/${e.file}`), `${set} has e2e/${e.file}`);
    }
  }
});
