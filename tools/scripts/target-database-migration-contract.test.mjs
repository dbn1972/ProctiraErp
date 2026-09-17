import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const migrateScript = join(root, 'tools/scripts/run-target-database-migrations.sh');
const runtimeScript = join(root, 'tools/scripts/assert-runtime-schema-ready.sh');

test('target migrator fails closed without its separately scoped credential', () => {
  const result = spawnSync('bash', [migrateScript], {
    cwd: root,
    env: { ...process.env, MIGRATOR_DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MIGRATOR_DATABASE_URL is required/);
});

test('target migration stage applies both tracks with strict FKs and verifies markers', () => {
  const source = readFileSync(migrateScript, 'utf8');
  assert.match(source, /prisma:migrate:deploy/);
  assert.match(source, /APPLY_SEEDS=0 APPLY_STRICT_FKS=1/);
  assert.match(source, /082_repair_strict_tenant_fk_validate\.sql/);
  assert.match(source, /092_hostel_assignment_uniqueness\.sql/);
  assert.match(source, /093_developer_portal_tenant_fks\.sql/);
  assert.match(source, /proctira_hostel_assignment_index_ready/);
  assert.doesNotMatch(source, /\|\|\s*true|continue-on-error/);
});

test('runtime schema gate uses only the app-role URL and required migration function', () => {
  const source = readFileSync(runtimeScript, 'utf8');
  assert.match(source, /proctira_runtime_migration_status/);
  assert.match(source, /RUNTIME_ROLE_EXPECTED:-proctira_app/);
  assert.doesNotMatch(source, /MIGRATOR_DATABASE_URL/);
  assert.doesNotMatch(source, /\|\|\s*true|continue-on-error/);
});

test('active Helm chart separates gateway liveness from schema-aware readiness', () => {
  const values = readFileSync(
    join(root, 'infrastructure/helm/proctira-service/values.yaml'),
    'utf8',
  );
  const helpers = readFileSync(
    join(root, 'infrastructure/helm/proctira-service/templates/_helpers.tpl'),
    'utf8',
  );
  const deployment = readFileSync(
    join(root, 'infrastructure/helm/proctira-service/templates/deployment.yaml'),
    'utf8',
  );
  assert.match(values, /api-gateway:[\s\S]*livenessPath: \/health\/live/);
  assert.match(values, /api-gateway:[\s\S]*readinessPath: \/health\/ready/);
  assert.match(helpers, /define "proctira-service\.readinessPath"/);
  assert.match(deployment, /path: \{\{ include "proctira-service\.livenessPath"/);
  assert.match(deployment, /path: \{\{ include "proctira-service\.readinessPath"/);
});

test('manual deploy requires successful CI for the selected SHA', () => {
  const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deploy, /permissions:[\s\S]*actions: read[\s\S]*checks: read/);

  const gateStart = deploy.indexOf('\n  ci-gate:');
  const prepareStart = deploy.indexOf('\n  prepare:', gateStart);
  assert.ok(gateStart >= 0 && prepareStart > gateStart, 'deploy ci-gate job was not found');
  const gate = deploy.slice(gateStart, prepareStart);
  assert.match(
    gate,
    /if: github\.event_name == 'workflow_dispatch'[\s\S]*require-same-sha-ci\.mjs/,
  );
  assert.match(gate, /Require successful CI on same SHA \(manual deploy\)/);
  assert.match(gate, /HEAD_SHA: \$\{\{ steps\.resolve\.outputs\.head-sha \}\}/);
});

test('shared per-service chart changes fan out to every canonical workload', () => {
  const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(
    deploy,
    /infrastructure\/helm\/proctira-service\/[\s\S]*SERVICES="api-gateway,web,registration-portal,etl-worker"/,
  );
  assert.doesNotMatch(deploy, /\["infrastructure\/helm\/proctira-service\/"\]="api-gateway"/);
});

test('hostel index repair builds replacement before atomic swap and cleanup', () => {
  const sql = readFileSync(join(root, 'db/sql/092_hostel_assignment_uniqueness.sql'), 'utf8');
  const build = sql.indexOf('CREATE UNIQUE INDEX CONCURRENTLY %I');
  const swap = sql.indexOf('DO $swap_indexes$');
  const assertion = sql.indexOf('DO $assert_indexes$');
  const cleanup = sql.lastIndexOf('DROP INDEX CONCURRENTLY IF EXISTS public.%I');

  assert.ok(build >= 0, 'replacement index build is missing');
  assert.ok(build < swap, 'replacement must be built before the canonical swap');
  assert.ok(swap < assertion, 'canonical swap must precede contract assertion');
  assert.ok(assertion < cleanup, 'retired index cleanup must follow contract assertion');
  assert.doesNotMatch(
    sql,
    /DROP INDEX CONCURRENTLY IF EXISTS public\.%I',\s*index_name/,
    'canonical index must not be dropped before replacement succeeds',
  );
  assert.match(sql, /old\/new rename pair runs in one transaction/);
});

test('developer-portal tenant FK migration creates, validates, and asserts both contracts', () => {
  const sql = readFileSync(join(root, 'db/sql/093_developer_portal_tenant_fks.sql'), 'utf8');
  for (const table of ['developer_portal_webhooks', 'developer_portal_webhook_deliveries']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`${table}_tenant_fk`));
  }
  assert.match(
    sql,
    /FOREIGN KEY \(tenant_id\)[\s\S]*REFERENCES public\.tenants\(id\)[\s\S]*NOT VALID/,
  );
  assert.match(sql, /VALIDATE CONSTRAINT developer_portal_webhooks_tenant_fk/);
  assert.match(sql, /VALIDATE CONSTRAINT developer_portal_webhook_deliveries_tenant_fk/);
  assert.match(sql, /constraint_state\.convalidated/);
});
