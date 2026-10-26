/**
 * PRC-M551 — DoD baseline ratchet: the committed baseline may only shrink.
 * Run with: node --test tools/scripts/check-dod-baseline-ratchet.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareBaselines, errorFingerprints } from './check-dod-baseline-ratchet.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-dod-baseline-ratchet.mjs');

const finding = (check, file, message, severity = 'error', line = 1) => ({
  check,
  severity,
  file,
  line,
  message,
});
function baseline() {
  return {
    totals: { totalErrors: 3, totalWarnings: 1 },
    checks: [
      {
        check: 'tenant-id',
        errorCount: 2,
        findings: [
          finding('tenant-id', 'a.ts', 'missing tenantId in A'),
          finding('tenant-id', 'b.ts', 'missing tenantId in B'),
        ],
      },
      {
        check: 'api-schema',
        errorCount: 1,
        findings: [
          finding('api-schema', 'c.ts', 'no schema'),
          finding('api-schema', 'c.ts', 'warn only', 'warning'),
        ],
      },
      { check: 'table-naming', errorCount: 0, findings: [] },
    ],
  };
}
const clone = (fn) => {
  const b = baseline();
  fn(b);
  return b;
};

test('identical baseline passes', () => {
  assert.equal(compareBaselines(baseline(), baseline()).ok, true);
});

test('decrease passes and is reported', () => {
  const head = clone((b) => {
    b.totals.totalErrors = 2;
    b.checks[0].errorCount = 1;
    b.checks[0].findings.pop();
  });
  const r = compareBaselines(baseline(), head);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.notes.some((n) => /decreased: 3 -> 2/.test(n)));
});

test('line drift on an existing finding passes', () => {
  const head = clone((b) => (b.checks[0].findings[0].line = 99));
  assert.equal(compareBaselines(baseline(), head).ok, true);
});

test('totals increase fails', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => (b.totals.totalErrors = 4)),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /totalErrors increased: 3 -> 4/.test(e)));
});

test('per-check errorCount increase fails even when totals are unchanged', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => {
      b.checks[0].errorCount = 3;
      b.checks[1].errorCount = 0;
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /"tenant-id" errorCount increased: 2 -> 3/.test(e)));
});

test('new error fingerprint fails (swap one baselined error for another)', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => (b.checks[0].findings[1] = finding('tenant-id', 'z.ts', 'missing tenantId in Z'))),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /new baselined error finding .*z\.ts/.test(e)));
});

test('duplicated fingerprint (count increase) fails', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => b.checks[1].findings.push(finding('api-schema', 'c.ts', 'no schema', 'error', 7))),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /\(1 -> 2\)/.test(e)));
});

test('new warning-level findings do not trip the error ratchet', () => {
  const head = clone((b) =>
    b.checks[1].findings.push(finding('api-schema', 'd.ts', 'w', 'warning')),
  );
  assert.equal(compareBaselines(baseline(), head).ok, true);
});

test('a check present at base that disappears fails', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => b.checks.splice(2, 1)),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /"table-naming" present at base disappeared/.test(e)));
});

test('a new check that starts with errors fails', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => b.checks.push({ check: 'brand-new', errorCount: 1, findings: [] })),
  );
  assert.equal(r.ok, false);
});

test('missing head totals fails closed', () => {
  const r = compareBaselines(
    baseline(),
    clone((b) => delete b.totals),
  );
  assert.equal(r.ok, false);
});

test('errorFingerprints ignores warnings and counts duplicates', () => {
  const fp = errorFingerprints(baseline());
  assert.equal(fp.size, 3);
  assert.equal(fp.get('api-schema|c.ts|no schema'), 1);
});

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'm551-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  run('init', '-q');
  run('config', 'user.email', 'ci@example.invalid');
  run('config', 'user.name', 'ci');
  run('commit', '-q', '--allow-empty', '-m', 'root');
  mkdirSync(join(dir, 'tools/dod-checks/reports'), { recursive: true });
  const file = join(dir, 'tools/dod-checks/reports/baseline.json');
  return { dir, run, file };
}
const cli = (dir, base) =>
  spawnSync(process.execPath, [SCRIPT, '--base', base], { cwd: dir, encoding: 'utf8' });

test('CLI: increase versus base commit exits 1; decrease exits 0', () => {
  const { dir, run, file } = gitRepo();
  try {
    writeFileSync(file, JSON.stringify(baseline()));
    run('add', '.');
    run('commit', '-q', '-m', 'baseline');
    const base = run('rev-parse', 'HEAD');
    writeFileSync(file, JSON.stringify(clone((b) => (b.totals.totalErrors = 4))));
    const grew = cli(dir, base);
    assert.equal(grew.status, 1, grew.stdout);
    assert.match(grew.stderr, /may only shrink/);
    writeFileSync(
      file,
      JSON.stringify(
        clone((b) => {
          b.totals.totalErrors = 2;
          b.checks[1].errorCount = 0;
          b.checks[1].findings = [];
        }),
      ),
    );
    const shrank = cli(dir, base);
    assert.equal(shrank.status, 0, shrank.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: unresolvable base fails closed', () => {
  const { dir, file } = gitRepo();
  try {
    writeFileSync(file, JSON.stringify(baseline()));
    const r = cli(dir, 'deadbeef'.repeat(5));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not resolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: baseline absent at base is accepted only as a new head file', () => {
  const { dir, run, file } = gitRepo();
  try {
    const base = run('rev-parse', 'HEAD');
    const missing = cli(dir, base);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /head baseline missing/);
    writeFileSync(file, JSON.stringify(baseline()));
    const added = cli(dir, base);
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /new at head/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
