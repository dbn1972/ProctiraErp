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
  resolveGateMode,
  runRuntimeRoleGate,
  RUNTIME_ROLE_PROBE_SQL,
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

const PHI_ROW = {
  currentUser: 'proctira_phi_retention',
  rolsuper: false,
  rolbypassrls: false,
  ownedTableCount: 0,
  ownerRoleMember: false,
  memberships: [],
};
const PHI_MODE = { mode: 'expected-role', expectedRole: 'proctira_phi_retention' };

test('PRC-M623 N4: resolveGateMode selects expected-role mode from CLI or env', () => {
  assert.deepEqual(resolveGateMode(['--expected-role=proctira_phi_retention'], {}), {
    mode: 'expected-role',
    expectedRole: 'proctira_phi_retention',
    allowedMemberships: [],
  });
  assert.deepEqual(
    resolveGateMode([], {
      RUNTIME_ROLE_MODE: 'expected-role',
      RUNTIME_ROLE_EXPECTED: 'proctira_phi_retention',
      RUNTIME_ROLE_ALLOWED_MEMBERSHIPS: 'a, b',
    }),
    {
      mode: 'expected-role',
      expectedRole: 'proctira_phi_retention',
      allowedMemberships: ['a', 'b'],
    },
  );
  assert.equal(resolveGateMode([], {}).mode, 'runtime');
  assert.equal(resolveGateMode([], {}).expectedRole, 'proctira_app');
  // The role name can never be skipped in expected-role mode.
  assert.throws(() => resolveGateMode(['--expected-role='], {}), /needs a role name/);
  assert.throws(
    () => resolveGateMode([], { RUNTIME_ROLE_MODE: 'expected-role', RUNTIME_ROLE_EXPECTED: '' }),
    /needs a role name/,
  );
  assert.throws(() => resolveGateMode(['--bogus'], {}), /unknown argument/);
});

test('PRC-M623 N4: expected-role mode accepts a clean phi retention row', () => {
  assert.deepEqual(evaluateRuntimeRoleProbe(PHI_ROW, PHI_MODE), []);
});

test('PRC-M623 N4: expected-role mode rejects any unexpected role membership', () => {
  const issues = evaluateRuntimeRoleProbe(
    { ...PHI_ROW, memberships: ['pg_read_all_data', 'proctira_app'] },
    PHI_MODE,
  );
  assert.ok(
    issues.some((i) => /member of unexpected role\(s\): pg_read_all_data, proctira_app/.test(i)),
    issues.join('; '),
  );
  // Allowed memberships pass; others still fail.
  assert.deepEqual(
    evaluateRuntimeRoleProbe(
      { ...PHI_ROW, memberships: ['pg_read_all_data'] },
      { ...PHI_MODE, allowedMemberships: ['pg_read_all_data'] },
    ),
    [],
  );
  // A probe without a membership list fails closed.
  const { memberships: _drop, ...noList } = PHI_ROW;
  assert.ok(
    evaluateRuntimeRoleProbe(noList, PHI_MODE).some((i) =>
      /membership probe returned no list/.test(i),
    ),
  );
});

test('PRC-M623 N4: expected-role mode keeps the ownership / attribute / name checks', () => {
  const cases = [
    [{ rolsuper: true }, /superuser/],
    [{ rolbypassrls: true }, /BYPASSRLS/],
    [{ ownedTableCount: 2 }, /owns 2/],
    [{ ownerRoleMember: true }, /member of a role that owns/],
    [{ currentUser: 'proctira_app' }, /expected runtime role proctira_phi_retention/],
  ];
  for (const [patch, pattern] of cases) {
    const issues = evaluateRuntimeRoleProbe({ ...PHI_ROW, ...patch }, PHI_MODE);
    assert.ok(
      issues.some((i) => pattern.test(i)),
      `${JSON.stringify(patch)}: ${issues.join('; ')}`,
    );
  }
});

test('PRC-M623 N4: default runtime mode ignores memberships (unchanged behaviour)', () => {
  assert.deepEqual(
    evaluateRuntimeRoleProbe({ ...PHI_ROW, currentUser: 'proctira_app', memberships: ['x'] }),
    [],
  );
});

test('PRC-M623 N4: probe SQL lists transitive memberships; normalizeProbeRow keeps them', () => {
  assert.match(RUNTIME_ROLE_PROBE_SQL, /WITH RECURSIVE m\(roleid\)/);
  assert.match(RUNTIME_ROLE_PROBE_SQL, /AS memberships/);
  assert.deepEqual(normalizeProbeRow({ current_user: 'r', memberships: ['a'] }).memberships, ['a']);
  assert.equal(normalizeProbeRow({ current_user: 'r' }).memberships, undefined);
});

test('runRuntimeRoleGate advisory-skips when URL unset and gate not required', async () => {
  const result = await runRuntimeRoleGate({ DATABASE_URL: '' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
