/**
 * PRC-H062 — the CI deploy path must inject secrets through External Secrets
 * and fail closed when the environment's secret store is not configured.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');

function deployStep() {
  const start = deploy.indexOf('- name: Deploy services via Helm');
  assert.ok(start >= 0, 'deploy.yml must have a "Deploy services via Helm" step');
  const end = deploy.indexOf('- name: ', start + 10);
  return deploy.slice(start, end === -1 ? undefined : end);
}

test('helm install enables ExternalSecret with a store and the shared bundle', () => {
  const step = deployStep();
  assert.match(step, /--set externalSecret\.enabled=true/);
  assert.match(step, /externalSecret\.secretStoreRef\.name="\$\{EXTERNAL_SECRET_STORE\}"/);
  assert.match(step, /externalSecret\.sharedRemoteKey="\$\{SHARED_REMOTE_KEY\}"/);
});

test('missing secret store fails the deploy before any helm call', () => {
  const step = deployStep();
  const guard = step.indexOf('if [ -z "${EXTERNAL_SECRET_STORE}" ]');
  assert.ok(guard >= 0, 'deploy must refuse an empty EXTERNAL_SECRET_STORE');
  assert.ok(guard < step.indexOf('helm upgrade --install'), 'guard must precede helm');
  assert.match(step.slice(guard, step.indexOf('helm upgrade --install')), /exit 1/);
});

test('the store name is passed through env, not interpolated into the script', () => {
  const step = deployStep();
  assert.match(step, /EXTERNAL_SECRET_STORE: \$\{\{ vars\.EXTERNAL_SECRET_STORE \}\}/);
  const script = step.slice(step.indexOf('run: |'));
  assert.doesNotMatch(script, /\$\{\{\s*vars\./);
});
