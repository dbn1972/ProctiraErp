#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-01 static runtime-role gate contract.
 * Run with: node --test tools/scripts/check-runtime-role-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertScriptContract,
  auditDocContract,
  ciWorkflowContract,
  deployWorkflowContract,
  evaluateRuntimeRoleGate,
  secretDocsContract,
} from './check-runtime-role-gate.mjs';

const GOOD_ASSERT = `
# W1-DATA-01
RUNTIME_ROLE_GATE_REQUIRED
rolsuper NOSUPERUSER
rolbypassrls NOBYPASSRLS BYPASSRLS
owned_table_count owns table ownedTableCount
owner_role_member owner-role pg_auth_members
proctira_app
`;

const GOOD_DEPLOY = `
  migrate-database:
    environment: production
    steps:
      - env:
          MIGRATOR_DATABASE_URL: \${{ secrets.MIGRATOR_DATABASE_URL }}
        run: bash tools/scripts/run-target-database-migrations.sh

  runtime-role-gate:
    name: Runtime DB role gate (W1-DATA-01)
    needs: [prepare, migrate-database]
    steps:
      - env:
          RUNTIME_ROLE_GATE_REQUIRED: '1'
          RUNTIME_ROLE_SECRET_NAME: proctira-prod-secrets
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
        run: bash tools/scripts/assert-runtime-database-role.sh
      - run: bash tools/scripts/assert-runtime-schema-ready.sh

  deploy:
    needs: [prepare, build-images, migrate-database, runtime-role-gate]
    if: needs.build-images.result == 'success' && needs.migrate-database.result == 'success' && needs.runtime-role-gate.result == 'success'
    steps:
      - run: helm upgrade --install
`;

const GOOD_CI = `
  runtime-role-gate:
    name: Runtime Role Gate (W1-DATA-01)
    steps:
      - run: pnpm install --frozen-lockfile
      - run: node --test tools/scripts/check-no-runtime-ddl.test.mjs
      - run: node --test tools/scripts/target-database-migration-contract.test.mjs
      - run: node tools/scripts/check-runtime-role-gate.mjs
      - run: node tools/scripts/check-no-runtime-ddl.mjs

  ci-aggregate:
    needs:
      - runtime-role-gate
    steps:
      - env:
          RUNTIME_ROLE_GATE_RESULT: \${{ needs.runtime-role-gate.result }}
        run: node tools/scripts/ci-aggregate-gate.mjs
`;

const GOOD_ES = `
# W1-DATA-01: DATABASE_URL must be postgresql://proctira_app:… (non-owner).
- secretKey: DATABASE_URL
  remoteRef: { key: proctira/production/database-url }
`;

const GOOD_HELM = `
secrets:
  # W1-DATA-01: DATABASE_URL must use proctira_app (NOSUPERUSER NOBYPASSRLS).
  databaseUrl: ''
`;

const GOOD_HELM_PROD = `
# W1-DATA-01: existingSecret DATABASE_URL must be proctira_app.
secrets:
  existingSecret: proctira-prod-secrets
`;

const GOOD_README = `
## Runtime role gate
./tools/scripts/assert-runtime-database-role.sh
`;

const GOOD_AUDIT = `
# DATA — W1-DATA-01 COMPLETE
assert-runtime-database-role proves ExternalSecret DATABASE_URL → proctira_app.
`;

function writeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'w1-data-01-'));
  const files = {
    'tools/scripts/assert-runtime-database-role.mjs': GOOD_ASSERT,
    'tools/scripts/assert-runtime-database-role.sh': GOOD_ASSERT,
    '.github/workflows/deploy.yml': GOOD_DEPLOY,
    '.github/workflows/ci.yml': GOOD_CI,
    'docs/audits/DATA_W1_DATA_01_COMPLETE.md': GOOD_AUDIT,
    'infrastructure/k8s/overlays/production/external-secret.yaml': GOOD_ES,
    'infrastructure/k8s/overlays/staging/external-secret.yaml': GOOD_ES,
    'infrastructure/helm/proctira-platform/values.yaml': GOOD_HELM,
    'infrastructure/helm/proctira-platform/values-production.yaml': GOOD_HELM_PROD,
    'db/README.md': GOOD_README,
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  chmodSync(join(root, 'tools/scripts/assert-runtime-database-role.sh'), 0o755);
  return root;
}

test('assertScriptContract requires ownership + privilege checks', () => {
  assert.equal(assertScriptContract(GOOD_ASSERT, 'x').length, 0);
  assert.ok(assertScriptContract('proctira_app only', 'x').length > 0);
});

test('deployWorkflowContract requires pre-rollout migration and schema gates', () => {
  assert.equal(deployWorkflowContract(GOOD_DEPLOY).length, 0);
  assert.ok(deployWorkflowContract('name: Deploy\njobs: {}\n').length > 0);
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        'bash tools/scripts/run-target-database-migrations.sh',
        'bash tools/scripts/run-target-database-migrations.sh || true',
      ),
    ).length > 0,
  );
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        'run: bash tools/scripts/run-target-database-migrations.sh',
        'run: |\n          set +e\n          bash tools/scripts/run-target-database-migrations.sh\n          exit 0',
      ),
    ).length > 0,
  );
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        'run: bash tools/scripts/run-target-database-migrations.sh',
        'if: false\n        run: bash tools/scripts/run-target-database-migrations.sh',
      ),
    ).length > 0,
  );
  assert.ok(
    deployWorkflowContract(GOOD_DEPLOY.replace('  deploy:\n', '  deploy:\n    if: always()\n'))
      .length > 0,
  );
  assert.ok(
    deployWorkflowContract(`${GOOD_DEPLOY}\n  migrate-database:\n    steps: []\n`).length > 0,
  );
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        "if: needs.build-images.result == 'success' && needs.migrate-database.result == 'success' && needs.runtime-role-gate.result == 'success'",
        'if: ${{ !cancelled() }}',
      ),
    ).length > 0,
  );
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        '  migrate-database:\n',
        '  migrate-database:\n    continue-on-error: ${{ true }}\n',
      ),
    ).length > 0,
  );
  assert.ok(
    deployWorkflowContract(
      GOOD_DEPLOY.replace(
        '  migrate-database:\n',
        '  migrate-database:\n    defaults:\n      run:\n        shell: bash {0} || true\n',
      ),
    ).length > 0,
  );
});

test('ciWorkflowContract requires aggregate wiring', () => {
  assert.equal(ciWorkflowContract(GOOD_CI).length, 0);
  assert.ok(ciWorkflowContract('runtime-role-gate:\n  run: true\n').length > 0);
});

test('ciWorkflowContract rejects duplicate runtime-role-gate job keys (W1-OPS-05)', () => {
  const dup = `${GOOD_CI}\n  runtime-role-gate:\n    name: duplicate\n`;
  const issues = ciWorkflowContract(dup);
  assert.ok(
    issues.some((i) => /YAML|Map keys must be unique|unique/i.test(i)),
    JSON.stringify(issues),
  );
});

test('ciWorkflowContract rejects comment-only or unrelated-job scanner references', () => {
  const bypass = `
  runtime-role-gate:
    steps:
      # node tools/scripts/check-no-runtime-ddl.mjs
      - run: pnpm install --frozen-lockfile
      - run: node tools/scripts/check-runtime-role-gate.mjs

  unrelated:
    steps:
      - run: node --test tools/scripts/check-no-runtime-ddl.test.mjs
      - run: node tools/scripts/check-no-runtime-ddl.mjs

  ci-aggregate:
    needs:
      - runtime-role-gate
    steps:
      - env:
          RUNTIME_ROLE_GATE_RESULT: result
        run: node tools/scripts/ci-aggregate-gate.mjs
`;
  const issues = ciWorkflowContract(bypass);
  assert.ok(issues.some((issue) => /unit-test the runtime-DDL gate/.test(issue)));
  assert.ok(issues.some((issue) => /must run check-no-runtime-ddl\.mjs/.test(issue)));
});

test('ciWorkflowContract rejects shell and step-level soft-pass masking', () => {
  for (const masked of [
    GOOD_CI.replace(
      'node tools/scripts/check-no-runtime-ddl.mjs',
      'node tools/scripts/check-no-runtime-ddl.mjs || true',
    ),
    GOOD_CI.replace(
      'node tools/scripts/check-no-runtime-ddl.mjs',
      'node tools/scripts/check-no-runtime-ddl.mjs; true',
    ),
    GOOD_CI.replace(
      '- run: node tools/scripts/check-no-runtime-ddl.mjs',
      '- run: node tools/scripts/check-no-runtime-ddl.mjs\n        continue-on-error: true',
    ),
    GOOD_CI.replace(
      'node tools/scripts/check-no-runtime-ddl.mjs',
      'if false; then node tools/scripts/check-no-runtime-ddl.mjs; fi',
    ),
    GOOD_CI.replace(
      '- run: node tools/scripts/check-no-runtime-ddl.mjs',
      '- run: |\n          set +e\n          node tools/scripts/check-no-runtime-ddl.mjs\n          exit 0',
    ),
    GOOD_CI.replace(
      '- run: node tools/scripts/check-no-runtime-ddl.mjs',
      '- if: false\n        run: node tools/scripts/check-no-runtime-ddl.mjs',
    ),
    GOOD_CI.replace(
      '- run: node tools/scripts/check-no-runtime-ddl.mjs',
      '- run: node tools/scripts/check-no-runtime-ddl.mjs\n        continue-on-error: ${{ true }}',
    ),
    GOOD_CI.replace(
      '  runtime-role-gate:\n',
      '  runtime-role-gate:\n    continue-on-error: true\n',
    ),
    GOOD_CI.replace(
      '  runtime-role-gate:\n',
      '  runtime-role-gate:\n    defaults:\n      run:\n        shell: bash {0} || true\n',
    ),
  ]) {
    const issues = ciWorkflowContract(masked);
    assert.ok(issues.length > 0, JSON.stringify(issues));
  }
});

test('secretDocsContract requires ExternalSecret + Helm proctira_app docs', () => {
  assert.equal(
    secretDocsContract({
      prodEs: GOOD_ES,
      stagingEs: GOOD_ES,
      helmValues: GOOD_HELM,
      helmProd: GOOD_HELM_PROD,
      dbReadme: GOOD_README,
    }).length,
    0,
  );
  assert.ok(
    secretDocsContract({
      prodEs: 'DATABASE_URL: x',
      stagingEs: GOOD_ES,
      helmValues: GOOD_HELM,
      helmProd: GOOD_HELM_PROD,
      dbReadme: GOOD_README,
    }).length > 0,
  );
});

test('auditDocContract requires COMPLETE evidence pack', () => {
  assert.equal(auditDocContract(GOOD_AUDIT).length, 0);
  assert.ok(auditDocContract('# incomplete').length > 0);
});

test('evaluateRuntimeRoleGate passes a complete fixture', () => {
  const root = writeFixture();
  const report = evaluateRuntimeRoleGate(root);
  assert.equal(report.ok, true, report.issues.join('; '));
});

test('evaluateRuntimeRoleGate fails when deploy wiring is removed', () => {
  const root = writeFixture({
    '.github/workflows/deploy.yml': 'name: Deploy\njobs: {}\n',
  });
  const report = evaluateRuntimeRoleGate(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /deploy\.yml/.test(i)));
});
