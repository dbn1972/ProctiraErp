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
