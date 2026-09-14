#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-06 strict tenant FK gate.
 * Run with: node --test tools/scripts/check-strict-tenant-fks.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  SKIP_JUSTIFICATION_MARKER,
  applySqlGatesStrictFks,
  evaluateStrictTenantFks,
  findApplySqlSteps,
  hasTenantFkValidateMigration,
} from './check-strict-tenant-fks.mjs';

const APPLY_OK = `#!/usr/bin/env bash
APPLY_STRICT_FKS="\${APPLY_STRICT_FKS:-0}"
is_strict_fk_file() {
  local base
  base="$(basename "$1")"
  [[ "$base" == "021a_strict_fk_prerequisite_tenants.sql" || "$base" == "021b_tenant_fk_constraints.sql" ]]
}
`;

const ADD_OK = `-- tenant FKs
ALTER TABLE foo ADD CONSTRAINT foo_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) NOT VALID;
`;

const PREREQ_OK = `-- demo tenant for strict FKs
INSERT INTO tenants (id, name, slug) VALUES ('00000000-0000-4000-8000-000000000001', 'demo', 'demo');
`;

const VALIDATE_OK = `-- validate
DO $$ BEGIN
  ALTER TABLE foo VALIDATE CONSTRAINT foo_tenant_fk;
END $$;
`;

function writeFixture({
  withValidate = true,
  withPrereq = true,
  workflowStrict = true,
  justifiedSkip = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'strict-fk-gate-'));
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });

  writeFileSync(join(root, 'tools/scripts/apply-sql.sh'), APPLY_OK);
  writeFileSync(join(root, 'db/sql/021b_tenant_fk_constraints.sql'), ADD_OK);
  if (withPrereq) {
    writeFileSync(join(root, 'db/sql/021a_strict_fk_prerequisite_tenants.sql'), PREREQ_OK);
  }
  if (withValidate) {
    writeFileSync(join(root, 'db/sql/068_validate_tenant_fk_constraints.sql'), VALIDATE_OK);
  }

  const envBlock = justifiedSkip
    ? `          # ${SKIP_JUSTIFICATION_MARKER} local fixture corpus without tenants table\n          APPLY_SEEDS: '1'`
    : workflowStrict
      ? `          APPLY_SEEDS: '1'\n          APPLY_STRICT_FKS: '1'`
      : `          APPLY_SEEDS: '1'`;

  writeFileSync(
    join(root, '.github/workflows/ci.yml'),
    `jobs:
  integration-test:
    steps:
      - name: Apply domain SQL schemas
        run: bash tools/scripts/apply-sql.sh
        env:
${envBlock}
`,
  );

  return root;
}

test('hasTenantFkValidateMigration requires VALIDATE + tenant signal', () => {
  assert.equal(hasTenantFkValidateMigration(['ALTER TABLE t VALIDATE CONSTRAINT t_tenant_fk;']), true);
  assert.equal(hasTenantFkValidateMigration(['ALTER TABLE t VALIDATE CONSTRAINT other_fk;']), false);
  assert.equal(hasTenantFkValidateMigration(['-- no validate']), false);
});

test('applySqlGatesStrictFks detects APPLY_STRICT_FKS + 021b gate', () => {
  assert.equal(applySqlGatesStrictFks(APPLY_OK), true);
  assert.equal(applySqlGatesStrictFks('echo hi'), false);
});

test('findApplySqlSteps detects missing APPLY_STRICT_FKS', () => {
  const yaml = `
jobs:
  integration-test:
    steps:
      - name: Apply domain SQL schemas
        run: bash tools/scripts/apply-sql.sh
        env:
          APPLY_SEEDS: '1'
`;
  const steps = findApplySqlSteps(yaml, '.github/workflows/ci.yml');
  assert.equal(steps.length, 1);
  assert.equal(steps[0].hasStrictFks, false);
  assert.equal(steps[0].justifiedSkip, false);
});

test('findApplySqlSteps accepts APPLY_STRICT_FKS=1', () => {
  const yaml = `
      - name: Apply domain SQL schemas
        run: bash tools/scripts/apply-sql.sh
        env:
          APPLY_STRICT_FKS: '1'
`;
  const steps = findApplySqlSteps(yaml, 'wf.yml');
  assert.equal(steps[0].hasStrictFks, true);
});

test('findApplySqlSteps ignores comments that merely mention apply-sql.sh', () => {
  const yaml = `
  # Fail closed when apply-sql.sh is invoked without APPLY_STRICT_FKS=1
  strict-tenant-fks:
    steps:
      - name: Fail when APPLY_STRICT_FKS / VALIDATE posture is skipped
        run: node tools/scripts/check-strict-tenant-fks.mjs
      - name: Apply domain SQL schemas
        run: bash tools/scripts/apply-sql.sh
        env:
          APPLY_STRICT_FKS: '1'
`;
  const steps = findApplySqlSteps(yaml, 'wf.yml');
  assert.equal(steps.length, 1);
  assert.equal(steps[0].stepName, 'Apply domain SQL schemas');
  assert.equal(steps[0].hasStrictFks, true);
});

test('evaluateStrictTenantFks passes a complete fixture', () => {
  const root = writeFixture();
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.equal(report.applySqlStepCount, 1);
});

test('evaluateStrictTenantFks fails when CI skips APPLY_STRICT_FKS without justification', () => {
  const root = writeFixture({ workflowStrict: false });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /without APPLY_STRICT_FKS=1/.test(f)));
});

test('evaluateStrictTenantFks allows justified skip marker', () => {
  const root = writeFixture({ workflowStrict: false, justifiedSkip: true });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, true, report.failures.join('; '));
});

test('evaluateStrictTenantFks fails without VALIDATE migration', () => {
  const root = writeFixture({ withValidate: false });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /VALIDATE migration/.test(f)));
});

test('evaluateStrictTenantFks fails without prerequisite tenant file', () => {
  const root = writeFixture({ withPrereq: false });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /021a_strict_fk_prerequisite_tenants/.test(f)));
});
