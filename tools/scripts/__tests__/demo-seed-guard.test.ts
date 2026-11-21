/**
 * PRC-L461 / DR4-3 — the backend-ready harness must resolve a strict decision
 * for the Sunrise demo seed before invoking psql:
 *
 *   1. E2E_SKIP_SUNRISE_SEED=1       -> skip the seed entirely (no psql -f 006).
 *   2. else ALLOW_SUNRISE_DEMO_SEED=1 -> run the seed with the GUC
 *      proctira.allow_demo_seed=on bound via PGOPTIONS.
 *   3. else                          -> fail closed, naming BOTH env vars.
 *
 * These tests drive tools/scripts/run-e2e-backend-ready.sh with stubbed
 * psql/curl/pnpm/setsid on PATH so the seed precedence is exercised without a
 * live Postgres or a real gateway. The stub psql appends every invocation to a
 * log file so the assertions can inspect which file was applied and whether
 * PGOPTIONS carried the allow_demo_seed GUC.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'run-e2e-backend-ready.sh');
const repoRoot = resolve(here, '../..');

/**
 * Build a fake PATH directory with stubs for the external commands the seed
 * path reaches. psql records each call (name + PGOPTIONS + joined args) so the
 * test can assert what ran. curl always fails (nothing listening) and pnpm /
 * setsid are no-ops so the harness takes the "gateway never healthy" branch and
 * exits via the E2E_ALLOW_SKIP summary AFTER the seed decision is made.
 */
function makeStubBin(dir: string, psqlLog: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });

  writeFileSync(
    join(bin, 'psql'),
    [
      '#!/usr/bin/env bash',
      // Record: PGOPTIONS value then all args.
      `echo "psql PGOPTIONS=\${PGOPTIONS:-} ARGS=$*" >> ${JSON.stringify(psqlLog)}`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  // curl: always "connection refused" so the stale-gateway guard passes and the
  // later health probe fails, driving the allow-skip exit after the seed.
  writeFileSync(join(bin, 'curl'), ['#!/usr/bin/env bash', 'exit 7', ''].join('\n'), {
    mode: 0o755,
  });

  // pnpm: no-op (the build + start steps must not do real work in the test).
  writeFileSync(join(bin, 'pnpm'), ['#!/usr/bin/env bash', 'exit 0', ''].join('\n'), {
    mode: 0o755,
  });

  // setsid: run the remaining command in the foreground as a no-op background
  // gateway; the script backgrounds it with & so this returns immediately.
  writeFileSync(join(bin, 'setsid'), ['#!/usr/bin/env bash', 'exit 0', ''].join('\n'), {
    mode: 0o755,
  });

  return bin;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
  psqlCalls: string[];
}

function runHarness(env: Record<string, string>): RunResult {
  const fixture = mkdtempSync(join(tmpdir(), 'demo-seed-guard-'));
  const psqlLog = join(fixture, 'psql-calls.log');
  const bin = makeStubBin(fixture, psqlLog);
  try {
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: process.env.HOME ?? fixture,
        // Local scaffolding mode: a missing/unhealthy gateway prints the skip
        // summary and exits 0 AFTER the seed decision, so the test isolates the
        // seed precedence without a real gateway.
        E2E_ALLOW_SKIP: '1',
        DATABASE_URL: 'postgresql://stub/stub',
        // Avoid re-seeding the E2E tenant fixtures through the stub psql so the
        // only recorded 006 call comes from the Sunrise branch under test.
        E2E_SKIP_TENANT_SEED: '1',
        ...env,
      },
    });
    const psqlCalls = existsSync(psqlLog)
      ? readFileSync(psqlLog, 'utf8').split('\n').filter(Boolean)
      : [];
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      combined: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      psqlCalls,
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const sunriseCalls = (calls: string[]): string[] =>
  calls.filter((line) => line.includes('006_sunrise_public_school_demo.sql'));

describe('run-e2e-backend-ready Sunrise demo seed guard (PRC-L461 / DR4-3)', () => {
  it('skips the seed when E2E_SKIP_SUNRISE_SEED=1 (no 006 psql call)', () => {
    const r = runHarness({ E2E_SKIP_SUNRISE_SEED: '1' });
    expect(sunriseCalls(r.psqlCalls), r.combined).toHaveLength(0);
    expect(r.combined).toContain('skipping Sunrise demo seed');
  });

  it('seeds with proctira.allow_demo_seed=on when ALLOW_SUNRISE_DEMO_SEED=1', () => {
    const r = runHarness({ ALLOW_SUNRISE_DEMO_SEED: '1' });
    const seed = sunriseCalls(r.psqlCalls);
    expect(seed, r.combined).toHaveLength(1);
    expect(seed[0]).toContain('PGOPTIONS=-c proctira.allow_demo_seed=on');
  });

  it('fails closed naming both env vars when neither is set', () => {
    const r = runHarness({});
    expect(r.status, r.combined).not.toBe(0);
    expect(sunriseCalls(r.psqlCalls), r.combined).toHaveLength(0);
    expect(r.combined).toContain('E2E_SKIP_SUNRISE_SEED=1');
    expect(r.combined).toContain('ALLOW_SUNRISE_DEMO_SEED=1');
  });

  it('skip takes precedence over opt-in when both are set', () => {
    const r = runHarness({
      E2E_SKIP_SUNRISE_SEED: '1',
      ALLOW_SUNRISE_DEMO_SEED: '1',
    });
    expect(sunriseCalls(r.psqlCalls), r.combined).toHaveLength(0);
    expect(r.combined).toContain('skipping Sunrise demo seed');
  });
});
