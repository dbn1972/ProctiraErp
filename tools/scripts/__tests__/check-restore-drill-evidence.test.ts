/**
 * W1-OPS-20 — restore-drill tip evidence gate (required fields + no prod claim).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-restore-drill-evidence.sh');
const repoRoot = resolve(here, '../..');

function basePack(overrides: Record<string, unknown> = {}) {
  return {
    gap: 'W1-OPS-20-fixture',
    title: 'fixture',
    recordedAt: '2026-09-14T00:00:00Z',
    timestamp: '20260914T000000Z',
    mode: 'local-full-db',
    ok: true,
    claimsProductionRestore: false,
    encryption: {
      method: 'age',
      ciRoundTripProven: true,
      productionAtRestEnabled: false,
    },
    offsiteTarget: {
      uri: null,
      configured: false,
      exercised: false,
    },
    localDrill: {
      mode: 'full-db',
      timestamp: '20260914T000000Z',
      counts: { tenants: 1, boards: 1, institutions: 1 },
    },
    ciCrossRef: {
      latestSuccessfulRun: {
        url: 'https://github.com/dbn1972/ProctiraErp/actions/runs/1',
      },
    },
    scriptsExercised: ['tools/scripts/restore-drill.sh'],
    ...overrides,
  };
}

function runAgainstFixture(pack: Record<string, unknown>) {
  const fixture = mkdtempSync(join(tmpdir(), 'w1-ops-20-'));
  try {
    mkdirSync(join(fixture, 'docs/audits/evidence'), { recursive: true });
    mkdirSync(join(fixture, 'tools/scripts'), { recursive: true });
    writeFileSync(
      join(fixture, 'docs/audits/evidence/restore-drill-20260914.json'),
      JSON.stringify(pack, null, 2),
      'utf8',
    );
    writeFileSync(
      join(fixture, 'tools/scripts/restore-drill.sh'),
      '#!/bin/bash\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(fixture, 'docs/BACKUP_RESTORE.md'),
      'See docs/audits/evidence/restore-drill-YYYYMMDD.json\n',
      'utf8',
    );
    writeFileSync(
      join(fixture, 'docs/audits/OPS_W1_OPS_20_RESTORE.md'),
      '# W1-OPS-20\n\nTip pack is not production restore proof.\n',
      'utf8',
    );
    const localScript = join(fixture, 'tools/scripts/check-restore-drill-evidence.sh');
    writeFileSync(localScript, readFileSync(scriptPath, 'utf8'), { mode: 0o755 });

    const result = spawnSync('bash', [localScript], {
      cwd: fixture,
      encoding: 'utf8',
    });
    return {
      status: result.status ?? 1,
      out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('check-restore-drill-evidence (W1-OPS-20)', () => {
  it('passes against the repository tip pack', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, combined).toBe(0);
    expect(combined).toContain('PASS');
    expect(combined).toContain('claimsProductionRestore= false');
  });

  it('fails when encryption is missing', () => {
    const pack = basePack();
    delete (pack as { encryption?: unknown }).encryption;
    const { status, out } = runAgainstFixture(pack);
    expect(status).not.toBe(0);
    expect(out).toMatch(/encryption/);
  });

  it('fails when offsiteTarget is missing', () => {
    const pack = basePack();
    delete (pack as { offsiteTarget?: unknown }).offsiteTarget;
    const { status, out } = runAgainstFixture(pack);
    expect(status).not.toBe(0);
    expect(out).toMatch(/offsiteTarget/);
  });

  it('fails when timestamp is missing', () => {
    const pack = basePack({ timestamp: '', recordedAt: '', localDrill: { mode: 'full-db', counts: { tenants: 1, boards: 1, institutions: 1 } } });
    const { status, out } = runAgainstFixture(pack);
    expect(status).not.toBe(0);
    expect(out).toMatch(/timestamp/);
  });

  it('fails when claimsProductionRestore is true', () => {
    const { status, out } = runAgainstFixture(
      basePack({ claimsProductionRestore: true }),
    );
    expect(status).not.toBe(0);
    expect(out).toMatch(/claimsProductionRestore|production/);
  });

  it('fails when claimsProductionRestore is omitted', () => {
    const pack = basePack();
    delete (pack as { claimsProductionRestore?: unknown }).claimsProductionRestore;
    const { status, out } = runAgainstFixture(pack);
    expect(status).not.toBe(0);
    expect(out).toMatch(/claimsProductionRestore/);
  });
});
