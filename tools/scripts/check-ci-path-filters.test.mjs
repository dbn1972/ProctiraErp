#!/usr/bin/env node
/**
 * Unit tests for W1-OPS-05 CI path-filter matrix gate.
 * Run with: node --test tools/scripts/check-ci-path-filters.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PATH_FILTER_MATRIX,
  checkCiPathFilters,
  evaluateJobIfs,
  evaluatePathFilterMatrix,
  parseDetectChangeFilters,
  parseFilterBody,
} from './check-ci-path-filters.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CI_YAML = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

test('parseFilterBody maps dorny buckets to path globs', () => {
  const body = `
            packages:
              - 'packages/**'
            backend:
              - 'db/**'
              - 'tools/scripts/**'
            shared:
              - 'docs/**'
              - 'tools/**'
            infra:
              - 'infrastructure/**'
`;
  const buckets = parseFilterBody(body);
  assert.deepEqual(buckets.backend, ['db/**', 'tools/scripts/**']);
  assert.deepEqual(buckets.shared, ['docs/**', 'tools/**']);
  assert.deepEqual(buckets.infra, ['infrastructure/**']);
});

test('evaluatePathFilterMatrix fails when db/** drops from backend', () => {
  const buckets = {
    backend: ['packages/backend/**'],
    shared: ['db/**', 'tools/**', 'docs/**'],
    infra: ['infrastructure/**'],
  };
  const report = evaluatePathFilterMatrix(buckets);
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((m) => m.path === 'db/**' && m.bucket === 'backend'));
});

test('on-disk ci.yml satisfies the W1-OPS-05 path-filter matrix', () => {
  const result = checkCiPathFilters(CI_YAML);
  assert.equal(result.ok, true, JSON.stringify(result.matrix.missing));
  assert.equal(result.jobIfs.ok, true, JSON.stringify(result.jobIfs.missing));
  const buckets = parseDetectChangeFilters(CI_YAML);
  for (const row of PATH_FILTER_MATRIX) {
    for (const bucket of row.buckets) {
      assert.ok(
        (buckets[bucket] ?? []).includes(row.path),
        `${row.path} missing from ${bucket}`,
      );
    }
  }
});

test('job ifs require infra-changed for integration and aggregate env', () => {
  const report = evaluateJobIfs(CI_YAML);
  assert.equal(report.ok, true, JSON.stringify(report.missing));
});

test('matrix documents db, tools, docs, and infrastructure rows', () => {
  const paths = PATH_FILTER_MATRIX.map((r) => r.path);
  assert.ok(paths.includes('db/**'));
  assert.ok(paths.includes('tools/**'));
  assert.ok(paths.includes('docs/**'));
  assert.ok(paths.includes('infrastructure/**'));
});
