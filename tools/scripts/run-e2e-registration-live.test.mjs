/**
 * UAT-API-004 / PRC-M568 — registration live journey harness and CI wiring.
 *
 * run-e2e-registration-live.sh has no skip mode: missing env fails before any
 * seed or server start. The e2e-backend-ready workflow runs the journey in its
 * own job on PRs, nightly and main pushes, and the required live gate fails
 * unless that job succeeded. Only pre-stack paths run here (no DB, no build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'run-e2e-registration-live.sh');
const seedPath = resolve(here, '../e2e/seed-e2e-registration.sql');
const workflowPath = resolve(here, '../../.github/workflows/e2e-backend-ready.yml');
const workflow = yaml.parse(readFileSync(workflowPath, 'utf8'));
const job = workflow.jobs['registration-live-journey'];
const VALID_ENV = {
  DATABASE_URL: 'postgresql://app@127.0.0.1:1/none',
  MIGRATOR_DATABASE_URL: 'postgresql://mig@127.0.0.1:1/none',
  E2E_REGISTRATION_INSTITUTION_ID: '00000000-0000-4000-8000-00000000e0b1',
};

function runHarness(env) {
  const base = { ...process.env };
  for (const k of [
    'DATABASE_URL',
    'MIGRATOR_DATABASE_URL',
    'E2E_REGISTRATION_INSTITUTION_ID',
    'E2E_REGISTRATION_TENANT_ID',
    'E2E_REGISTRATION_TENANT_SLUG',
    'GITHUB_STEP_SUMMARY',
    'CI',
  ]) {
    delete base[k];
  }
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...base, ...env },
    timeout: 30_000,
  });
}

for (const missing of [
  'DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'E2E_REGISTRATION_INSTITUTION_ID',
]) {
  test(`missing ${missing} fails closed before seeding`, () => {
    const env = { ...VALID_ENV, E2E_ALLOW_SKIP: '1' };
    delete env[missing];
    const r = runHarness(env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`${missing} is required`));
    assert.doesNotMatch(r.stdout, /Seeding/);
  });
}

test('a non-uuid institution id fails closed', () => {
  const r = runHarness({ ...VALID_ENV, E2E_REGISTRATION_INSTITUTION_ID: 'not-a-uuid' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /must be a v4 uuid/);
});

const NON_LOCAL_REFUSAL = /MIGRATOR_DATABASE_URL host '.*' is not loopback/;

for (const url of [
  'postgresql://mig@db.example.com:5432/none',
  'postgresql://mig:p@10.0.0.5/none',
  'postgresql://mig@127.0.0.1:1,db.example.com:2/none',
  'postgresql://mig@127.0.0.1:1/none?sslmode=disable&host=db.example.com',
]) {
  test(`outside CI a non-loopback migrator host is refused before seeding (${url})`, () => {
    const r = runHarness({ ...VALID_ENV, MIGRATOR_DATABASE_URL: url });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, NON_LOCAL_REFUSAL);
    assert.doesNotMatch(r.stdout, /Seeding/);
  });
}

for (const url of [
  'postgresql://mig@localhost:1/none',
  'postgresql://mig@[::1]:1/none',
  'postgresql:///none?host=%2Fvar%2Frun%2Fpostgresql',
]) {
  test(`outside CI a loopback or socket migrator host passes the guard (${url})`, () => {
    const r = runHarness({ ...VALID_ENV, MIGRATOR_DATABASE_URL: url });
    assert.doesNotMatch(r.stderr, NON_LOCAL_REFUSAL);
  });
}

test('CI=true allows a non-loopback migrator host', () => {
  const r = runHarness({
    ...VALID_ENV,
    CI: 'true',
    MIGRATOR_DATABASE_URL: 'postgresql://mig@192.0.2.1:1/none?connect_timeout=1',
  });
  assert.doesNotMatch(r.stderr, NON_LOCAL_REFUSAL);
});

test('harness requires the live journey, binds loopback and asserts the report', () => {
  const text = readFileSync(script, 'utf8');
  assert.match(text, /E2E_BACKEND_READY=1/);
  assert.match(text, /E2E_REQUIRE_LIVE=1/);
  assert.doesNotMatch(text, /E2E_ALLOW_SKIP|E2E_LIVE_LANE/);
  assert.match(text, /HOST="\$\{E2E_GATEWAY_HOST:-127\.0\.0\.1\}"/);
  assert.match(text, /next start --hostname 127\.0\.0\.1/);
  assert.match(text, /03-registration-live-journey\.spec\.ts/);
  assert.match(text, /assert-registration-live-report\.mjs" --report/);
});

test('harness runs Playwright without retries and writes the uploaded html report', () => {
  const text = readFileSync(script, 'utf8');
  assert.match(
    text,
    /playwright test e2e\/03-registration-live-journey\.spec\.ts[^\n]*\n[^\n]*--retries=0/,
  );
  assert.match(text, /--reporter=list,json,html/);
  assert.match(text, /PLAYWRIGHT_HTML_OPEN=never/);
  assert.match(
    text,
    /PLAYWRIGHT_HTML_OUTPUT_DIR="\$ROOT\/apps\/registration-portal\/playwright-report"/,
  );
  const upload = job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
  assert.match(upload.with.path, /^apps\/registration-portal\/playwright-report\/$/m);
});

test('fixture seed is test data only (no grant, RLS or schema change)', () => {
  const sql = readFileSync(seedPath, 'utf8').replace(/--.*$/gm, '');
  // CREATE/ALTER also cover role attributes and policies.
  assert.doesNotMatch(sql, /\b(GRANT|REVOKE|CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/i);
  assert.match(sql, /INSERT INTO admission_form_configurations/);
  assert.match(sql, /'\[\]'::jsonb/);
});

test('fixture tenant upsert touches only a row with the fixture slug', () => {
  const sql = readFileSync(seedPath, 'utf8').replace(/--.*$/gm, '');
  const upsert = sql.match(/INSERT INTO tenants[\s\S]*?;/)?.[0];
  assert.ok(upsert, 'tenant upsert');
  assert.match(upsert, /ON CONFLICT \(id\) DO UPDATE[\s\S]*WHERE tenants\.slug = EXCLUDED\.slug;$/);
});

test('fixture verify requires the tenant slug passed through set_config', () => {
  const sql = readFileSync(seedPath, 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /set_config\('e2e\.registration_tenant_slug', :'slug', true\)/);
  const verify = sql.match(/DO \$verify\$[\s\S]*\$verify\$;/)?.[0];
  assert.ok(verify, 'verify block');
  assert.match(verify, /v_slug text := current_setting\('e2e\.registration_tenant_slug'\)/);
  assert.match(verify, /t\.id = v_tenant AND t\.slug = v_slug/);
});

test('workflow runs the registration job on PRs, nightly and main pushes', () => {
  assert.ok(job, 'registration-live-journey job is missing');
  assert.equal(job.if, undefined, 'the job must not be conditional');
  assert.equal(job['continue-on-error'], undefined);
  assert.ok(workflow.on.pull_request, 'pull_request trigger');
  assert.ok(workflow.on.schedule, 'schedule trigger');
  assert.deepEqual(workflow.on.push?.branches, ['main']);
  assert.match(job.env.E2E_REGISTRATION_INSTITUTION_ID, /^[0-9a-f-]{36}$/);
  const steps = job.steps.map((s) => s.run ?? '').join('\n');
  assert.match(steps, /bash tools\/scripts\/run-e2e-registration-live\.sh/);
  assert.match(steps, /tools\/scripts\/run-e2e-registration-live\.test\.mjs/);
  assert.doesNotMatch(JSON.stringify(job), /E2E_LIVE_LANE|E2E_ALLOW_SKIP|continue-on-error/);
});

test('registration job asserts the migrator and app roles do not bypass RLS', () => {
  const provision = job.steps.find((s) => /bootstrap-db-roles\.sh/.test(s.run ?? ''));
  assert.ok(provision, 'provision step');
  assert.match(provision.run, /-U proctira -d proctira_test[\s\S]*rolsuper OR rolbypassrls/);
  assert.match(provision.run, /grep -q '\^migrator role OK'/);
  assert.match(provision.run, /-U proctira_app -d proctira_test[\s\S]*rolsuper OR rolbypassrls/);
  assert.match(provision.run, /grep -q '\^app role OK'/);
  const order = job.steps.map((s) => s.name ?? '');
  assert.ok(
    order.indexOf(provision.name) < order.findIndex((n) => /Run registration live journey/.test(n)),
    'role checks run before the journey',
  );
});

test('push to main runs only the registration job', () => {
  assert.equal(workflow.jobs['e2e-backend-ready-shard'].if, "github.event_name != 'push'");
  assert.match(workflow.jobs['e2e-backend-ready'].if, /github\.event_name != 'push'/);
});

test('the required live gate fails unless the registration job succeeded', () => {
  const gate = workflow.jobs['e2e-backend-ready'];
  assert.ok([].concat(gate.needs).includes('registration-live-journey'));
  const step = gate.steps.find((s) => s.env?.REGISTRATION_RESULT);
  assert.ok(step, 'gate step reading the registration job result');
  assert.equal(step.if, 'always()');
  assert.equal(step.env.REGISTRATION_RESULT, '${{ needs.registration-live-journey.result }}');
  assert.match(step.run, /!= "success"/);
  assert.match(step.run, /exit 1/);
});
