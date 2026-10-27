/**
 * W1-OPS-17 — regression coverage for the production replica / PDB gate.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-replica-policy.sh');
const repoRoot = resolve(here, '../../..');

const FIXTURE_FILES = [
  'docs/audits/OPS_W1_OPS_17_REPLICAS.md',
  'infrastructure/ops/production-replica-policy.yaml',
  'infrastructure/helm/proctira-platform/values-production.yaml',
  'infrastructure/helm/proctira-service/values-production.yaml',
  'infrastructure/k8s/base/kustomization.yaml',
  'infrastructure/k8s/overlays/production/kustomization.yaml',
  'infrastructure/k8s/overlays/production/pod-disruption-budget.yaml',
  'infrastructure/k8s/base/api-gateway/deployment.yaml',
  'infrastructure/k8s/base/api-gateway/hpa.yaml',
  'infrastructure/k8s/base/web/deployment.yaml',
  'infrastructure/k8s/base/web/hpa.yaml',
  'infrastructure/k8s/base/etl-worker/deployment.yaml',
  'infrastructure/k8s/base/etl-worker/hpa.yaml',
  'infrastructure/k8s/base/registration-portal/deployment.yaml',
  'infrastructure/k8s/base/registration-portal/hpa.yaml',
  'infrastructure/k8s/base/public-website/deployment.yaml',
  'infrastructure/k8s/base/public-website/hpa.yaml',
  'infrastructure/k8s/base/admin-console/deployment.yaml',
  'infrastructure/k8s/base/developer-portal/deployment.yaml',
  // PRC-L567: PDB resolution across overlays.
  'infrastructure/k8s/overlays/production/etl-worker-pdb.yaml',
  'infrastructure/k8s/overlays/development/kustomization.yaml',
  'infrastructure/k8s/overlays/staging/kustomization.yaml',
  'infrastructure/k8s/overlays/lab-split/kustomization.yaml',
  'infrastructure/k8s/components/image-tag/kustomization.yaml',
  'infrastructure/k8s/components/split-domain-services/kustomization.yaml',
  'infrastructure/k8s/base/web/pdb.yaml',
  'infrastructure/k8s/base/registration-portal/pdb.yaml',
  'infrastructure/k8s/base/public-website/pdb.yaml',
  'infrastructure/k8s/base/admin-console/pdb.yaml',
  'infrastructure/k8s/base/developer-portal/pdb.yaml',
  'infrastructure/k8s/base/api-gateway/pdb.yaml',
  'infrastructure/k8s/base/exam-document-worker/pdb.yaml',
];

function runOnFixture(mutate: (fixture: string) => void) {
  const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-17-'));
  try {
    for (const rel of FIXTURE_FILES) {
      const dest = join(fixture, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(repoRoot, rel), dest);
    }
    mutate(fixture);
    const localScript = join(fixture, 'tools/scripts/check-replica-policy.sh');
    mkdirSync(dirname(localScript), { recursive: true });
    writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });
    const result = spawnSync('bash', [localScript], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, ROOT: fixture },
    });
    return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
describe('check-replica-policy (W1-OPS-17)', () => {
  it('passes against the repository tree', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, combined).toBe(0);
    expect(result.stdout ?? '').toContain('W1-OPS-17 OK');
  });

  it('fails when kustomize production drops etl-worker to a single replica', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-17-'));
    try {
      for (const rel of FIXTURE_FILES) {
        const dest = join(fixture, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(repoRoot, rel), dest);
      }

      const kust = join(fixture, 'infrastructure/k8s/overlays/production/kustomization.yaml');
      writeFileSync(
        kust,
        readFileSync(kust, 'utf8').replace(
          /name: etl-worker\n    patch: \|\n      - op: replace\n        path: \/spec\/replicas\n        value: 2/,
          'name: etl-worker\n    patch: |\n      - op: replace\n        path: /spec/replicas\n        value: 1',
        ),
        'utf8',
      );

      // Also drop base so effective cannot hide behind base=2 without patch
      const baseDep = join(fixture, 'infrastructure/k8s/base/etl-worker/deployment.yaml');
      writeFileSync(
        baseDep,
        readFileSync(baseDep, 'utf8').replace(/replicas:\s*2/, 'replicas: 1'),
        'utf8',
      );

      const localScript = join(fixture, 'tools/scripts/check-replica-policy.sh');
      mkdirSync(dirname(localScript), { recursive: true });
      writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });

      const result = spawnSync('bash', [localScript], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, ROOT: fixture },
      });
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, combined).not.toBe(0);
      expect(combined).toMatch(/etl-worker|replicas/i);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it('PRC-L567: fails when a production PDB is a second resource over a base PDB', () => {
    const { status, out } = runOnFixture((fixture) => {
      const kust = join(fixture, 'infrastructure/k8s/overlays/production/kustomization.yaml');
      writeFileSync(
        kust,
        readFileSync(kust, 'utf8').replace(
          '  - etl-worker-pdb.yaml\n',
          '  - etl-worker-pdb.yaml\n  - pod-disruption-budget.yaml\n',
        ),
        'utf8',
      );
    });
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/production: 2 PDBs select app\.kubernetes\.io\/name=api-gateway/);
  });
  it('PRC-L567: fails when development keeps minAvailable with replicas=1', () => {
    const { status, out } = runOnFixture((fixture) => {
      const kust = join(fixture, 'infrastructure/k8s/overlays/development/kustomization.yaml');
      writeFileSync(
        kust,
        readFileSync(kust, 'utf8').replace(
          /      kind: PodDisruptionBudget\n/,
          '      kind: Unrelated\n',
        ),
        'utf8',
      );
    });
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/development PDB web minAvailable=1 with replicas=1/);
  });
  it('PRC-L567: fails when a PDB patch names no PDB resource', () => {
    const { status, out } = runOnFixture((fixture) => {
      const pdb = join(
        fixture,
        'infrastructure/k8s/overlays/production/pod-disruption-budget.yaml',
      );
      writeFileSync(
        pdb,
        readFileSync(pdb, 'utf8').replace('  name: web\n', '  name: web-pdb\n'),
        'utf8',
      );
    });
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/PDB patch web-pdb matches no PDB resource/);
  });
});
