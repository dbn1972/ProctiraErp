#!/usr/bin/env node
/**
 * PRC-M257 gate tests. Run with: node --test tools/scripts/check-action-pins.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findUnpinnedActions } from './check-action-pins.mjs';

function fixture(workflow) {
  const root = mkdtempSync(join(tmpdir(), 'action-pins-'));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/ci.yml'), workflow);
  return root;
}

test('a tag-pinned third-party action fails the gate', () => {
  const root = fixture(`jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/local
`);
  const v = findUnpinnedActions(root);
  assert.equal(v.length, 1);
  assert.equal(v[0].ref, 'actions/checkout@v4');
  assert.equal(v[0].line, 4);
});

test('SHA-pinned and local actions pass', () => {
  const root = fixture(`jobs:
  a:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - name: x
        uses: './.github/actions/local'
`);
  assert.deepEqual(findUnpinnedActions(root), []);
});

test('the repository workflows are fully pinned', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.deepEqual(findUnpinnedActions(repoRoot), []);
});
