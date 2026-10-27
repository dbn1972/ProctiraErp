/**
 * PRC-M431 — evidence pack freshness + GitHub run verification.
 * Run with: node --test tools/scripts/verify-evidence-run.test.mjs
 * No network: fetchRun is injected.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_AGE_DAYS_CAP,
  evaluateRun,
  parseRunUrl,
  parseTimestamp,
  resolveMaxAgeDays,
  verifyPack,
} from './verify-evidence-run.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'verify-evidence-run.mjs');
const REPO = 'dbn1972/ProctiraErp';
const WF = '.github/workflows/restore-drill.yml';
const URL_OK = `https://github.com/${REPO}/actions/runs/34683877155`;
const NOW = Date.parse('2026-10-26T00:00:00Z');
const goodRun = () => ({
  id: 34683877155,
  conclusion: 'success',
  path: WF,
  created_at: '2026-09-12T08:40:35Z',
  repository: { full_name: REPO },
});
const base = (over = {}) => ({
  runUrl: URL_OK,
  run: goodRun(),
  expectedWorkflowPath: WF,
  repo: REPO,
  packTimestamp: '20260912T153859Z',
  now: NOW,
  maxAgeDays: 90,
  ...over,
});
const pack = (over = {}) => ({
  timestamp: '20260912T153859Z',
  ciCrossRef: { workflow: WF, latestSuccessfulRun: { url: URL_OK } },
  ...over,
});

test('parseRunUrl accepts only github.com run URLs', () => {
  assert.deepEqual(parseRunUrl(URL_OK), {
    owner: 'dbn1972',
    repo: 'ProctiraErp',
    id: '34683877155',
  });
  assert.equal(parseRunUrl('https://evil.example/github.com/x/actions/runs/1'), null);
  assert.equal(parseRunUrl('http://github.com/a/b/actions/runs/1'), null);
  assert.equal(parseRunUrl('https://github.com/a/b/actions/runs/1?x=1'), null);
});

test('parseTimestamp handles ISO and compact forms', () => {
  assert.equal(parseTimestamp('20260912T153859Z'), Date.parse('2026-09-12T15:38:59Z'));
  assert.equal(parseTimestamp('2026-09-14T01:25:00Z'), Date.parse('2026-09-14T01:25:00Z'));
  assert.ok(Number.isNaN(parseTimestamp('yesterday')));
});

test('EVIDENCE_MAX_AGE_DAYS can only lower the window', () => {
  assert.equal(resolveMaxAgeDays(undefined), MAX_AGE_DAYS_CAP);
  assert.equal(resolveMaxAgeDays(''), MAX_AGE_DAYS_CAP);
  assert.equal(resolveMaxAgeDays('30'), 30);
  assert.equal(resolveMaxAgeDays('3650'), MAX_AGE_DAYS_CAP);
  assert.throws(() => resolveMaxAgeDays('0'));
  assert.throws(() => resolveMaxAgeDays('-5'));
  assert.throws(() => resolveMaxAgeDays('ninety'));
});

test('tip-shaped pack + successful run passes', () => {
  assert.deepEqual(evaluateRun(base()), { ok: true, errors: [] });
});

for (const [name, over, pattern] of [
  ['stale pack', { packTimestamp: '20260601T000000Z' }, /pack is stale/],
  ['future pack', { packTimestamp: '20261201T000000Z' }, /in the future/],
  ['missing pack timestamp', { packTimestamp: '' }, /timestamp missing/],
  [
    'foreign repo URL',
    { runUrl: 'https://github.com/evil/fork/actions/runs/34683877155' },
    /belongs to evil\/fork/,
  ],
  ['failed run', { run: { ...goodRun(), conclusion: 'failure' } }, /conclusion is "failure"/],
  ['in-progress run', { run: { ...goodRun(), conclusion: null } }, /conclusion is null/],
  [
    'wrong workflow path',
    { run: { ...goodRun(), path: '.github/workflows/ci.yml' } },
    /workflow path is/,
  ],
  [
    'run far from pack',
    { run: { ...goodRun(), created_at: '2026-08-01T00:00:00Z' } },
    /more than 7 days/,
  ],
  ['run id mismatch', { run: { ...goodRun(), id: 1 } }, /does not match URL id/],
  [
    'run repository mismatch',
    { run: { ...goodRun(), repository: { full_name: 'evil/fork' } } },
    /run repository evil\/fork/,
  ],
  ['missing run', { run: null }, /run metadata missing/],
]) {
  test(`fails: ${name}`, () => {
    const r = evaluateRun(base(over));
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => pattern.test(e)),
      r.errors.join('\n'),
    );
  });
}

test('verifyPack: CI without token fails closed', async () => {
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { CI: 'true' },
    now: NOW,
    fetchRun: () => assert.fail('must not fetch without token'),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /GH_TOKEN\/GITHUB_TOKEN missing/.test(e)));
});

test('verifyPack: EVIDENCE_VERIFY_RUN=1 without token fails closed', async () => {
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { EVIDENCE_VERIFY_RUN: '1' },
    now: NOW,
    fetchRun: () => assert.fail('must not fetch without token'),
  });
  assert.equal(r.ok, false);
});

test('verifyPack: CI without repository fails closed', async () => {
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: '',
    env: { CI: 'true', GH_TOKEN: 't' },
    now: NOW,
    fetchRun: async () => goodRun(),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /GITHUB_REPOSITORY/.test(e)));
});

test('verifyPack: local run without token is explicit UNVERIFIED but still checks freshness', async () => {
  const ok = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: {},
    now: NOW,
    fetchRun: () => assert.fail('must not fetch without token'),
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.lines.some((l) => /UNVERIFIED \(no token\)/.test(l)));
  const stale = await verifyPack({
    pack: pack({ timestamp: '20200101T000000Z' }),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: {},
    now: NOW,
    fetchRun: () => assert.fail('must not fetch without token'),
  });
  assert.equal(stale.ok, false);
});

test('verifyPack: token present verifies the fetched run', async () => {
  let fetched;
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { CI: 'true', GH_TOKEN: 't' },
    now: NOW,
    fetchRun: async (args) => {
      fetched = args;
      return goodRun();
    },
  });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(fetched.id, '34683877155');
  assert.equal(fetched.token, 't');
  const bad = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { CI: 'true', GH_TOKEN: 't' },
    now: NOW,
    fetchRun: async () => ({ ...goodRun(), conclusion: 'failure' }),
  });
  assert.equal(bad.ok, false);
});

test('verifyPack: fetch error fails closed', async () => {
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { CI: 'true', GH_TOKEN: 't' },
    now: NOW,
    fetchRun: async () => {
      throw new Error('HTTP 404');
    },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /could not fetch run/.test(e)));
});

test('verifyPack: declared ciCrossRef.workflow must match the expected workflow', async () => {
  const r = await verifyPack({
    pack: pack({
      ciCrossRef: { workflow: '.github/workflows/ci.yml', latestSuccessfulRun: { url: URL_OK } },
    }),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: {},
    now: NOW,
    fetchRun: () => assert.fail('must not fetch without token'),
  });
  assert.equal(r.ok, false);
});

test('verifyPack: invalid EVIDENCE_MAX_AGE_DAYS fails closed', async () => {
  const r = await verifyPack({
    pack: pack(),
    expectedWorkflowPath: WF,
    repo: REPO,
    env: { EVIDENCE_MAX_AGE_DAYS: 'forever' },
    now: NOW,
    fetchRun: () => assert.fail('unreachable'),
  });
  assert.equal(r.ok, false);
});

test('CLI exits 1 in CI without a token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm431-'));
  try {
    const file = join(dir, 'pack.json');
    writeFileSync(file, JSON.stringify(pack()));
    const r = spawnSync(process.execPath, [SCRIPT, '--pack', file, '--workflow', WF], {
      encoding: 'utf8',
      cwd: resolve(dirname(SCRIPT), '../..'),
      env: { PATH: process.env.PATH, CI: 'true', GITHUB_REPOSITORY: REPO },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /GH_TOKEN\/GITHUB_TOKEN missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
