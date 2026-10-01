#!/usr/bin/env node
/**
 * PRC-L184 — `pnpm dod:check` / `dod:test` must run the supported
 * tools/dod-checks aggregator, and the retired legacy script must not return
 * (nor a non-blocking "compat" step for it in definition-of-done.yml).
 * Run with: node --test tools/scripts/dod-script-wiring.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('dod:check and dod:test alias the supported tools/dod-checks scripts', () => {
  assert.equal(pkg.scripts['dod:check'], 'pnpm run check:dod');
  assert.equal(pkg.scripts['dod:test'], 'pnpm run check:dod:test');
  assert.match(pkg.scripts['check:dod'], /--filter @proctira\/dod-checks check$/);
  assert.match(pkg.scripts['check:dod:test'], /--filter @proctira\/dod-checks test$/);
});

test('legacy definition-of-done-checks.mjs stays retired', () => {
  assert.equal(existsSync(join(ROOT, 'tools/scripts/definition-of-done-checks.mjs')), false);
  for (const cmd of Object.values(pkg.scripts)) {
    assert.doesNotMatch(cmd, /definition-of-done-checks/);
  }
});

test('definition-of-done.yml runs the supported checker blocking, no soft legacy step', () => {
  const wf = parse(readFileSync(join(ROOT, '.github/workflows/definition-of-done.yml'), 'utf8'));
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
  const dod = steps.filter((s) => /pnpm run (check:dod|dod:check)\s*$/.test(s.run ?? ''));
  assert.ok(dod.length > 0, 'check:dod step missing');
  for (const s of dod) assert.notEqual(s['continue-on-error'], true, s.name);
  assert.ok(!steps.some((s) => /definition-of-done-checks|dod:check/.test(s.run ?? '')));
});
