#!/usr/bin/env node
/**
 * Unit tests for W3-TEST-04 coverage gate.
 * Run with: node --test tools/scripts/assert-coverage-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  aggregateCoverage,
  aggregateFromCoverageFinal,
  evaluateCoverage,
} from './assert-coverage-gate.mjs';

test('aggregateCoverage computes weighted percentages', () => {
  const summary = {
    'a.ts': {
      lines: { total: 100, covered: 50, skipped: 0, pct: 50 },
      statements: { total: 100, covered: 50, skipped: 0, pct: 50 },
      functions: { total: 10, covered: 5, skipped: 0, pct: 50 },
      branches: { total: 20, covered: 4, skipped: 0, pct: 20 },
    },
    'b.ts': {
      lines: { total: 100, covered: 100, skipped: 0, pct: 100 },
      statements: { total: 100, covered: 100, skipped: 0, pct: 100 },
      functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
      branches: { total: 20, covered: 20, skipped: 0, pct: 100 },
    },
  };
  const agg = aggregateCoverage(summary);
  assert.equal(agg.pct.lines, 75);
  assert.equal(agg.pct.branches, 60);
});

test('evaluateCoverage fails closed when CI requires artifacts but none exist', () => {
  const result = evaluateCoverage({
    artifactPaths: [],
    summaries: [],
    baseline: { requireArtifacts: true, globalMinimum: { lines: 1 } },
    env: { CI: 'true', REQUIRE_COVERAGE_GATE: '1' },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /No coverage/i);
});

test('aggregateFromCoverageFinal computes statement coverage', () => {
  const finalMap = {
    'a.ts': { s: { 0: 1, 1: 0, 2: 1, 3: 0, 4: 1 }, f: { 0: 1, 1: 0 }, b: { 0: [1, 0] } },
  };
  const agg = aggregateFromCoverageFinal(finalMap);
  assert.equal(agg.pct.statements, 60);
  assert.equal(agg.pct.functions, 50);
});

test('evaluateCoverage passes when aggregate exceeds floors', () => {
  const summary = {
    'x.ts': {
      lines: { total: 100, covered: 20, skipped: 0, pct: 20 },
      statements: { total: 100, covered: 20, skipped: 0, pct: 20 },
      functions: { total: 10, covered: 2, skipped: 0, pct: 20 },
      branches: { total: 10, covered: 2, skipped: 0, pct: 20 },
    },
  };
  const result = evaluateCoverage({
    artifactPaths: ['/tmp/coverage-summary.json'],
    aggregates: [aggregateCoverage(summary)],
    baseline: {
      requireArtifacts: true,
      globalMinimum: { lines: 5, statements: 5, functions: 5, branches: 3 },
    },
    env: { CI: 'true' },
  });
  assert.equal(result.ok, true);
});

test('evaluateCoverage still fails closed when the executed-task count is absent', () => {
  // No signal from the runner means we cannot prove "nothing to cover", so the
  // strict reading must stand.
  const result = evaluateCoverage({
    artifactPaths: [],
    aggregates: [],
    baseline: { requireArtifacts: true, globalMinimum: { lines: 1 } },
    env: { CI: 'true', REQUIRE_COVERAGE_GATE: '1' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.aggregate, null);
});

test('evaluateCoverage fails closed when tests ran but produced no coverage', () => {
  const result = evaluateCoverage({
    artifactPaths: [],
    aggregates: [],
    baseline: { requireArtifacts: true, globalMinimum: { lines: 1 } },
    env: { CI: 'true', REQUIRE_COVERAGE_GATE: '1', COVERAGE_GATE_EXECUTED_TASKS: '1' },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /No coverage/i);
});

test('evaluateCoverage is satisfied when the affected filter ran no test tasks', () => {
  const result = evaluateCoverage({
    artifactPaths: [],
    aggregates: [],
    baseline: { requireArtifacts: true, globalMinimum: { lines: 1 } },
    env: { CI: 'true', REQUIRE_COVERAGE_GATE: '1', COVERAGE_GATE_EXECUTED_TASKS: '0' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.noAffectedTestTasks, true);
  assert.deepEqual(result.errors, []);
});

test('main reports the no-artifacts reason instead of throwing on a null aggregate', async () => {
  const { main } = await import('./assert-coverage-gate.mjs');
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(String(message));
  try {
    // An empty directory yields no artifacts; with no executed-task signal the
    // gate must exit 1 with its message rather than raise a TypeError.
    const code = main([mkdtempSync(join(tmpdir(), 'coverage-gate-'))], {
      CI: 'true',
      REQUIRE_COVERAGE_GATE: '1',
    });
    assert.equal(code, 1);
    assert.match(errors.join(' '), /No coverage artifacts found/i);
  } finally {
    console.error = originalError;
  }
});
