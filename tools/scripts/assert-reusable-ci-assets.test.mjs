#!/usr/bin/env node
/**
 * Unit tests for W1-OPS-24 reusable CI asset wiring gate.
 * Run with: node --test tools/scripts/assert-reusable-ci-assets.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { evaluateReusableCiAssets } from './assert-reusable-ci-assets.mjs';

function fixture(partial = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reusable-ci-assets-'));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  mkdirSync(join(root, '.github/actions/setup-node-pnpm'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });

  writeFileSync(
    join(root, '.github/workflows/reusable-setup.yml'),
    `name: Reusable Setup
on:
  workflow_call:
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-node-pnpm
`,
  );
  writeFileSync(
    join(root, '.github/actions/setup-node-pnpm/action.yml'),
    `name: Setup Node + pnpm
runs:
  using: composite
  steps:
    - run: echo ok
      shell: bash
`,
  );
  writeFileSync(join(root, 'tools/scripts/validate-observability.mjs'), 'console.log("ok")\n');

  if (partial.caller !== false) {
    writeFileSync(
      join(root, '.github/workflows/actionlint.yml'),
      `jobs:
  reusable-setup:
    uses: ./.github/workflows/reusable-setup.yml
`,
    );
  }

  if (partial.obsCaller !== false) {
    writeFileSync(
      join(root, '.github/workflows/observability-config.yml'),
      `jobs:
  validate:
    steps:
      - run: node tools/scripts/validate-observability.mjs
`,
    );
  }

  if (partial.dropActionUser) {
    writeFileSync(
      join(root, '.github/workflows/reusable-setup.yml'),
      `name: Reusable Setup
on:
  workflow_call:
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: echo bare
`,
    );
  }

  return root;
}

test('passes when reusable-setup, composite, and validate-observability are wired', () => {
  const root = fixture();
  const report = evaluateReusableCiAssets(root);
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.ok(report.evidence.reusableSetupCallers.includes('.github/workflows/actionlint.yml'));
  assert.ok(report.evidence.setupActionUsers.includes('.github/workflows/reusable-setup.yml'));
  assert.ok(
    report.evidence.validateObservabilityUsers.includes(
      '.github/workflows/observability-config.yml',
    ),
  );
});

test('fails when reusable-setup has no callers', () => {
  const root = fixture({ caller: false });
  const report = evaluateReusableCiAssets(root);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('reusable-setup.yml')));
});

test('fails when validate-observability is unwired', () => {
  const root = fixture({ obsCaller: false });
  const report = evaluateReusableCiAssets(root);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('validate-observability.mjs')));
});

test('fails when setup-node-pnpm composite is unused', () => {
  const root = fixture({ dropActionUser: true });
  const report = evaluateReusableCiAssets(root);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('setup-node-pnpm')));
});
