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

// PRC-H062 — the proctira-platform chart (pg-backup + phi-retention CronJobs,
// ingress, NetworkPolicy, durable workers) must be deployed by CI, fail closed
// on a missing pre-created Secret, and gated like the service deploy.
function platformDeployStep() {
  const start = deploy.indexOf('- name: Deploy proctira-platform chart via Helm');
  assert.ok(start >= 0, 'deploy.yml must deploy the proctira-platform chart (PRC-H062)');
  const end = deploy.indexOf('- name: ', start + 10);
  return deploy.slice(start, end === -1 ? undefined : end);
}

test('deploy-platform job exists and is gated on migrate + runtime-role', () => {
  const jobStart = deploy.indexOf('deploy-platform:');
  assert.ok(jobStart >= 0, 'deploy.yml must define a deploy-platform job');
  const block = deploy.slice(jobStart, jobStart + 600);
  assert.match(
    block,
    /needs:\s*\[ci-gate, prepare, build-images, migrate-database, runtime-role-gate\]/,
  );
  assert.match(block, /environment: \$\{\{ needs\.prepare\.outputs\.environment \}\}/);
});

// The helm invocation lives in tools/scripts/deploy-platform-helm.sh so the
// render contract (check-platform-deploy-render.mjs) templates the same args.
const platformHelm = readFileSync(join(root, 'tools/scripts/deploy-platform-helm.sh'), 'utf8');
const PLATFORM_INVOKE = 'bash tools/scripts/deploy-platform-helm.sh upgrade';

test('platform deploy installs the proctira-platform chart with the pre-created Secret', () => {
  const step = platformDeployStep();
  assert.ok(step.includes(PLATFORM_INVOKE), 'platform step must run deploy-platform-helm.sh');
  assert.match(platformHelm, /RELEASE=proctira-platform/);
  assert.match(platformHelm, /CHART=\.\/infrastructure\/helm\/proctira-platform/);
  assert.match(platformHelm, /"\$HELM" upgrade --install "\$RELEASE" "\$CHART"/);
  assert.match(platformHelm, /secrets\.existingSecret="\$\{PLATFORM_EXISTING_SECRET\}"/);
  assert.match(platformHelm, /for var in [^\n]*PLATFORM_EXISTING_SECRET/);
});

test('platform deploy fails closed before helm when the Secret var is unset', () => {
  const step = platformDeployStep();
  const guard = step.indexOf('if [ -z "${PLATFORM_EXISTING_SECRET}" ]');
  assert.ok(guard >= 0, 'platform deploy must refuse an empty PLATFORM_EXISTING_SECRET');
  assert.ok(guard < step.indexOf(PLATFORM_INVOKE), 'guard must precede helm');
  assert.match(step.slice(guard, step.indexOf(PLATFORM_INVOKE)), /exit 1/);
});

test('platform deploy keeps edge apps and the Ingress out of the release', () => {
  for (const key of [
    'ingress',
    'apiGateway',
    'web',
    'registrationPortal',
    'publicWebsite',
    'adminConsole',
    'developerPortal',
  ]) {
    assert.match(platformHelm, new RegExp(`--set ${key}\\.enabled=false`));
  }
  assert.match(platformHelm, /--values "\$\{CHART\}\/values-workers-only\.yaml"/);
});

test('legacy thin-chart etl-worker release is removed before the platform install', () => {
  const step = platformDeployStep();
  const uninstall = step.indexOf('helm uninstall proctira-etl-worker');
  assert.ok(uninstall >= 0, 'platform deploy must retire the thin-chart etl-worker release');
  assert.ok(uninstall < step.indexOf(PLATFORM_INVOKE), 'uninstall must precede the install');
  assert.match(step, /if helm status proctira-etl-worker/);
});

test('platform images are built on every deploy and skipped by the thin chart', () => {
  const prep = deploy.slice(deploy.indexOf('- name: Detect affected services'));
  assert.match(prep, /for img in etl-worker exam-document-worker dr-tools/);
  assert.equal((prep.match(/with_platform_images "\$\{SERVICES\}"/g) ?? []).length, 2);
  assert.match(deployStep(), /etl-worker\|exam-document-worker\|dr-tools\)/);
});

test('platform secret var reaches the shell only through env', () => {
  const step = platformDeployStep();
  assert.match(step, /PLATFORM_EXISTING_SECRET: \$\{\{ vars\.PLATFORM_EXISTING_SECRET \}\}/);
  const script = step.slice(step.indexOf('run: |'));
  assert.doesNotMatch(script, /\$\{\{\s*vars\./);
});

test('platform deploy verifies the DR CronJobs it just introduced', () => {
  const verifyStart = deploy.indexOf('- name: Verify DR CronJobs and workers exist');
  assert.ok(verifyStart >= 0, 'platform deploy must verify pg-backup/phi-retention exist');
  const block = deploy.slice(verifyStart, verifyStart + 1200);
  assert.match(block, /pg-backup/);
  assert.match(block, /phi-retention/);
  assert.match(block, /exam-document-worker/);
});

test('PRC-H062: platform deploy runs the CI-pushed worker and DR images', () => {
  assert.match(platformHelm, /image-repository\.sh "\$REGISTRY" "\$IMAGE_NAMESPACE" "\$1"/);
  for (const [key, svc] of [
    ['examDocumentWorker', 'exam-document-worker'],
    ['etlWorker', 'etl-worker'],
    ['dr', 'dr-tools'],
  ]) {
    assert.match(platformHelm, new RegExp(`repo ${svc}\\)`));
    assert.match(platformHelm, new RegExp(`--set-string ${key}\\.image\\.repository=`));
    assert.match(
      platformHelm,
      new RegExp(`--set-string ${key}\\.image\\.tag="\\$\\{IMAGE_TAG\\}"`),
    );
  }
});
