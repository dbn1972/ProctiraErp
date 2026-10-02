#!/usr/bin/env node
/**
 * PRC-L185 — the onboarding simulation writes its default artifact under the
 * intended absolute artifact directory (not two levels above the repo) and is
 * named as a simulation.
 * Run with: node --test tools/scripts/simulate-onboard-boards-schools.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ARTIFACT_DIR, resolveOutPath } from './simulate-onboard-boards-schools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('default output is the absolute multi-board-onboard artifact dir', () => {
  assert.equal(DEFAULT_ARTIFACT_DIR, '/opt/cursor/artifacts/multi-board-onboard');
  assert.equal(resolveOutPath({}), '/opt/cursor/artifacts/multi-board-onboard/summary.json');
  assert.ok(!resolveOutPath({}).startsWith(resolve(ROOT, '..')), 'must not be repo-relative ../..');
});

test('ARTIFACT_DIR and OUT overrides are honoured (OUT wins)', () => {
  assert.equal(resolveOutPath({ ARTIFACT_DIR: '/tmp/x' }), '/tmp/x/summary.json');
  assert.equal(resolveOutPath({ ARTIFACT_DIR: '/tmp/x', OUT: '/tmp/y.json' }), '/tmp/y.json');
  assert.equal(resolveOutPath({ ARTIFACT_DIR: '' }), `${DEFAULT_ARTIFACT_DIR}/summary.json`);
});

test('the misleading onboard-boards-schools.mjs name is retired', () => {
  assert.equal(existsSync(join(ROOT, 'tools/scripts/onboard-boards-schools.mjs')), false);
});
