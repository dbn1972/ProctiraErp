/**
 * W1-OPS-14 — regression coverage for provenance / fail-closed cosign guard.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-image-provenance-required.sh');
const repoRoot = resolve(here, '../../..');

const goodRelease = `steps:
  - uses: docker/build-push-action@v5
    with:
      provenance: mode=max
      sbom: true
  - run: cosign sign
`;

const goodSupply = `steps:
  - uses: docker/build-push-action@v5
    with:
      provenance: mode=max
      sbom: true
`;

function runFixture(releaseYml: string, supplyYml: string) {
  const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-14-'));
  try {
    mkdirSync(join(fixture, '.github/workflows'), { recursive: true });
    writeFileSync(join(fixture, '.github/workflows/release.yml'), releaseYml);
    writeFileSync(join(fixture, '.github/workflows/supply-chain.yml'), supplyYml);

    const localScript = join(fixture, 'tools/scripts/check-image-provenance-required.sh');
    mkdirSync(dirname(localScript), { recursive: true });
    writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });

    const result = spawnSync('bash', [localScript], {
      cwd: fixture,
      encoding: 'utf8',
    });
    return {
      status: result.status,
      out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('check-image-provenance-required (W1-OPS-14)', () => {
  it('passes against the repository release/supply-chain workflows', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, combined).toBe(0);
    expect(result.stdout ?? '').toContain('W1-OPS-14');
  });

  it('passes a fixture with mode=max and no soft-skip variable', () => {
    const { status, out } = runFixture(goodRelease, goodSupply);
    expect(status, out).toBe(0);
    expect(out).toMatch(/provenance mode=max/);
  });

  it('fails when provenance: false is present', () => {
    const bad = goodRelease.replace('provenance: mode=max', 'provenance: false');
    const { status, out } = runFixture(bad, goodSupply);
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/provenance must not be disabled/);
  });

  it('fails when SUPPLY_CHAIN_SIGN_IMAGES soft-skip returns', () => {
    const soft = `${goodRelease}\nif: vars.SUPPLY_CHAIN_SIGN_IMAGES == 'true'\n`;
    const { status, out } = runFixture(soft, goodSupply);
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/SUPPLY_CHAIN_SIGN_IMAGES/);
  });
});
