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
  infraChanged: 'false',
  secondaryAppsChanged: 'false',
};

const codeChanges = {
  packagesChanged: 'true',
  appsChanged: 'false',
  sharedChanged: 'false',
  frontendChanged: 'false',
  backendChanged: 'true',
  infraChanged: 'false',
  secondaryAppsChanged: 'false',
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
    restoreDrillEvidence: 'success',
    prismaSqlDrift: 'success',
    strictTenantFks: 'success',
    tenantIdIndexes: 'success',
    migrationTimeouts: 'success',
    codeownersGate: 'success',
    runtimeTablePrivileges: 'success',
    runtimeRoleGate: 'success',
    securityScans: 'success',
    secondaryAppsE2e: 'skipped',
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
    restoreDrillEvidence: 'success',
    prismaSqlDrift: 'success',
    strictTenantFks: 'success',
    tenantIdIndexes: 'success',
    migrationTimeouts: 'success',
    codeownersGate: 'success',
    runtimeTablePrivileges: 'success',
    runtimeRoleGate: 'success',
    securityScans: 'success',
    secondaryAppsE2e: 'success',
  };
}

test('no path-filter match: optional jobs may skip; always-on gates still required', () => {
  const report = evaluate({ changes: noChanges, results: allSkipped() });
  assert.equal(report.ok, true);
  assert.equal(report.unprovenSkips.length, 0);
  assert.equal(report.provenSkips.length, 10);
});

test('docs via shared filter: skipped unit/tenant-isolation is unproven (W1-OPS-05)', () => {
  // Path filters map docs/** onto shared. Aggregate must require the code chain.
  const changes = {
    ...noChanges,
    sharedChanged: 'true',
  };
  const results = allSkipped();
  const report = evaluate({ changes, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'unit-test'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'tenant-isolation'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'lint'));
});

test('restore-drill evidence skip fails closed even on docs-only PRs', () => {
  const results = allSkipped();
  results.restoreDrillEvidence = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'restore-drill-evidence'));
});

test('prisma-sql-drift skip fails closed even on docs-only PRs (W1-DATA-04)', () => {
  const results = allSkipped();
  results.prismaSqlDrift = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'prisma-sql-drift'));
});

test('strict-tenant-fks skip fails closed even on docs-only PRs (W1-DATA-06)', () => {
  const results = allSkipped();
  results.strictTenantFks = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'strict-tenant-fks'));
});

test('tenant-id-indexes skip fails closed even on docs-only PRs (W1-DATA-16)', () => {
  const results = allSkipped();
  results.tenantIdIndexes = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'tenant-id-indexes'));
});

test('migration-timeouts skip fails closed even on docs-only PRs (W1-DATA-17)', () => {
  const results = allSkipped();
  results.migrationTimeouts = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'migration-timeouts'));
});

test('codeowners-gate skip fails closed even on docs-only PRs (W1-SEC-13)', () => {
  const results = allSkipped();
  results.codeownersGate = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'codeowners-gate'));
});

test('runtime-table-privileges skip fails closed even on docs-only PRs (W1-DATA-11)', () => {
  const results = allSkipped();
  results.runtimeTablePrivileges = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'runtime-table-privileges'));
});

test('runtime-role-gate skip fails closed even on docs-only PRs (W1-DATA-01)', () => {
  const results = allSkipped();
  results.runtimeRoleGate = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'runtime-role-gate'));
});

test('security-scans skip fails closed even on docs-only PRs (W1-OPS-11)', () => {
  const results = allSkipped();
  results.securityScans = 'skipped';
  const report = evaluate({ changes: noChanges, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'security-scans'));
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

test('db/tools via shared filter: skipped tenant-isolation is unproven', () => {
  // Path filters map db/** and tools/** onto shared (+ backend). Aggregate
  // must not treat those as proven skips (W1-OPS-05 / #181).
  const changes = {
    ...noChanges,
    sharedChanged: 'true',
    backendChanged: 'true',
  };
  const results = allSkipped();
  const report = evaluate({ changes, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'tenant-isolation'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'integration-test'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'unit-test'));
});

test('infra-only changes require integration and tenant-isolation', () => {
  const changes = {
    ...noChanges,
    infraChanged: 'true',
  };
  const results = allSkipped();
  const report = evaluate({ changes, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'integration-test'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'tenant-isolation'));
  assert.ok(report.unprovenSkips.some((item) => item.job === 'lint'));
});

test('infra-only PR with required jobs succeeding passes', () => {
  const changes = {
    ...noChanges,
    infraChanged: 'true',
  };
  const results = allSucceeded();
  results.bundleBudget = 'skipped';
  results.lighthouse = 'skipped';
  const report = evaluate({ changes, results });
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
  assert.ok(report.provenSkips.some((item) => item.job === 'bundle-budget'));
  assert.ok(report.provenSkips.some((item) => item.job === 'lighthouse'));
});

test('secondary-apps change with skipped e2e is unproven (W1-OPS-12)', () => {
  const changes = {
    ...noChanges,
    appsChanged: 'true',
    secondaryAppsChanged: 'true',
  };
  const results = allSkipped();
  // Required always-on gates still succeed in this fixture; secondary e2e skipped.
  results.restoreDrillEvidence = 'success';
  results.prismaSqlDrift = 'success';
  results.strictTenantFks = 'success';
  results.tenantIdIndexes = 'success';
  results.migrationTimeouts = 'success';
  results.codeownersGate = 'success';
  results.runtimeTablePrivileges = 'success';
  results.runtimeRoleGate = 'success';
  results.securityScans = 'success';
  results.secondaryAppsE2e = 'skipped';
  const report = evaluate({ changes, results });
  assert.equal(report.ok, false);
  assert.ok(report.unprovenSkips.some((item) => item.job === 'secondary-apps-e2e'));
});

test('secondary-apps change with e2e success passes when other required jobs succeed', () => {
  const changes = {
    ...noChanges,
    appsChanged: 'true',
    secondaryAppsChanged: 'true',
  };
  const results = allSucceeded();
  // Secondary-only: lighthouse/bundle/integration not required.
  results.bundleBudget = 'skipped';
  results.lighthouse = 'skipped';
  results.integrationTest = 'skipped';
  const report = evaluate({ changes, results });
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
  assert.ok(report.provenSkips.some((item) => item.job === 'bundle-budget'));
  assert.ok(report.provenSkips.some((item) => item.job === 'integration-test'));
});

test('secondary-apps skip is proven when path filter is false', () => {
  const results = allSucceeded();
  results.secondaryAppsE2e = 'skipped';
  const report = evaluate({ changes: codeChanges, results });
  assert.equal(report.ok, true);
  assert.ok(report.provenSkips.some((item) => item.job === 'secondary-apps-e2e'));
});

