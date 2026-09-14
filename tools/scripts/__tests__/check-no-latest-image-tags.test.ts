/**
 * W1-OPS-08 — regression coverage for the prod-path :latest image-tag guard.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-no-latest-image-tags.sh');
const repoRoot = resolve(here, '../..');

function writeScript(fixtureRoot: string): string {
  const localScript = join(fixtureRoot, 'tools/scripts/check-no-latest-image-tags.sh');
  mkdirSync(dirname(localScript), { recursive: true });
  writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });
  return localScript;
}

function seedK8sOk(fixture: string): void {
  const deployDir = join(fixture, 'infrastructure/k8s/base/api-gateway');
  mkdirSync(deployDir, { recursive: true });
  mkdirSync(join(fixture, 'infrastructure/k8s/components/image-tag'), {
    recursive: true,
  });
  writeFileSync(
    join(deployDir, 'deployment.yaml'),
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: api-gateway',
      '          image: proctira/api-gateway:sha-pending',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(fixture, 'infrastructure/k8s/components/image-tag/kustomization.yaml'),
    [
      'apiVersion: kustomize.config.k8s.io/v1alpha1',
      'kind: Component',
      'images:',
      '  - name: proctira/api-gateway',
      '    newTag: sha-pending',
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('check-no-latest-image-tags (W1-OPS-08)', () => {
  it('passes against the repository prod deploy paths', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, combined).toBe(0);
    expect(result.stdout ?? '').toContain('W1-OPS-08 OK');
  });

  it('fails when a deployment uses :latest', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-08-'));
    try {
      seedK8sOk(fixture);
      writeFileSync(
        join(fixture, 'infrastructure/k8s/base/api-gateway/deployment.yaml'),
        [
          'apiVersion: apps/v1',
          'kind: Deployment',
          'spec:',
          '  template:',
          '    spec:',
          '      containers:',
          '        - name: api-gateway',
          '          image: proctira/api-gateway:latest',
          '',
        ].join('\n'),
        'utf8',
      );

      const localScript = writeScript(fixture);
      const result = spawnSync('bash', [localScript], {
        cwd: fixture,
        encoding: 'utf8',
      });
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, combined).not.toBe(0);
      expect(combined).toMatch(/:latest/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails when Helm values default tag is latest', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-08-helm-'));
    try {
      seedK8sOk(fixture);
      const valuesDir = join(fixture, 'infrastructure/helm/proctira-service');
      mkdirSync(valuesDir, { recursive: true });
      writeFileSync(
        join(valuesDir, 'values.yaml'),
        ['image:', '  repository: ghcr.io/proctira/api-gateway', '  tag: latest', ''].join(
          '\n',
        ),
        'utf8',
      );

      const localScript = writeScript(fixture);
      const result = spawnSync('bash', [localScript], {
        cwd: fixture,
        encoding: 'utf8',
      });
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, combined).not.toBe(0);
      expect(combined).toMatch(/tag: latest|latest/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails when deploy.yml still pushes :latest', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-08-deploy-'));
    try {
      seedK8sOk(fixture);
      const wfDir = join(fixture, '.github/workflows');
      mkdirSync(wfDir, { recursive: true });
      writeFileSync(
        join(wfDir, 'deploy.yml'),
        [
          'name: Deploy',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - run: echo ok',
          '        env:',
          '          IMAGE: ghcr.io/proctira/api-gateway:latest',
          '',
        ].join('\n'),
        'utf8',
      );

      const localScript = writeScript(fixture);
      const result = spawnSync('bash', [localScript], {
        cwd: fixture,
        encoding: 'utf8',
      });
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, combined).not.toBe(0);
      expect(combined).toMatch(/:latest/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
