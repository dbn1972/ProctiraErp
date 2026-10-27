/**
 * PRC-L108 — scheduled workflows must be registered with the watchdog.
 * Run with: node --test tools/scripts/check-scheduled-gates-registry.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRegistry, hasScheduleTrigger } from './check-scheduled-gates-registry.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-scheduled-gates-registry.mjs');
const SCHEDULED =
  "name: X\non:\n  push:\n    branches: [main]\n  schedule:\n    - cron: '0 1 * * *'\njobs: {}\n";
const UNSCHEDULED =
  'name: Y\non:\n  pull_request:\njobs:\n  schedule:\n    runs-on: ubuntu-latest\n';

test('hasScheduleTrigger only matches schedule under on:', () => {
  assert.equal(hasScheduleTrigger(SCHEDULED), true);
  assert.equal(hasScheduleTrigger(UNSCHEDULED), false);
  assert.equal(hasScheduleTrigger('on: [push]\n'), false);
});

test('unregistered scheduled workflow fails', () => {
  const errors = checkRegistry({ gates: [] }, { 'x.yml': SCHEDULED });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /x\.yml has a schedule: trigger but is not in/);
});

test('registered or exempt scheduled workflows pass', () => {
  const workflows = { 'x.yml': SCHEDULED, 'w.yml': SCHEDULED, 'y.yml': UNSCHEDULED };
  const registry = {
    gates: [{ workflow: 'x.yml', maxAgeHours: 48 }],
    exempt: [{ workflow: 'w.yml', reason: 'watchdog' }],
  };
  assert.deepEqual(checkRegistry(registry, workflows), []);
});

test('entry naming a missing or unscheduled workflow fails', () => {
  const errors = checkRegistry(
    {
      gates: [
        { workflow: 'gone.yml', maxAgeHours: 48 },
        { workflow: 'y.yml', maxAgeHours: 48 },
      ],
    },
    { 'y.yml': UNSCHEDULED },
  );
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /gone\.yml, which does not exist/);
  assert.match(errors.join('\n'), /y\.yml, which has no schedule: trigger/);
});

test('shape errors: bad maxAgeHours, exempt without reason, duplicates', () => {
  const errors = checkRegistry(
    {
      gates: [
        { workflow: 'x.yml', maxAgeHours: 0 },
        { workflow: 'x.yml', maxAgeHours: 4 },
      ],
      exempt: [{ workflow: 'w.yml' }],
    },
    { 'x.yml': SCHEDULED, 'w.yml': SCHEDULED },
  );
  assert.match(errors.join('\n'), /maxAgeHours must be a positive integer/);
  assert.match(errors.join('\n'), /exempt entries need a reason/);
  assert.match(errors.join('\n'), /duplicate registry entry: x\.yml/);
});

test('CLI fails when the registry file is missing (base state)', () => {
  const root = mkdtempSync(join(tmpdir(), 'sched-reg-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/x.yml'), SCHEDULED);
    const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing tools\/scripts\/scheduled-gates\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository registry covers every scheduled workflow', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS/);
});
