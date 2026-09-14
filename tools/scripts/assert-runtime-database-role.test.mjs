#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-01 runtime role live gate evaluator.
 * Run with: node --test tools/scripts/assert-runtime-database-role.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateRuntimeRoleProbe,
  isRuntimeRoleGateRequired,
  normalizeProbeRow,
  resolveExpectedRole,
  runRuntimeRoleGate,
} from './assert-runtime-database-role.mjs';

test('isRuntimeRoleGateRequired fails closed for production / explicit flag', () => {
  assert.equal(isRuntimeRoleGateRequired({ RUNTIME_ROLE_GATE_REQUIRED: '1' }), true);
  assert.equal(isRuntimeRoleGateRequired({ ENVIRONMENT: 'production' }), true);
  assert.equal(isRuntimeRoleGateRequired({ GITHUB_ENV: 'production' }), true);
  assert.equal(isRuntimeRoleGateRequired({ ENVIRONMENT: 'staging' }), false);
  assert.equal(isRuntimeRoleGateRequired({}), false);
});

test('resolveExpectedRole defaults to proctira_app and allows empty skip', () => {
  assert.equal(resolveExpectedRole({}), 'proctira_app');
  assert.equal(resolveExpectedRole({ RUNTIME_ROLE_EXPECTED: 'custom_app' }), 'custom_app');
  assert.equal(resolveExpectedRole({ RUNTIME_ROLE_EXPECTED: '' }), null);
});

test('evaluateRuntimeRoleProbe accepts a clean proctira_app row', () => {
  const issues = evaluateRuntimeRoleProbe({
    currentUser: 'proctira_app',
    rolsuper: false,
    rolbypassrls: false,
    ownedTableCount: 0,
    ownerRoleMember: false,
  });
  assert.deepEqual(issues, []);
});

test('evaluateRuntimeRoleProbe rejects superuser / BYPASSRLS / ownership / membership', () => {
  assert.ok(
    evaluateRuntimeRoleProbe({
      currentUser: 'proctira_app',
      rolsuper: true,
      rolbypassrls: false,
      ownedTableCount: 0,
      ownerRoleMember: false,
    }).some((i) => /superuser/.test(i)),
  );
  assert.ok(
    evaluateRuntimeRoleProbe({
      currentUser: 'proctira_app',
      rolsuper: false,
      rolbypassrls: true,
      ownedTableCount: 0,
      ownerRoleMember: false,
    }).some((i) => /BYPASSRLS/.test(i)),
  );
  assert.ok(
    evaluateRuntimeRoleProbe({
      currentUser: 'proctira',
      rolsuper: false,
      rolbypassrls: false,
      ownedTableCount: 3,
      ownerRoleMember: false,
    }).some((i) => /owns 3/.test(i)),
  );
  assert.ok(
    evaluateRuntimeRoleProbe({
      currentUser: 'proctira_app',
      rolsuper: false,
      rolbypassrls: false,
      ownedTableCount: 0,
      ownerRoleMember: true,
    }).some((i) => /member/.test(i)),
  );
  assert.ok(
    evaluateRuntimeRoleProbe({
      currentUser: 'proctira',
      rolsuper: false,
      rolbypassrls: false,
      ownedTableCount: 0,
      ownerRoleMember: false,
    }).some((i) => /expected runtime role proctira_app/.test(i)),
  );
});

test('normalizeProbeRow coerces pg text/bool shapes', () => {
  const row = normalizeProbeRow({
    current_user: 'proctira_app',
    rolsuper: 'f',
    rolbypassrls: false,
    owned_table_count: '0',
    owner_role_member: 't',
  });
  assert.equal(row.currentUser, 'proctira_app');
  assert.equal(row.rolsuper, false);
  assert.equal(row.ownedTableCount, 0);
  assert.equal(row.ownerRoleMember, true);
});

test('runRuntimeRoleGate fails closed when required and DATABASE_URL unset', async () => {
  const result = await runRuntimeRoleGate({
    RUNTIME_ROLE_GATE_REQUIRED: '1',
    DATABASE_URL: '',
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /DATABASE_URL unset/.test(i)));
});

test('runRuntimeRoleGate advisory-skips when URL unset and gate not required', async () => {
  const result = await runRuntimeRoleGate({ DATABASE_URL: '' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
