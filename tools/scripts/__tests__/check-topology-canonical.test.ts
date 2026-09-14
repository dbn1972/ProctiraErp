/**
 * W1-OPS-16 — regression coverage for the canonical topology gate.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-topology-canonical.sh');
const repoRoot = resolve(here, '../../..');

describe('check-topology-canonical (W1-OPS-16)', () => {
  it('passes against the repository tree', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, combined).toBe(0);
    expect(result.stdout ?? '').toContain('W1-OPS-16 OK');
  });

  it('fails when production enables a split-domain service', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-16-'));
    try {
      const files = [
        'docs/audits/OPS_W1_OPS_16_TOPOLOGY.md',
        'docs/DEPLOYMENT_TOPOLOGY.md',
        'docs/architecture/HIGH_LEVEL.md',
        'docker-compose.yml',
        'infrastructure/docker/docker-compose.services.yml',
        'infrastructure/helm/proctira-platform/values.yaml',
        'infrastructure/helm/proctira-platform/values-production.yaml',
        'infrastructure/k8s/base/kustomization.yaml',
        'infrastructure/k8s/overlays/production/kustomization.yaml',
        'infrastructure/k8s/components/split-domain-services/kustomization.yaml',
        'infrastructure/k8s/overlays/lab-split/kustomization.yaml',
      ];
      for (const rel of files) {
        const dest = join(fixture, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(repoRoot, rel), dest);
      }

      const prod = join(fixture, 'infrastructure/helm/proctira-platform/values-production.yaml');
      writeFileSync(
        prod,
        readFileSync(prod, 'utf8').replace(
          /institutionService:\n  enabled: false/,
          'institutionService:\n  enabled: true',
        ),
        'utf8',
      );

      const localScript = join(fixture, 'tools/scripts/check-topology-canonical.sh');
      mkdirSync(dirname(localScript), { recursive: true });
      writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });

      const result = spawnSync('bash', [localScript], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, ROOT: fixture },
      });
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, combined).not.toBe(0);
      expect(combined).toMatch(/institutionService|enabled: false/i);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
