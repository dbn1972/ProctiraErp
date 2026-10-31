/**
 * PRC-L565 — helm-template coverage for the DNS-01 ClusterIssuer.
 *
 * The wildcard `*.proctira.io` certificate needs a DNS-01 solver, so the chart
 * can render a Route 53 ClusterIssuer that authenticates through IRSA (no
 * static AWS keys). It is disabled by default and in production until the
 * hosted zone ID and IRSA role ARN are provisioned (decision register ## 41,
 * Topic 25 — WAITING_ON_INPUT). These tests pin that contract:
 *
 *   1. disabled by default            → no ClusterIssuer is rendered
 *   2. enabled + complete inputs      → a valid Route 53 DNS-01 ClusterIssuer
 *                                       with NO static access keys (IRSA role)
 *   3. enabled + missing input        → render fails closed (required)
 *   4. production values              → ClusterIssuer stays disabled
 *
 * These are render-only assertions; nothing is deployed. `helm` must be on
 * PATH (v3). The suite skips with a clear message if it is not installed.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const chartDir = resolve(repoRoot, 'infrastructure/helm/proctira-platform');

function helmAvailable(): boolean {
  const probe = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
  return probe.status === 0;
}

function helmTemplate(extraArgs: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('helm', ['template', 'release', chartDir, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

const run = helmAvailable() ? describe : describe.skip;

run('cert-manager DNS-01 ClusterIssuer (PRC-L565)', () => {
  it('renders no ClusterIssuer with the default values (disabled)', () => {
    const out = helmTemplate([]);
    const combined = `${out.stdout ?? ''}${out.stderr ?? ''}`;
    expect(out.status, combined).toBe(0);
    expect(out.stdout ?? '').not.toContain('kind: ClusterIssuer');
  });

  it('renders a Route 53 DNS-01 ClusterIssuer with IRSA (no static keys) when enabled', () => {
    const out = helmTemplate([
      '--set',
      'certManager.clusterIssuer.enabled=true',
      '--set',
      'certManager.clusterIssuer.dns01.hostedZoneID=Z123EXAMPLE',
      '--set',
      'certManager.clusterIssuer.dns01.role.roleArn=arn:aws:iam::111122223333:role/cert-manager-dns01',
    ]);
    const combined = `${out.stdout ?? ''}${out.stderr ?? ''}`;
    expect(out.status, combined).toBe(0);
    const yaml = out.stdout ?? '';
    expect(yaml).toContain('kind: ClusterIssuer');
    expect(yaml).toContain('apiVersion: cert-manager.io/v1');
    // DNS-01 Route 53 solver bound to the wildcard zone.
    expect(yaml).toContain('route53:');
    expect(yaml).toContain('hostedZoneID: "Z123EXAMPLE"');
    expect(yaml).toContain('"proctira.io"'); // wildcard '*.' stripped for dnsZones
    expect(yaml).toContain('role: "arn:aws:iam::111122223333:role/cert-manager-dns01"');
    // IRSA only — no static AWS credentials may appear.
    expect(yaml).not.toContain('accessKeyID');
    expect(yaml).not.toContain('secretAccessKeySecretRef');
    expect(yaml).not.toMatch(/secretAccessKey/i);
    // HTTP-01 must not be used for the wildcard issuer.
    expect(yaml).not.toContain('http01');
  });

  it('fails closed when enabled without the Route 53 hosted zone ID', () => {
    const out = helmTemplate([
      '--set',
      'certManager.clusterIssuer.enabled=true',
      '--set',
      'certManager.clusterIssuer.dns01.role.roleArn=arn:aws:iam::111122223333:role/x',
    ]);
    expect(out.status).not.toBe(0);
    expect(out.stderr ?? '').toContain('hostedZoneID is required');
  });

  it('fails closed when enabled without the IRSA role ARN', () => {
    const out = helmTemplate([
      '--set',
      'certManager.clusterIssuer.enabled=true',
      '--set',
      'certManager.clusterIssuer.dns01.hostedZoneID=Z123EXAMPLE',
    ]);
    expect(out.status).not.toBe(0);
    expect(out.stderr ?? '').toContain('roleArn is required');
  });

  it('keeps the ClusterIssuer disabled under production values', () => {
    const out = helmTemplate(['-f', resolve(chartDir, 'values-production.yaml')]);
    const combined = `${out.stdout ?? ''}${out.stderr ?? ''}`;
    expect(out.status, combined).toBe(0);
    expect(out.stdout ?? '').not.toContain('kind: ClusterIssuer');
  });
});
