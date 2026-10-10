/**
 * PRC-H062 — render contract for the deploy-platform job (#590 review blocker 2).
 *
 * 1. The violation checker itself: a manifest set shaped like the pre-fix
 *    render (edge Deployments from `proctira/<app>:1.0.0` + an Ingress) must be
 *    rejected, and a workers-only CI-built set must pass.
 * 2. The real `helm template` of tools/scripts/deploy-platform-helm.sh for
 *    staging and production must pass. Helm is required in CI; locally set
 *    HELM to a helm binary or wrapper (fails, never silently skips, under CI).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  CI_COORDS,
  ciRepository,
  parseManifests,
  platformRenderViolations,
  renderPlatformDeploy,
} from './check-platform-deploy-render.mjs';

const coords = CI_COORDS;
const img = (svc) => `${ciRepository(coords.registry, coords.namespace, svc)}:${coords.tag}`;

function deployment(name, image) {
  return {
    kind: 'Deployment',
    metadata: { name: `proctira-platform-${name}`, labels: { 'app.kubernetes.io/name': name } },
    spec: {
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': name } },
        spec: { containers: [{ name, image }] },
      },
    },
  };
}

function cronJob(name, image) {
  return {
    kind: 'CronJob',
    metadata: { name: `proctira-platform-${name}` },
    spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name, image }] } } } } },
  };
}

const workersOnly = () => [
  deployment('etl-worker', img('etl-worker')),
  deployment('exam-document-worker', img('exam-document-worker')),
  cronJob('pg-backup', img('dr-tools')),
  cronJob('phi-retention', img('dr-tools')),
];

test('workers-only CI-built render passes', () => {
  assert.deepEqual(platformRenderViolations(workersOnly(), coords), []);
});

test('pre-fix shaped render (edge apps from Docker Hub + Ingress) is rejected', () => {
  const docs = [
    ...workersOnly(),
    deployment('api-gateway', 'proctira/api-gateway:1.0.0'),
    deployment('web', 'proctira/web:1.0.0'),
    { kind: 'Ingress', metadata: { name: 'proctira-platform' } },
  ];
  const v = platformRenderViolations(docs, coords).join('\n');
  assert.match(v, /api-gateway.*must not render/);
  assert.match(v, /Docker Hub default image proctira\/api-gateway:1\.0\.0/);
  assert.match(v, /kind Ingress must not render/);
});

test('DR CronJob on the chart default image is rejected', () => {
  const docs = workersOnly();
  docs[2] = cronJob('pg-backup', 'proctira/dr-tools:1.0.0');
  assert.match(platformRenderViolations(docs, coords).join('\n'), /pg-backup.*Docker Hub default/);
});

test('worker on the wrong tag is rejected', () => {
  const docs = workersOnly();
  docs[0] = deployment('etl-worker', img('etl-worker').replace(`:${coords.tag}`, ':stale'));
  assert.match(platformRenderViolations(docs, coords).join('\n'), /etl-worker.*must be/);
});

function helmAvailable() {
  try {
    execFileSync(process.env.HELM || 'helm', ['version', '--short'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const haveHelm = helmAvailable();
if (!haveHelm && process.env.CI) {
  throw new Error('helm is required for the platform render contract in CI (PRC-H062)');
}

for (const environment of ['staging', 'production']) {
  test(
    `real deploy-platform render [${environment}] is workers + DR only`,
    { skip: !haveHelm },
    () => {
      const docs = parseManifests(renderPlatformDeploy({ environment, ...coords }));
      assert.deepEqual(platformRenderViolations(docs, coords), []);
      const kinds = new Set(docs.map((d) => d.kind));
      assert.ok(!kinds.has('Ingress'), 'no Ingress');
      assert.ok(kinds.has('CronJob'), 'DR CronJobs still render');
    },
  );
}
