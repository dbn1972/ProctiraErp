#!/usr/bin/env node
/**
 * Unit tests for the same-SHA CI gate (W1-OPS-23).
 * Run with: node --test tools/scripts/require-same-sha-ci.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateSameShaCi } from './require-same-sha-ci.mjs';

test('fail closed when no proof exists (missing)', () => {
  const report = evaluateSameShaCi({ workflowRuns: [], checkRuns: [] });
  assert.equal(report.ok, false);
  assert.match(report.failures[0].reason, /missing/);
});

test('pass via successful CI workflow_run on same SHA', () => {
  const report = evaluateSameShaCi({
    workflowRuns: [
      { id: 1, name: 'CI', status: 'completed', conclusion: 'failure' },
      { id: 2, name: 'CI', status: 'completed', conclusion: 'success' },
    ],
  });
  assert.equal(report.ok, true);
  assert.equal(report.source, 'workflow_run');
  assert.equal(report.evidence[0].id, 2);
});

test('ignore non-CI workflows even when successful', () => {
  const report = evaluateSameShaCi({
    workflowRuns: [
      { id: 9, name: 'Release', status: 'completed', conclusion: 'success' },
    ],
  });
  assert.equal(report.ok, false);
});

test('fail closed when CI only failed/cancelled/in-progress', () => {
  const report = evaluateSameShaCi({
    workflowRuns: [
      { id: 1, name: 'CI', status: 'completed', conclusion: 'failure' },
      { id: 2, name: 'CI', status: 'completed', conclusion: 'cancelled' },
      { id: 3, name: 'CI', status: 'in_progress', conclusion: null },
    ],
  });
  assert.equal(report.ok, false);
  assert.match(report.failures[0].reason, /none concluded success/);
});

test('pass via CI Aggregate check_run when workflow_runs absent', () => {
  const report = evaluateSameShaCi({
    workflowRuns: [],
    checkRuns: [
      { id: 10, name: 'Lint', status: 'completed', conclusion: 'success' },
      {
        id: 11,
        name: 'CI Aggregate (Required)',
        status: 'completed',
        conclusion: 'success',
      },
    ],
  });
  assert.equal(report.ok, true);
  assert.equal(report.source, 'check_run');
  assert.equal(report.evidence[0].id, 11);
});

test('lint-only green checks do not satisfy the gate', () => {
  const report = evaluateSameShaCi({
    workflowRuns: [],
    checkRuns: [
      { id: 10, name: 'Lint', status: 'completed', conclusion: 'success' },
      { id: 11, name: 'Unit Tests', status: 'completed', conclusion: 'success' },
    ],
  });
  assert.equal(report.ok, false);
});
