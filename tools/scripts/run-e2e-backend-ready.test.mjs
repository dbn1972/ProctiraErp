/**
 * PRC-L389 — run-e2e-backend-ready.sh is fail-closed by default: an unset
 * DATABASE_URL exits non-zero unless E2E_ALLOW_SKIP=1, and the harness
 * gateway binds to loopback. Only the pre-stack paths run (no DB, no build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'run-e2e-backend-ready.sh');
const workflowPath = resolve(here, '../../.github/workflows/e2e-backend-ready.yml');

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
