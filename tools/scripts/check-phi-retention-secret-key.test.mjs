#!/usr/bin/env node
/**
 * PRC-M623 (N2) — pre-deploy key-presence check for the PHI retention CronJob.
 * Run with: node --test tools/scripts/check-phi-retention-secret-key.test.mjs
 * kubectl is a stub; the production render case needs helm on PATH.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const script = join(here, 'check-phi-retention-secret-key.sh');

const CRONJOB = `---
# Source: proctira-platform/templates/dr/phi-retention-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: proctira-platform-phi-retention
  namespace: proctira-production
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: phi-retention
              env:
                - name: RETENTION_DRY_RUN
                  value: "0"
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: proctira-prod-secrets
                      key: PHI_RETENTION_DATABASE_URL
`;
const BACKUP_CRONJOB = `---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: proctira-platform-pg-backup
  namespace: proctira-production
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: pg-backup
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: proctira-prod-secrets
                      key: BACKUP_DATABASE_URL
`;

/** @param {{ stdout?: string, exit?: number }} stub */
function run(manifest, stub = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'phi-secret-key-'));
  const manifestPath = join(dir, 'platform.yaml');
  writeFileSync(manifestPath, manifest);
  const argsLog = join(dir, 'kubectl-args');
  const kubectl = join(dir, 'kubectl');
  writeFileSync(
    kubectl,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${argsLog}'\nprintf '%s' '${stub.stdout ?? ''}'\nexit ${stub.exit ?? 0}\n`,
  );
  chmodSync(kubectl, 0o755);
  const res = spawnSync('bash', [script, manifestPath], {
    encoding: 'utf8',
    env: { ...process.env, KUBECTL: kubectl },
  });
  let args = [];
  try {
    args = readFileSync(argsLog, 'utf8').trim().split('\n');
  } catch {
    args = [];
  }
  return { ...res, args };
}

test('passes when the Secret the CronJob reads has the key', () => {
  const res = run(BACKUP_CRONJOB + CRONJOB, { stdout: 'present' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /PASS \(proctira-production\/proctira-prod-secrets has key PHI_RETENTION_DATABASE_URL\)/,
  );
  assert.deepEqual(res.args.slice(0, 5), [
    'get',
    'secret',
    'proctira-prod-secrets',
    '-n',
    'proctira-production',
  ]);
  // Only a presence word is requested from kubectl, never the value.
  assert.match(res.args[5], /^-o$/);
  assert.match(
    res.args[6],
    /^go-template=.*index \.data "PHI_RETENTION_DATABASE_URL".*present.*missing/,
  );
});

test('fails when the key is missing or empty in the Secret', () => {
  const res = run(CRONJOB, { stdout: 'missing' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /has no non-empty key PHI_RETENTION_DATABASE_URL/);
});

test('fails closed when the Secret cannot be read', () => {
  const res = run(CRONJOB, { exit: 1 });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /cannot read Secret proctira-production\/proctira-prod-secrets/);
});

test('skips when no phi-retention CronJob is rendered', () => {
  const res = run(BACKUP_CRONJOB, { stdout: 'missing' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /SKIP/);
  assert.deepEqual(res.args, []);
});

test('fails on an empty manifest (a failed render is not "nothing to check")', () => {
  const res = run('', { stdout: 'present' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no rendered manifests/);
});

test('reads the key from the real production platform render', () => {
  const render = spawnSync('bash', [join(here, 'deploy-platform-helm.sh'), 'template'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ENVIRONMENT: 'production',
      IMAGE_TAG: 'sha-0123456789abcdef0123456789abcdef01234567',
      PLATFORM_EXISTING_SECRET: 'proctira-prod-secrets',
      REGISTRY: 'ghcr.io',
      IMAGE_NAMESPACE: 'example',
    },
  });
  assert.equal(render.status, 0, render.stderr);
  const res = run(render.stdout, { stdout: 'present' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /proctira-production\/proctira-prod-secrets has key PHI_RETENTION_DATABASE_URL/,
  );
});
