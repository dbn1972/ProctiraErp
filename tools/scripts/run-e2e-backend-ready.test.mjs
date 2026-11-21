/**
 * PRC-L389 — run-e2e-backend-ready.sh is fail-closed by default: an unset
 * DATABASE_URL exits non-zero unless E2E_ALLOW_SKIP=1, and the harness
 * gateway binds to loopback. Only the pre-stack paths run (no DB, no build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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

// UAT-ENV-015: the shards run @proctira/web on `next dev` (the harness builds only
// api-gateway). In the nightly on 87bd3a6f (run 43423176859) 16f:57 timed out on all
// three attempts with 15-16 s requests. One worker per shard cuts runner contention;
// the UAT runner uses one worker and passes.
test('CI shards run Playwright with one worker (UAT-ENV-015)', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const shard = wf.jobs['e2e-backend-ready-shard'];
  assert.ok(shard, 'e2e-backend-ready-shard job present');
  const harness = (shard.steps ?? []).find((s) =>
    (s.run ?? '').includes('run-e2e-backend-ready.sh'),
  );
  assert.ok(harness, 'shard job runs the harness');
  assert.equal(harness.env?.PLAYWRIGHT_WORKERS, '1');
});

// Student portal screen -> API -> DB coverage (60 read, 61 privacy/tenancy).
// Both always run nightly. PR membership follows the measured shard-time rule: add 61,
// then 60, only while baseline + pending + (projected CI minutes of the added specs / 4)
// x 1.25 stays <= 16.0 at one worker. Measured: 14.83 max PR shard + 0.86 pending parent
// specs + 0.854 / 4 x 1.25 = 15.96 min with both, so both are in PR_SPECS. Removing one is
// a visible change here.
const STUDENT_SCREEN_SPECS = [
  '60-student-portal-screens-read.spec.ts',
  '61-student-portal-privacy-tenancy.spec.ts',
];
const STUDENT_SCREEN_PR_SUBSET = STUDENT_SCREEN_SPECS;
test('student portal screen specs are in the nightly set (and the measured PR subset)', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  for (const file of STUDENT_SCREEN_SPECS) {
    assert.ok(existsSync(join(e2eDir, file)), `apps/web/e2e/${file} exists`);
    assert.ok(nightly.includes(`e2e/${file}`), `NIGHTLY_SPECS has e2e/${file}`);
    assert.equal(
      pr.includes(`e2e/${file}`),
      STUDENT_SCREEN_PR_SUBSET.includes(file),
      `PR_SPECS membership of e2e/${file} matches the measured subset`,
    );
  }
});

// Transport screen -> API -> DB coverage (66 read, 67 form saves, 68 privacy/tenancy).
// Nightly only: the PR shard time budget is used by the parent and student portal
// screen specs. Moving one into PR_SPECS is a visible change here.
const TRANSPORT_SCREEN_SPECS = [
  '66-transport-screens-read.spec.ts',
  '67-transport-screens-write.spec.ts',
  '68-transport-privacy-tenancy.spec.ts',
];
test('transport screen specs run nightly and are not in PR_SPECS', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  for (const file of TRANSPORT_SCREEN_SPECS) {
    assert.ok(existsSync(join(e2eDir, file)), `apps/web/e2e/${file} exists`);
    assert.ok(nightly.includes(`e2e/${file}`), `NIGHTLY_SPECS has e2e/${file}`);
    assert.ok(!pr.includes(`e2e/${file}`), `PR_SPECS must not have e2e/${file}`);
  }
});

// Assessments + gradebook screen coverage (M4): nightly only, the PR shard time budget is
// used up. Moving them into PR_SPECS is a visible change here.
const ASSESSMENTS_GRADEBOOK_SCREEN_SPECS = [
  '112-assessments-gradebook-screens-read.spec.ts',
  '113-assessments-gradebook-screens-write.spec.ts',
  '114-assessments-gradebook-privacy-tenancy.spec.ts',
];
test('assessments gradebook screen specs run nightly and are not in PR_SPECS', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  for (const file of ASSESSMENTS_GRADEBOOK_SCREEN_SPECS) {
    assert.ok(existsSync(join(e2eDir, file)), `apps/web/e2e/${file} exists`);
    assert.ok(nightly.includes(`e2e/${file}`), `NIGHTLY_SPECS has e2e/${file}`);
    assert.ok(!pr.includes(`e2e/${file}`), `PR_SPECS must not have e2e/${file}`);
  }
  // The report-card specs need a writable artifact directory on the runner.
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
  const harness = steps.filter((s) => String(s.run ?? '').includes('run-e2e-backend-ready.sh'));
  assert.ok(harness.length > 0, 'a step runs run-e2e-backend-ready.sh');
  for (const step of harness) {
    assert.match(String(step.env?.SIS_REPORT_CARD_DIR ?? ''), /runner\.temp/, step.name);
  }
});

// Campus staff roles (H-D2, T-O1, MR-1, T-D3): warden / transport officer / registrar
// allowed paths and teacher / parent / student denials, live. Nightly only: the PR
// shard time budget is used up. Moving it into PR_SPECS is a visible change here.
test('campus staff roles spec 72 runs nightly and is not in PR_SPECS', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  const file = '72-campus-staff-roles.spec.ts';
  assert.ok(existsSync(join(e2eDir, file)), `apps/web/e2e/${file} exists`);
  assert.ok(nightly.includes(`e2e/${file}`), `NIGHTLY_SPECS has e2e/${file}`);
  assert.ok(!pr.includes(`e2e/${file}`), `PR_SPECS must not have e2e/${file}`);
});

// UAT-ENV-015: upload-artifact skips hidden files by default, so a step that lists a
// dotfile (gateway / portal logs) must set include-hidden-files or the log is dropped.
test('upload steps that list a dotfile set include-hidden-files (UAT-ENV-015)', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const uploads = Object.values(wf.jobs)
    .flatMap((j) => j.steps ?? [])
    .filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
  const withDotfile = uploads.filter((s) =>
    String(s.with?.path ?? '')
      .split('\n')
      .some((l) => /^\.[^/]/.test(l.trim())),
  );
  assert.ok(withDotfile.length >= 2, 'shard and registration uploads list dotfile logs');
  for (const s of withDotfile) {
    assert.equal(s.with['include-hidden-files'], true, `${s.name} drops its dotfile logs`);
  }
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

/**
 * Minimal Playwright JSON report: rows are [file, titlePath, status, test?];
 * the optional test object overrides fields such as expectedStatus/results.
 */
function pwReport(rows, overrides = {}) {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const files = new Map();
  rows.forEach(([file, titles, status, testFields = {}], i) => {
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
          ...testFields,
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
  const none = await gate([], { mode: 'merged' });
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
    /assert-playwright-skips\.mjs" --mode "\$SKIP_GATE_MODE" --report "\$PW_JSON_REPORT"\nSKIP_GATE_EXIT=\$\?/,
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

// Review r1: a test that fails and then calls test.skip() on a retry is
// reported as status "flaky" with expectedStatus "skipped" (Playwright 1.63).
const FAIL_THEN_SKIP = {
  expectedStatus: 'skipped',
  results: [{ status: 'failed' }, { status: 'skipped' }],
};
const FAIL_THEN_PASS = {
  expectedStatus: 'passed',
  results: [{ status: 'failed' }, { status: 'passed' }],
};

test('skip gate: a fail-then-skip retry (flaky, expectedStatus skipped) is an unlisted skip', async () => {
  const { evaluatePlaywrightReport } = await loadGate();
  const report = pwReport([
    [...PASS_A, 'expected'],
    [...PASS_B, 'flaky', FAIL_THEN_SKIP],
  ]);
  for (const mode of ['shard', 'merged']) {
    const r = evaluatePlaywrightReport(report, { entries: [] }, { mode });
    assert.equal(r.ok, false);
    assert.match(
      r.errors.join('\n'),
      /unlisted skip: 17c-module-a11y-smoke\.spec\.ts:\d+ 17c > health page is axe clean \[chromium\] \(status flaky, expected skipped\)/,
    );
    // counts and the stats reconciliation stay on the raw status.
    assert.equal(r.counts.flaky, 1);
    assert.equal(r.counts.skipped, 0);
    assert.doesNotMatch(r.errors.join('\n'), /stats\./);
  }
});

test('skip gate: an allowlisted fail-then-skip retry is a skip, not a stale entry', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...GW, 'flaky', FAIL_THEN_SKIP],
    ],
    { mode: 'shard' },
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.match(r.notes.join('\n'), /allowlisted skip: 16f-institutions-profile-write\.spec\.ts/);
});

test('skip gate: a fail-then-pass flaky test is still accepted', async () => {
  const r = await gate(
    [
      [...PASS_A, 'expected'],
      [...PASS_B, 'flaky', FAIL_THEN_PASS],
    ],
    { mode: 'shard' },
  );
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.counts.flaky, 1);
  assert.equal(r.executed, 2);
});

test('skip gate: an empty shard report passes in shard mode only', async () => {
  const shard = await gate([], { mode: 'shard' });
  assert.equal(shard.ok, true, shard.errors.join('\n'));
  assert.match(shard.notes.join('\n'), /empty shard/);
  assert.equal(shard.executed, 0);
  // A shard that lists tests but executes none still fails.
  const allSkipped = await gate([[...GW, 'skipped']], { mode: 'shard' });
  assert.equal(allSkipped.ok, false);
  assert.match(allSkipped.errors.join('\n'), /executed no tests/);
  // Stats that disagree with an empty suite list are not an empty shard.
  const drift = await gate([], { mode: 'shard' }, { expected: 1 });
  assert.equal(drift.ok, false);
  assert.match(drift.errors.join('\n'), /stats\.expected=1/);
});

test('skip gate: the merged gate still fails an empty run', async () => {
  for (const options of [{ mode: 'merged' }, { mode: 'merged', requireAllowlisted: true }]) {
    const r = await gate([], options);
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /report executed no tests \(empty run\)/);
  }
});

// Review r1 issue 4: the harness uses merged mode on an unsharded run. PATH
// stubs for pnpm/curl/psql replace the gateway and Playwright; the real gate runs.
function runStubbedHarness(fixture, shard) {
  const dir = mkdtempSync(join(tmpdir(), 'pw-harness-stub-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const stub = (name, body) =>
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  stub(
    'pnpm',
    [
      'case "$*" in',
      '  *"api-gateway build"*) exit 0 ;;',
      '  *"api-gateway start"*) exec sleep 60 ;;',
      '  *"playwright test"*) cp "$STUB_FIXTURE" "$PLAYWRIGHT_JSON_OUTPUT_FILE"; exit 0 ;;',
      '  *) echo "unexpected pnpm $*" >&2; exit 99 ;;',
      'esac',
    ].join('\n'),
  );
  // First curl is the stale-gateway probe (must fail); later health checks pass.
  stub(
    'curl',
    'n=$(cat "$STUB_CURL_COUNT" 2>/dev/null || echo 0); echo $((n+1)) >"$STUB_CURL_COUNT"; [[ "$n" -eq 0 ]] && exit 7 || exit 0',
  );
  stub('psql', 'exit 0');
  const fixturePath = join(dir, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  return runHarness({
    PATH: `${bin}:${process.env.PATH}`,
    DATABASE_URL: 'postgresql://stub/stub',
    E2E_GATEWAY_URL: 'http://127.0.0.1:59998',
    E2E_SKIP_TENANT_SEED: '1',
    E2E_SKIP_SUNRISE_SEED: '1',
    E2E_PLAYWRIGHT_JSON_REPORT: join(dir, 'report.json'),
    PLAYWRIGHT_SHARD: shard,
    STUB_FIXTURE: fixturePath,
    STUB_CURL_COUNT: join(dir, 'curl.count'),
  });
}

test('harness gates an unsharded run in merged mode and a shard in shard mode', () => {
  // a11y-axe.spec.ts ran but the allowlisted AX title is gone (renamed).
  const fixture = pwReport([
    [...GW, 'skipped'],
    ['a11y-axe.spec.ts', [AX[1][0], 'renamed'], 'expected'],
  ]);
  const local = runStubbedHarness(fixture, '');
  assert.equal(local.status, 1, local.stdout + local.stderr);
  assert.match(local.stdout, /Skip gate \(UAT-ENV-007, mode merged\)/);
  assert.match(local.stderr, /missing although a11y-axe\.spec\.ts ran/);
  const shard = runStubbedHarness(fixture, '1/4');
  assert.equal(shard.status, 0, shard.stdout + shard.stderr);
  assert.match(shard.stdout, /Skip gate \(UAT-ENV-007, mode shard\)/);
  assert.match(shard.stdout, /mode=shard executed=1 skipped=1/);
});

test('every workflow step that applies seed 006 binds proctira.allow_demo_seed=on (PRC-L461)', () => {
  const dir = dirname(workflowPath);
  const seedSteps = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => {
      const wf = yaml.parse(readFileSync(resolve(dir, f), 'utf8'));
      return Object.values(wf?.jobs ?? {})
        .flatMap((j) => j.steps ?? [])
        .filter((s) => /db\/seeds\/006_sunrise_public_school_demo\.sql/.test(s.run ?? ''))
        .map((s) => ({ file: f, name: s.name, env: s.env ?? {}, run: s.run }));
    });
  assert.ok(seedSteps.length > 0, 'e2e-backend-ready.yml applies seed 006');
  for (const s of seedSteps) {
    const bound =
      /-c proctira\.allow_demo_seed=on/.test(String(s.env.PGOPTIONS ?? '')) ||
      /PGOPTIONS=["']?-c proctira\.allow_demo_seed=on/.test(s.run);
    assert.ok(bound, `${s.file} step "${s.name}" applies 006 without proctira.allow_demo_seed=on`);
  }
});
test('safe error responses spec 73 exists and runs nightly only (PR-4)', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const file = '73-safe-error-responses.spec.ts';
  // Nightly only: the PR shard budget is used up (see the health specs below).
  assert.ok(readdirSync(e2eDir).includes(file), `apps/web/e2e/${file} exists`);
  assert.ok(
    wf.env.NIGHTLY_SPECS.split(/\s+/).includes(`e2e/${file}`),
    `NIGHTLY_SPECS has e2e/${file}`,
  );
  assert.ok(!wf.env.PR_SPECS.split(/\s+/).includes(`e2e/${file}`), `PR_SPECS lacks e2e/${file}`);
});
test('health screen specs 63-65 and 74 exist and run nightly', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const HEALTH_SPECS = [
    '63-health-screens-read.spec.ts',
    '64-health-screens-write.spec.ts',
    '65-health-privacy-phi.spec.ts',
    // FEAT-003 / PR-3 (HL-O1, HL-O3, HL-O4): new specs 72-79 are nightly-only.
    '74-health-defect-fixes.spec.ts',
  ];
  // Nightly only: the worst PR shard job already takes 17.17 min (CI run 44258213737,
  // shard 3/4), above the 16-min budget, so any of 63-65 would push it further over.
  // Move a spec here only together with PR_SPECS.
  const HEALTH_SPECS_IN_PR = [];
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  for (const f of HEALTH_SPECS) {
    assert.ok(readdirSync(e2eDir).includes(f), `apps/web/e2e/${f} exists`);
    assert.ok(nightly.includes(`e2e/${f}`), `NIGHTLY_SPECS has e2e/${f}`);
  }
  assert.deepEqual(
    HEALTH_SPECS.filter((f) => pr.includes(`e2e/${f}`)),
    HEALTH_SPECS_IN_PR,
  );
});
test('the shared E2E academic year is a rolling window around today (SP-R2)', () => {
  // A fixed 2026-04-01..2027-03-31 year made every date-relative spec (attendance
  // pastWeekdays(), calendar) fail from 2027-04-01. The seed and the fixture
  // fallback must both derive the same window from today.
  const seed = readFileSync(resolve(here, '../../tools/e2e/seed-e2e-tenants.sql'), 'utf8');
  const insert = seed.match(/INSERT INTO academic_periods[\s\S]*?'E2E-AY'[\s\S]*?;/);
  assert.ok(insert, 'seed-e2e-tenants.sql inserts the E2E-AY academic year');
  const before = insert[0].match(/CURRENT_DATE\s*-\s*(\d+)/);
  const after = insert[0].match(/CURRENT_DATE\s*\+\s*(\d+)/);
  assert.ok(before && after, 'E2E-AY start_date/end_date derive from CURRENT_DATE');
  assert.doesNotMatch(insert[0], /DATE\s*'\d{4}-\d{2}-\d{2}'/, 'E2E-AY has no fixed date literal');
  // Dates are immutable after insert (trg_academic_periods_dates_immutable, db/sql/083),
  // so the rerun path must not try to move them, and must fail loudly once a reused
  // database's window no longer covers today.
  const onConflict = insert[0].split(/ON CONFLICT/)[1] ?? '';
  assert.doesNotMatch(onConflict, /start_date|end_date/, 'ON CONFLICT leaves the dates alone');
  assert.match(
    seed,
    /start_date <= CURRENT_DATE[\s\S]*end_date >= CURRENT_DATE[\s\S]*RAISE EXCEPTION/,
    'seed fails when an existing E2E-AY no longer covers CURRENT_DATE',
  );

  const fixture = readFileSync(resolve(e2eDir, 'fixtures/test-data.ts'), 'utf8');
  const fn = fixture.match(/export async function ensureSharedAcademicYear[\s\S]*?\n}\n/);
  assert.ok(fn, 'fixtures/test-data.ts defines ensureSharedAcademicYear');
  assert.doesNotMatch(fn[0], /'\d{4}-\d{2}-\d{2}'/, 'fallback year has no fixed date literal');
  assert.match(fn[0], /rollingAcademicYearWindow\(\)/, 'fallback uses rollingAcademicYearWindow()');
  assert.equal(
    fixture.match(/E2E_AY_DAYS_BEFORE = (\d+);/)?.[1],
    before[1],
    'fixture window starts the same number of days before today as the seed',
  );
  assert.equal(
    fixture.match(/E2E_AY_DAYS_AFTER = (\d+);/)?.[1],
    after[1],
    'fixture window ends the same number of days after today as the seed',
  );
});
test('hostel screen specs 69-71 exist and run nightly', () => {
  const wf = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const HOSTEL_SPECS = [
    '69-hostel-screens-read.spec.ts',
    '70-hostel-screens-write.spec.ts',
    '71-hostel-privacy-tenancy.spec.ts',
  ];
  // Nightly only: the PR shard budget is used up (the health PR measured 21.3 min with
  // 63-65 in the PR set, against a 16-min budget). Move a spec here only together with
  // PR_SPECS.
  const HOSTEL_SPECS_IN_PR = [];
  const nightly = wf.env.NIGHTLY_SPECS.split(/\s+/);
  const pr = wf.env.PR_SPECS.split(/\s+/);
  for (const f of HOSTEL_SPECS) {
    assert.ok(readdirSync(e2eDir).includes(f), `apps/web/e2e/${f} exists`);
    assert.ok(nightly.includes(`e2e/${f}`), `NIGHTLY_SPECS has e2e/${f}`);
  }
  assert.deepEqual(
    HOSTEL_SPECS.filter((f) => pr.includes(`e2e/${f}`)),
    HOSTEL_SPECS_IN_PR,
  );
});
