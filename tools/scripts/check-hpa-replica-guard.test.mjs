/**
 * PRC-M598 — gate test for the HPA / replicas anti-pattern guard.
 *
 * Proves the detector flags an HPA-targeted Deployment that still sets
 * replicas unconditionally (fails without the fix) and that the real
 * platform chart templates are clean.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hasReplicaGuard, hpaReplicaGuardViolations } from './check-hpa-replica-guard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const UNGUARDED_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: {{ .Values.web.replicaCount }}
  revisionHistoryLimit: 5
`;

const GUARDED_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  {{- if not .Values.web.autoscaling.enabled }}
  replicas: {{ .Values.web.replicaCount }}
  {{- end }}
  revisionHistoryLimit: 5
`;

const HPA_STUB = `{{- if and .Values.web.enabled .Values.web.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
{{- end }}
`;

function fixtureDir(deploymentText, { withHpa = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'hpa-replica-guard-'));
  const dir = join(base, 'web');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'deployment.yaml'), deploymentText);
  if (withHpa) writeFileSync(join(dir, 'hpa.yaml'), HPA_STUB);
  return base;
}

test('hasReplicaGuard detects the unconditional vs guarded replicas line', () => {
  assert.equal(hasReplicaGuard(UNGUARDED_DEPLOYMENT), false);
  assert.equal(hasReplicaGuard(GUARDED_DEPLOYMENT), true);
});

test('a Deployment with a sibling hpa.yaml and unconditional replicas is a violation (fails without the fix)', () => {
  const base = fixtureDir(UNGUARDED_DEPLOYMENT);
  try {
    const violations = hpaReplicaGuardViolations(base);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /"web"/);
    assert.match(violations[0], /PRC-M598/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a Deployment with the guard passes', () => {
  const base = fixtureDir(GUARDED_DEPLOYMENT);
  try {
    assert.deepEqual(hpaReplicaGuardViolations(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a Deployment with no sibling hpa.yaml is not checked, even unguarded', () => {
  const base = fixtureDir(UNGUARDED_DEPLOYMENT, { withHpa: false });
  try {
    assert.deepEqual(hpaReplicaGuardViolations(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the real platform chart templates have no HPA/replicas violations', () => {
  assert.deepEqual(
    hpaReplicaGuardViolations(join(root, 'infrastructure/helm/proctira-platform/templates')),
    [],
  );
});
