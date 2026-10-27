/**
 * PRC-L110 — superseded PR runs must be cancellable.
 * Run with: node --test tools/scripts/check-workflow-concurrency.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkConcurrency,
  concurrencyBlocks,
  groupIsPrSafe,
  hasPullRequestTrigger,
} from './check-workflow-concurrency.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'check-workflow-concurrency.mjs');
const SAFE =
  "${{ github.workflow }}-${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || format('{0}-{1}', github.ref, github.sha) }}";
const BASE_CI =
  '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}-${{ github.sha }}';
const wf = (group, cancel = 'true', on = 'on:\n  pull_request:\n  push:\n') =>
  `name: X\n${on}concurrency:\n  # comment\n  group: ${group}\n  cancel-in-progress: ${cancel}\njobs: {}\n`;

test('base ci.yml group shape (unconditional github.sha) fails', () => {
  assert.equal(groupIsPrSafe(BASE_CI), false);
  const errors = checkConcurrency({ 'ci.yml': wf(BASE_CI) });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ci\.yml:5 concurrency group uses github\.sha/);
});

test('PR-number-first group passes', () => {
  assert.equal(groupIsPrSafe(SAFE), true);
  assert.deepEqual(checkConcurrency({ 'ci.yml': wf(SAFE) }), []);
});

test('sha before the PR-first form still fails', () => {
  const bad = `x-\${{ github.sha }}-\${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || github.ref }}`;
  assert.equal(groupIsPrSafe(bad), false);
});

test('groups without sha, non-cancelling groups and non-PR workflows are out of scope', () => {
  assert.deepEqual(checkConcurrency({ 'a.yml': wf('a-${{ github.ref }}') }), []);
  assert.deepEqual(checkConcurrency({ 'b.yml': wf(BASE_CI, 'false') }), []);
  assert.deepEqual(checkConcurrency({ 'c.yml': wf(BASE_CI, 'true', 'on:\n  push:\n') }), []);
});

test('trigger detection handles inline and block forms', () => {
  assert.equal(hasPullRequestTrigger('on: [push, pull_request]\n'), true);
  assert.equal(hasPullRequestTrigger('on:\n  pull_request:\n    paths: [a]\n'), true);
  assert.equal(hasPullRequestTrigger('on:\n  push:\njobs:\n  pull_request:\n'), false);
});

test('job-level concurrency blocks are checked too', () => {
  const text = `on:\n  pull_request:\njobs:\n  a:\n    concurrency:\n      group: ${BASE_CI}\n      cancel-in-progress: true\n`;
  assert.equal(concurrencyBlocks(text).length, 1);
  assert.equal(checkConcurrency({ 'j.yml': text }).length, 1);
});

test('repository workflows pass (ci, e2e-backend-ready, security-scans fixed)', () => {
  for (const f of ['ci.yml', 'e2e-backend-ready.yml', 'security-scans.yml']) {
    const text = readFileSync(join(HERE, '../../.github/workflows', f), 'utf8');
    assert.ok(text.includes("format('pr-{0}', github.event.pull_request.number)"), f);
  }
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
