#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-06 COMPLETE strict tenant FK gate.
 * Run with: node --test tools/scripts/check-strict-tenant-fks.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REPAIR_MIGRATION_HINT,
  SKIP_JUSTIFICATION_MARKER,
  VALIDATE_MIGRATION_HINT,
  applySqlDefaultsStrictFksOnInProd,
  applySqlGatesStrictFks,
  evaluateStrictTenantFks,
  findApplySqlSteps,
  hasTenantFkValidateMigration,
  loadTextTenantAllowlist,
  parseLiveCatalogRows,
  reconcileTextTenantTables,
  repairMigrationFailClosed,
} from './check-strict-tenant-fks.mjs';

const APPLY_OK = `#!/usr/bin/env bash
# W1-DATA-06 COMPLETE defaults
if [[ -z "\${APPLY_STRICT_FKS+x}" ]]; then
  if [[ "\${CI:-}" == "true" || "\${NODE_ENV:-}" == "production" ]]; then
    APPLY_STRICT_FKS=1
  else
    APPLY_STRICT_FKS=0
  fi
fi
is_strict_fk_file() {
  local base
  base="$(basename "$1")"
  case "$base" in
    021a_strict_fk_prerequisite_tenants.sql|\\
    021b_tenant_fk_constraints.sql|\\
    068_validate_tenant_fk_constraints.sql|\\
    082_repair_strict_tenant_fk_validate.sql)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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

const REPAIR_OK = `-- repair
DO $$ BEGIN
  ALTER TABLE foo VALIDATE CONSTRAINT foo_tenant_fk;
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE NOT c.convalidated) THEN
    RAISE EXCEPTION 'W1-DATA-06: unvalidated tenant_id FKs remain';
  END IF;
END $$;
`;

function writeFixture({
  withValidate = true,
  withPrereq = true,
  withRepair = true,
  workflowStrict = true,
  justifiedSkip = false,
  applyText = APPLY_OK,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'strict-fk-gate-'));
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });

  writeFileSync(join(root, 'tools/scripts/apply-sql.sh'), applyText);
  writeFileSync(join(root, 'db/sql/021b_tenant_fk_constraints.sql'), ADD_OK);
  if (withPrereq) {
    writeFileSync(join(root, 'db/sql/021a_strict_fk_prerequisite_tenants.sql'), PREREQ_OK);
  }
  if (withValidate) {
    writeFileSync(join(root, 'db/sql/068_validate_tenant_fk_constraints.sql'), VALIDATE_OK);
  }
  if (withRepair) {
    writeFileSync(join(root, 'db/sql/082_repair_strict_tenant_fk_validate.sql'), REPAIR_OK);
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
  assert.equal(
    hasTenantFkValidateMigration(['ALTER TABLE t VALIDATE CONSTRAINT t_tenant_fk;']),
    true,
  );
  assert.equal(
    hasTenantFkValidateMigration(['ALTER TABLE t VALIDATE CONSTRAINT other_fk;']),
    false,
  );
  assert.equal(hasTenantFkValidateMigration(['-- no validate']), false);
});

test('applySqlGatesStrictFks requires 021b + 068 + 076 gate', () => {
  assert.equal(applySqlGatesStrictFks(APPLY_OK), true);
  assert.equal(
    applySqlGatesStrictFks('APPLY_STRICT_FKS=1\nis_strict_fk_file\n021b_tenant_fk_constraints.sql'),
    false,
  );
  assert.equal(applySqlGatesStrictFks('echo hi'), false);
});

test('applySqlDefaultsStrictFksOnInProd detects CI/production default', () => {
  assert.equal(applySqlDefaultsStrictFksOnInProd(APPLY_OK), true);
  assert.equal(
    applySqlDefaultsStrictFksOnInProd('APPLY_STRICT_FKS="${APPLY_STRICT_FKS:-0}"'),
    false,
  );
});

test('repairMigrationFailClosed requires VALIDATE + RAISE EXCEPTION', () => {
  assert.equal(repairMigrationFailClosed(REPAIR_OK), true);
  assert.equal(repairMigrationFailClosed(VALIDATE_OK), false);
});

test('parseLiveCatalogRows splits unvalidated vs missing', () => {
  const parsed = parseLiveCatalogRows('unvalidated|fees.fees_tenant_fk\nmissing|orphan_table\n');
  assert.deepEqual(parsed.unvalidated, ['fees.fees_tenant_fk']);
  assert.deepEqual(parsed.missing, ['orphan_table']);
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

test('evaluateStrictTenantFks fails without repair migration', () => {
  const root = writeFixture({ withRepair: false });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => new RegExp(REPAIR_MIGRATION_HINT).test(f)));
});

test('evaluateStrictTenantFks fails without prerequisite tenant file', () => {
  const root = writeFixture({ withPrereq: false });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /021a_strict_fk_prerequisite_tenants/.test(f)));
});

test('evaluateStrictTenantFks fails when apply-sql still defaults APPLY_STRICT_FKS off', () => {
  const root = writeFixture({
    applyText: `#!/usr/bin/env bash
APPLY_STRICT_FKS="\${APPLY_STRICT_FKS:-0}"
is_strict_fk_file() {
  [[ "$(basename "$1")" == "021b_tenant_fk_constraints.sql" ]]
}
`,
  });
  const report = evaluateStrictTenantFks({ root });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /default APPLY_STRICT_FKS=1/.test(f)));
});

test('evaluateStrictTenantFks live catalog fails on NOT VALID leftover', () => {
  const root = writeFixture();
  const report = evaluateStrictTenantFks({
    root,
    live: true,
    requireLive: true,
    databaseUrl: 'postgresql://example',
    queryLive: () => ({
      status: 0,
      stdout: 'unvalidated|fees.fees_tenant_fk',
      stderr: '',
      error: '',
    }),
  });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /unvalidated tenant_id/.test(f)));
});

test('evaluateStrictTenantFks live catalog passes when clean', () => {
  const root = writeFixture();
  const report = evaluateStrictTenantFks({
    root,
    live: true,
    requireLive: true,
    databaseUrl: 'postgresql://example',
    queryLive: () => ({ status: 0, stdout: '', stderr: '', error: '' }),
  });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.ok(report.notes.some((n) => /live catalog: zero unvalidated/.test(n)));
});

test('evaluateStrictTenantFks requireLive without URL fails closed', () => {
  const root = writeFixture();
  const report = evaluateStrictTenantFks({
    root,
    live: true,
    requireLive: true,
    databaseUrl: '',
    queryLive: () => ({ status: 0, stdout: '', stderr: '', error: '' }),
  });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /DATABASE_URL/.test(f)));
});

test('VALIDATE_MIGRATION_HINT constant matches expected file', () => {
  assert.equal(VALIDATE_MIGRATION_HINT, '068_validate_tenant_fk_constraints.sql');
});

test('parseLiveCatalogRows extracts the text_tenant_no_fk kind', () => {
  const out = [
    'missing|some_uuid_table',
    'text_tenant_no_fk|health_allergies',
    'text_tenant_no_fk|audit_log_entries',
    'unvalidated|x.x_tenant_fk',
  ].join('\n');
  const parsed = parseLiveCatalogRows(out);
  assert.deepEqual(parsed.textTenantNoFk, ['health_allergies', 'audit_log_entries']);
  assert.deepEqual(parsed.missing, ['some_uuid_table']);
  assert.deepEqual(parsed.unvalidated, ['x.x_tenant_fk']);
});

test('reconcileTextTenantTables separates tracked debt from new violations', () => {
  const allow = new Set(['health_allergies', 'audit_log_entries', 'gone_table']);
  const r = reconcileTextTenantTables(
    ['health_allergies', 'audit_log_entries', 'brand_new_table'],
    allow,
  );
  assert.deepEqual(r.unlisted, ['brand_new_table'], 'unlisted table must be reported');
  assert.deepEqual(r.tracked, ['audit_log_entries', 'health_allergies']);
  assert.deepEqual(r.stale, ['gone_table'], 'allowlist entries no longer present are stale');
});

test('reconcileTextTenantTables treats an empty allowlist as permitting nothing', () => {
  // A missing or unreadable allowlist must not silently allow every table.
  const r = reconcileTextTenantTables(['a', 'b'], new Set());
  assert.deepEqual(r.unlisted, ['a', 'b']);
  assert.deepEqual(r.tracked, []);
});

test('the shipped allowlist is empty now that the text tenant_id debt is cleared', () => {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const allow = loadTextTenantAllowlist(root);
  // This asserted the 23 recorded exceptions were all still tracked. They are gone:
  // db/sql/100_tenant_id_uuid_fks.sql migrated every one to uuid with a validated
  // FK to tenants(id), which is the exit route the allowlist itself described.
  //
  // Inverted rather than deleted, so the cleared state is held in place. A
  // reappearing entry means a tenant-owned table was added without referential
  // integrity, and that should fail here and be an explicit decision.
  assert.equal(allow.size, 0, 'allowlist should stay empty; see db/sql/100_tenant_id_uuid_fks.sql');
});

test('loadTextTenantAllowlist returns an empty set when the file is absent', () => {
  const allow = loadTextTenantAllowlist('/nonexistent-root-for-test');
  assert.equal(allow.size, 0);
});
