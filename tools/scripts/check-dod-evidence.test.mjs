/**
 * PRC-L387 — check-dod-evidence.sh must pass on the committed evidence pack
 * and fail when the pack is absent or incoherent (missing marker fields).
 *
 * Runs a copy of the script in a temp repo mirror so the committed evidence
 * is never modified. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = 'docs/audits/evidence';
const latestPack = readdirSync(join(ROOT, EVIDENCE))
  .filter((n) => /^dod-gate-.*\.json$/.test(n))
  .sort()
  .at(-1);
const PACK = JSON.parse(readFileSync(join(ROOT, EVIDENCE, latestPack), 'utf8'));

// PRC-M431: hermetic env — no token, not CI — so the run check is the explicit
// UNVERIFIED path and only offline freshness/URL checks apply.
const OFFLINE_ENV = {
  ...process.env,
  CI: '',
  EVIDENCE_VERIFY_RUN: '',
  GH_TOKEN: '',
  GITHUB_TOKEN: '',
  GITHUB_REPOSITORY: 'dbn1972/ProctiraErp',
  EVIDENCE_MAX_AGE_DAYS: '',
};
function runInMirror({ pack = PACK, includePack = true, env = OFFLINE_ENV } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'l387-dod-'));
  try {
    for (const sub of ['tools/scripts', 'tools/dod-checks/reports', EVIDENCE]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    for (const rel of [
      'tools/scripts/check-dod-evidence.sh',
      'tools/scripts/assert-dod-evidence.mjs',
      'tools/scripts/verify-evidence-run.mjs',
      'tools/dod-checks/reports/baseline.json',
    ]) {
      copyFileSync(join(ROOT, rel), join(dir, rel));
    }
    if (includePack) {
      writeFileSync(join(dir, EVIDENCE, latestPack), JSON.stringify(pack));
    }
    return spawnSync('bash', [join(dir, 'tools/scripts/check-dod-evidence.sh')], {
      encoding: 'utf8',
      env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mutated = (fn) => {
  const copy = structuredClone(PACK);
  fn(copy);
  return copy;
};

test('committed baseline + latest tip pack pass', () => {
  const r = runInMirror();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-dod-evidence: PASS/);
});
test('PRC-M431 offline run without token prints an explicit UNVERIFIED line', () => {
  const r = runInMirror();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /UNVERIFIED \(no token\)/);
});
test('PRC-M431 stale pack fails the freshness window', () => {
  const r = runInMirror({ pack: mutated((p) => (p.recordedAt = '2020-01-01T00:00:00Z')) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pack is stale/);
});
test('PRC-M431 foreign-repo run URL fails', () => {
  const r = runInMirror({
    pack: mutated(
      (p) => (p.ciCrossRef.latestSuccessfulRun.url = 'https://github.com/evil/fork/actions/runs/1'),
    ),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expected dbn1972\/ProctiraErp/);
});
test('PRC-M431 malformed run URL (substring match only) fails', () => {
  const r = runInMirror({
    pack: mutated(
      (p) =>
        (p.ciCrossRef.latestSuccessfulRun.url = 'https://evil.example/github.com/actions/runs/1'),
    ),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run URL must be https:\/\/github\.com/);
});
test('PRC-M431 CI without a token fails closed', () => {
  const r = runInMirror({ env: { ...OFFLINE_ENV, CI: 'true' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GH_TOKEN\/GITHUB_TOKEN missing/);
});

test('no dod-gate-*.json tip pack fails', () => {
  const r = runInMirror({ includePack: false });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no docs\/audits\/evidence\/dod-gate-\*\.json tip pack/);
});

for (const [name, fn, pattern] of [
  ['ok=false', (p) => (p.ok = false), /ok must be true/],
  ['wrong gap marker', (p) => (p.gap = 'W3-D5'), /gap must be W3-D6/],
  ['missing gate.script', (p) => delete p.gate.script, /gate\.script/],
  ['six required checks', (p) => (p.gate.requiredChecks = 6), /requiredChecks must be 7/],
  ['missing checksPresent', (p) => delete p.baselineSnapshot.checksPresent, /checksPresent/],
  [
    'missing CI run URL',
    (p) => {
      delete p.ciCrossRef;
      delete p.runUrl;
    },
    /latestSuccessfulRun/,
  ],
]) {
  test(`incoherent pack fails: ${name}`, () => {
    const r = runInMirror({ pack: mutated(fn) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, pattern);
  });
}
