#!/usr/bin/env node
/**
 * Unit tests for the CI aggregate gate (W1-OPS-05 B2).
 * Run with: node --test tools/scripts/ci-aggregate-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluate } from './ci-aggregate-gate.mjs';

const noChanges = {
  packagesChanged: 'false',
  appsChanged: 'false',
  sharedChanged: 'false',
  frontendChanged: 'false',
  backendChanged: 'false',
};

const codeChanges = {
  packagesChanged: 'true',
  appsChanged: 'false',
  sharedChanged: 'false',
  frontendChanged: 'false',
  backendChanged: 'true',
};

function allSkipped() {
  return {
    detectChanges: 'success',
    lint: 'skipped',
    typecheck: 'skipped',
    unitTest: 'skipped',
    build: 'skipped',
    bundleBudget: 'skipped',
    lighthouse: 'skipped',
    integrationTest: 'skipped',
    dodChecks: 'skipped',
    tenantIsolation: 'skipped',
  };
}

function allSucceeded() {
  return {
    detectChanges: 'success',
    lint: 'success',
    typecheck: 'success',
    unitTest: 'success',
    build: 'success',
    bundleBudget: 'success',
    lighthouse: 'success',
    integrationTest: 'success',
    dodChecks: 'success',
    tenantIsolation: 'success',
  };
}

test('docs-only PR: all skips are proven and gate passes', () => {
  const report = evaluate({ changes: noChanges, results: allSkipped() });
  assert.equal(report.ok, true);
  assert.equal(report.unprovenSkips.length, 0);
  assert.equal(report.provenSkips.length, 9);
});

test('failing proof: skip cascade with code changes is unproven and gate fails', () => {
  const report = evaluate({ changes: codeChanges, results: allSkipped() });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'unit-test'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'lint'));
});

test('code PR with all required jobs succeeding passes', () => {
  const report = evaluate({ changes: codeChanges, results: allSucceeded() });
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
});

test('any upstream failure fails closed', () => {
  const results = allSucceeded();
  results.unitTest = 'failure';
  const report = evaluate({ changes: codeChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((item) => item.job === 'unit-test'));
});

test('detect-changes failure fails closed before evaluating skips', () => {
  const results = allSkipped();
  results.detectChanges = 'failure';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((item) => item.job === 'detect-changes'));
});

test('frontend-only changes require bundle and lighthouse jobs', () => {
  const changes = {
    ...noChanges,
    appsChanged: 'true',
    frontendChanged: 'true',
  };
  const results = allSucceeded();
  results.bundleBudget = 'skipped';
  results.integrationTest = 'skipped';
  const report = evaluate({ changes, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'bundle-budget'));
  assert.ok(report.provenSkips.some((item) => item.job === 'integration-test'));
});
