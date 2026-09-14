#!/usr/bin/env node
/**
 * Unit tests for W1-SEC-13 CODEOWNERS fail-closed gate.
 * Run with: node --test tools/scripts/check-codeowners.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INTENDED_TEAM_SLUGS,
  evaluateCodeowners,
  isTeamHandle,
  isTeamsReady,
  isUserHandle,
  parseCodeowners,
} from './check-codeowners.mjs';

const HEADER = `# CODEOWNERS — test fixture
# DOMAIN: security
# Intended GitHub team (when org exists): ${INTENDED_TEAM_SLUGS.security}
# DOMAIN: data
# Intended GitHub team (when org exists): ${INTENDED_TEAM_SLUGS.data}
# DOMAIN: ops
# Intended GitHub team (when org exists): ${INTENDED_TEAM_SLUGS.ops}
# DOMAIN: web
# Intended GitHub team (when org exists): ${INTENDED_TEAM_SLUGS.web}
# DOMAIN: governance
# Intended GitHub team (when org exists): ${INTENDED_TEAM_SLUGS.governance}
`;

const PERSONAL_RULES = `
* @dbn1972
packages/backend/auth/ @dbn1972
packages/backend/privacy/ @dbn1972
packages/shared/secrets/ @dbn1972
db/sql/ @dbn1972
packages/shared/database/ @dbn1972
packages/backend/fees/ @dbn1972
packages/backend/billing/ @dbn1972
packages/backend/scholarship/ @dbn1972
.github/ @dbn1972
infrastructure/ @dbn1972
`;

const AUDIT = '# Security — CODEOWNERS domain split (W1-SEC-13)\n';
const COMPLETE = `# Security — W1-SEC-13 complete
PROCTIRA_CODEOWNERS_TEAMS_READY
Require review from Code Owners on protected main is a mandatory ops residual.
`;

function personalFixture(overrides = {}) {
  return {
    codeownersText: `${HEADER}${PERSONAL_RULES}`,
    auditText: AUDIT,
    completeAuditText: COMPLETE,
    teamsReady: false,
    allowPersonalInterim: true,
    ownerType: 'User',
    ...overrides,
  };
}

test('isTeamHandle / isUserHandle', () => {
  assert.equal(isTeamHandle('@proctira/security'), true);
  assert.equal(isTeamHandle('@dbn1972'), false);
  assert.equal(isUserHandle('@dbn1972'), true);
  assert.equal(isUserHandle('@proctira/security'), false);
});

test('isTeamsReady reads truthy env-like values', () => {
  assert.equal(isTeamsReady('1'), true);
  assert.equal(isTeamsReady('true'), true);
  assert.equal(isTeamsReady('0'), false);
  assert.equal(isTeamsReady(undefined), false);
});

test('parseCodeowners separates comments and rules', () => {
  const parsed = parseCodeowners(`${HEADER}* @dbn1972\n`);
  assert.ok(parsed.comments.some((c) => c.includes('DOMAIN: security')));
  assert.equal(parsed.rules[0].pattern, '*');
  assert.deepEqual(parsed.rules[0].owners, ['@dbn1972']);
});

test('personal interim mode passes with documented teams + no fake handles', () => {
  const report = evaluateCodeowners(personalFixture());
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.ok(report.residuals.length >= 1);
  assert.ok(report.notes.includes('finding=W1-SEC-13-OPEN'));
  assert.deepEqual(report.userOwners, ['@dbn1972']);
  assert.deepEqual(report.teamOwners, []);
});

test('personal interim without explicit waiver fails closed (W1-SEC-13 OPEN)', () => {
  const report = evaluateCodeowners(personalFixture({ allowPersonalInterim: false }));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /ALLOW_PERSONAL_INTERIM=1/.test(e)));
});

test('fake team handles without READY fail closed', () => {
  const report = evaluateCodeowners(
    personalFixture({
      codeownersText: `${HEADER}* @dbn1972\npackages/backend/auth/ @proctira/security\npackages/backend/privacy/ @dbn1972\npackages/shared/secrets/ @dbn1972\ndb/sql/ @dbn1972\npackages/shared/database/ @dbn1972\npackages/backend/fees/ @dbn1972\npackages/backend/billing/ @dbn1972\npackages/backend/scholarship/ @dbn1972\n.github/ @dbn1972\ninfrastructure/ @dbn1972\n`,
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /PROCTIRA_CODEOWNERS_TEAMS_READY≠1/.test(e)));
});

test('Organization owner without READY fails closed', () => {
  const report = evaluateCodeowners(personalFixture({ ownerType: 'Organization' }));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /owner type is Organization/.test(e)));
});

test('READY=1 requires team owners on specialist paths', () => {
  const report = evaluateCodeowners(
    personalFixture({
      teamsReady: true,
      ownerType: 'Organization',
      codeownersText: `${HEADER}* @dbn1972
packages/backend/auth/ @proctira/security
packages/backend/privacy/ @proctira/security
packages/shared/secrets/ @proctira/security
db/sql/ @proctira/data
packages/shared/database/ @proctira/data
packages/backend/fees/ @proctira/security
packages/backend/billing/ @proctira/security
packages/backend/scholarship/ @proctira/security
.github/ @proctira/ops
infrastructure/ @proctira/ops
`,
    }),
  );
  assert.equal(report.ok, true, report.errors.join('\n'));
});

test('READY=1 with personal-only specialist ownership fails', () => {
  const report = evaluateCodeowners(
    personalFixture({
      teamsReady: true,
      ownerType: 'Organization',
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /no @org\/team owner/.test(e)));
});

test('missing DOMAIN comment fails', () => {
  const report = evaluateCodeowners(
    personalFixture({
      codeownersText: `# no domains\n* @dbn1972\npackages/backend/auth/ @dbn1972\npackages/backend/privacy/ @dbn1972\npackages/shared/secrets/ @dbn1972\ndb/sql/ @dbn1972\npackages/shared/database/ @dbn1972\npackages/backend/fees/ @dbn1972\npackages/backend/billing/ @dbn1972\npackages/backend/scholarship/ @dbn1972\n.github/ @dbn1972\ninfrastructure/ @dbn1972\n`,
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /DOMAIN comment section/.test(e)));
});

test('missing complete audit fails', () => {
  const report = evaluateCodeowners(personalFixture({ completeAuditText: '' }));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /complete-audit/.test(e)));
});
