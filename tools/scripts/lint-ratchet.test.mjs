/**
 * PRC-L309 — repository-wide ESLint debt ratchet (pure compare logic).
 * Run with: node --test tools/scripts/lint-ratchet.test.mjs
 * The full-repo lint itself runs nightly (lint-ratchet.yml), not here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_REL,
  EXCLUDE_RE,
  compareCounts,
  countsFromResults,
  crashedFile,
  sortedCounts,
} from './lint-ratchet.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('identical counts pass', () => {
  const r = compareCounts({ 'a.ts': 2 }, { 'a.ts': 2 });
  assert.deepEqual(r.regressions, []);
  assert.deepEqual(r.improvements, []);
});

test('an increase in a baselined file fails', () => {
  const r = compareCounts({ 'a.ts': 2 }, { 'a.ts': 3 });
  assert.deepEqual(r.regressions, [{ file: 'a.ts', before: 2, after: 3 }]);
});

test('a new erroring file fails', () => {
  const r = compareCounts({ 'a.ts': 2 }, { 'a.ts': 2, 'b.ts': 1 });
  assert.deepEqual(r.regressions, [{ file: 'b.ts', before: 0, after: 1 }]);
});

test('decreases and fixed files pass and are reported as improvements', () => {
  const r = compareCounts({ 'a.ts': 2, 'b.ts': 1 }, { 'a.ts': 1 });
  assert.deepEqual(r.regressions, []);
  assert.deepEqual(r.improvements, [
    { file: 'a.ts', before: 2, after: 1 },
    { file: 'b.ts', before: 1, after: 0 },
  ]);
});

test('ESLint results map to relative paths with errors only', () => {
  const counts = countsFromResults(
    [
      { filePath: join(ROOT, 'apps/x/a.ts'), errorCount: 2 },
      { filePath: join(ROOT, 'apps/x/b.ts'), errorCount: 0 },
    ],
    ROOT,
  );
  assert.deepEqual(counts, { 'apps/x/a.ts': 2 });
  assert.deepEqual(Object.keys(sortedCounts({ b: 1, a: 1 })), ['a', 'b']);
});

test('a crashing file is identified from ESLint stderr', () => {
  const stderr = `Oops! Something went wrong! :(\nOccurred while linting ${join(ROOT, 'apps/web/lighthouserc.cjs')}\n    at x`;
  assert.equal(
    crashedFile(stderr, ['apps/web/lighthouserc.cjs'], ROOT),
    'apps/web/lighthouserc.cjs',
  );
  assert.equal(crashedFile('other failure', ['a.ts'], ROOT), null);
});

test('exclusions match the PR lint step', () => {
  assert.ok(EXCLUDE_RE.test('apps/web/.next/x.js'));
  assert.ok(EXCLUDE_RE.test('packages/a/dist/x.js'));
  assert.ok(!EXCLUDE_RE.test('packages/a/src/x.ts'));
});

test('committed baseline is well formed', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, BASELINE_REL), 'utf8'));
  const counts = Object.values(doc.files);
  assert.ok(counts.every((n) => Number.isInteger(n) && n > 0));
  assert.equal(
    doc.totalErrors,
    counts.reduce((a, b) => a + b, 0),
  );
});
