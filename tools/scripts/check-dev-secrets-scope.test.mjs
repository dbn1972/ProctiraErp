/**
 * PRC-L475 — gate test for the dev placeholder credential scope check.
 *
 * Proves the detector flags a dev-only literal committed outside
 * overlays/development (fails without the fix — i.e. on a scratch copy that
 * simulates the gap before this gate existed) and that the real
 * infrastructure/k8s and infrastructure/helm trees are clean.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEV_PLACEHOLDER_LITERALS, devSecretsScopeViolations } from './check-dev-secrets-scope.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixtureRepo(files) {
  const base = mkdtempSync(join(tmpdir(), 'dev-secrets-scope-'));
  for (const [relPath, text] of Object.entries(files)) {
    const full = join(base, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return base;
}

test('a dev placeholder literal committed outside overlays/development is a violation (fails without the fix)', () => {
  const base = fixtureRepo({
    'infrastructure/k8s/overlays/staging/secrets.yaml':
      "DATABASE_URL: 'postgresql://proctira_app:proctira_app_dev@postgres:5432/proctira'\n",
  });
  try {
    const violations = devSecretsScopeViolations(
      [join(base, 'infrastructure/k8s'), join(base, 'infrastructure/helm')],
      base,
    );
    assert.equal(violations.length, 1);
    assert.match(violations[0], /overlays\/staging\/secrets\.yaml/);
    assert.match(violations[0], /proctira_app_dev/);
    assert.match(violations[0], /PRC-L475/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the same literal inside overlays/development is allowed', () => {
  const base = fixtureRepo({
    'infrastructure/k8s/overlays/development/secrets.yaml':
      "S3_ACCESS_KEY: 'minioadmin'\n",
  });
  try {
    assert.deepEqual(
      devSecretsScopeViolations(
        [join(base, 'infrastructure/k8s'), join(base, 'infrastructure/helm')],
        base,
      ),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('DEV_PLACEHOLDER_LITERALS covers every literal from overlays/development/secrets.yaml', () => {
  for (const literal of [
    'minioadmin',
    'proctira_app_dev',
    'proctira_dev',
    'dev-only-jwt-secret-not-for-production-0123456789ab',
    'dev-only-cookie-secret-not-for-production-0123456789',
  ]) {
    assert.ok(DEV_PLACEHOLDER_LITERALS.includes(literal), `missing literal ${literal}`);
  }
});

test('the real infrastructure/k8s and infrastructure/helm trees have no dev-secrets-scope violations', () => {
  assert.deepEqual(
    devSecretsScopeViolations(
      [join(root, 'infrastructure/k8s'), join(root, 'infrastructure/helm')],
      root,
    ),
    [],
  );
});
