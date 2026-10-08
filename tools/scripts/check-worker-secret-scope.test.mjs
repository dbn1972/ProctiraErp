/**
 * NEW-g3_infra_tools-001 — gate test for least-privilege worker secrets.
 *
 * Proves the detector flags a worker that envFroms the full bundle (fails
 * without the deployment fix) and that the real k8s/base tree is clean.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseDeployment,
  workerSecretScopeViolations,
  FULL_BUNDLE_ALLOWLIST,
} from './check-worker-secret-scope.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const WORKER_FULL_BUNDLE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: exam-document-worker
  labels:
    app.kubernetes.io/name: exam-document-worker
    app.kubernetes.io/component: worker
spec:
  template:
    spec:
      containers:
        - name: exam-document-worker
          envFrom:
            - configMapRef:
                name: proctira-config
            - secretRef:
                name: proctira-secrets
`;

const WORKER_SCOPED = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: exam-document-worker
  labels:
    app.kubernetes.io/name: exam-document-worker
    app.kubernetes.io/component: worker
spec:
  template:
    spec:
      containers:
        - name: exam-document-worker
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: proctira-secrets
                  key: DATABASE_URL
            - name: RABBITMQ_URL
              valueFrom:
                secretKeyRef:
                  name: proctira-secrets
                  key: RABBITMQ_URL
          envFrom:
            - configMapRef:
                name: proctira-config
`;

function fixtureBase(files) {
  const base = mkdtempSync(join(tmpdir(), 'worker-secret-scope-'));
  for (const [dir, text] of Object.entries(files)) {
    mkdirSync(join(base, dir), { recursive: true });
    writeFileSync(join(base, dir, 'deployment.yaml'), text);
  }
  return base;
}

test('parseDeployment detects envFrom full bundle vs scoped secretKeyRef', () => {
  assert.equal(parseDeployment(WORKER_FULL_BUNDLE).envFromFullBundle, true);
  assert.equal(parseDeployment(WORKER_FULL_BUNDLE).component, 'worker');
  assert.equal(parseDeployment(WORKER_SCOPED).envFromFullBundle, false);
});

test('a worker that envFroms the full bundle is a violation (fails without the fix)', () => {
  const base = fixtureBase({ 'exam-document-worker': WORKER_FULL_BUNDLE });
  try {
    const violations = workerSecretScopeViolations(base);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /exam-document-worker/);
    assert.match(violations[0], /full proctira-secrets bundle/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a worker scoped to per-key secretKeyRef passes', () => {
  const base = fixtureBase({ 'exam-document-worker': WORKER_SCOPED });
  try {
    assert.deepEqual(workerSecretScopeViolations(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a non-allowlisted non-worker that envFroms the full bundle fails closed', () => {
  const rogue = WORKER_FULL_BUNDLE.replace(/exam-document-worker/g, 'rogue-service').replace(
    'component: worker',
    'component: backend',
  );
  const base = fixtureBase({ rogue: rogue });
  try {
    const violations = workerSecretScopeViolations(base);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /FULL_BUNDLE_ALLOWLIST/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('api-gateway is allowlisted (in-process domain host)', () => {
  assert.ok(FULL_BUNDLE_ALLOWLIST.has('api-gateway'));
});

test('the real infrastructure/k8s/base tree has no worker secret-scope violations', () => {
  assert.deepEqual(workerSecretScopeViolations(join(root, 'infrastructure/k8s/base')), []);
});
