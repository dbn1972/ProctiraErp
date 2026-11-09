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
  ]) {
    delete base[k];
  }
  return spawnSync('bash', [script], { encoding: 'utf8', env: { ...base, ...env } });
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

test('fixture seed is test data only (no grant, RLS or schema change)', () => {
  const sql = readFileSync(seedPath, 'utf8').replace(/--.*$/gm, '');
  // CREATE/ALTER also cover role attributes and policies.
  assert.doesNotMatch(sql, /\b(GRANT|REVOKE|CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/i);
  assert.match(sql, /INSERT INTO admission_form_configurations/);
  assert.match(sql, /'\[\]'::jsonb/);
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
