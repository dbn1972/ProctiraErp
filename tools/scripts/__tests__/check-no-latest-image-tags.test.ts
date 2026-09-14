/**
 * W1-OPS-08 — regression coverage for the k8s :latest image-tag guard.
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

describe('check-no-latest-image-tags (W1-OPS-08)', () => {
  it('passes against the repository infrastructure/k8s tree', () => {
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
          '          image: proctira/api-gateway:latest',
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

      const localScript = join(fixture, 'tools/scripts/check-no-latest-image-tags.sh');
      mkdirSync(dirname(localScript), { recursive: true });
      writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });

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
