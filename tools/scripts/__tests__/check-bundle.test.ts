/**
 * Tests for the bundle-size CI gate (task 55.2 / Requirement 39 AC 1).
 *
 * Covers the small library surface exposed by `check-bundle.mjs`:
 *   - `gzipSize` deflates predictably and matches `zlib.gzipSync`
 *   - `parseManifests` reads both Next.js manifests and tolerates absences
 *   - `resolveRouteChunks` unions the chunks across layout + page entries
 *     and reports manifest keys that are missing
 *   - `evaluateRoutes` measures per-route gzip size and flags over-budget
 *     routes correctly
 *   - `DEFAULT_ROUTES` covers the three named routes from Requirement 39 AC 1
 *
 * Tests run against a synthetic `.next/` fixture rooted in `tmpdir()` so the
 * suite never depends on a real Next.js build (CI may run before `apps/web`
 * has been built).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// @ts-expect-error - direct .mjs import; types are not generated.
import * as gate from '../check-bundle.mjs';

// ---------------------------------------------------------------------------
// Fixture: a synthetic `.next/` tree with a Next.js-shaped app-build-manifest
// and a handful of static chunks of known size. The synthetic shape mirrors
// the production manifest layout so the tests exercise the real parser
// without any mocking.
// ---------------------------------------------------------------------------

let fixtureRoot: string;
const TEN_KB = 'a'.repeat(10 * 1024);
const TWO_KB = 'b'.repeat(2 * 1024);
const ONE_KB = 'c'.repeat(1024);

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'check-bundle-test-'));
  // Mimic .next/ layout
  const staticChunks = join(fixtureRoot, 'static', 'chunks');
  mkdirSync(staticChunks, { recursive: true });
  writeFileSync(join(staticChunks, 'webpack.js'), ONE_KB);
  writeFileSync(join(staticChunks, 'main-app.js'), TEN_KB);
  writeFileSync(join(staticChunks, 'auth-layout.js'), TWO_KB);
  writeFileSync(join(staticChunks, 'login-page.js'), TWO_KB);
  writeFileSync(join(staticChunks, 'dashboard-layout.js'), TWO_KB);
  writeFileSync(join(staticChunks, 'dashboard-page.js'), TEN_KB);
  writeFileSync(join(staticChunks, 'attendance-page.js'), TEN_KB);
  writeFileSync(join(staticChunks, 'shared-vendor.js'), 'd'.repeat(50 * 1024));

  // app-build-manifest.json — note that several keys share the
  // `webpack.js` and `main-app.js` chunks; the resolver MUST dedupe so
  // each chunk is counted exactly once per route.
  const appManifest = {
    pages: {
      '/layout': ['static/chunks/webpack.js', 'static/chunks/main-app.js'],
      '/(auth)/layout': [
        'static/chunks/webpack.js',
        'static/chunks/main-app.js',
        'static/chunks/auth-layout.js',
      ],
      '/(auth)/login/page': [
        'static/chunks/webpack.js',
        'static/chunks/main-app.js',
        'static/chunks/auth-layout.js',
        'static/chunks/login-page.js',
      ],
      '/(dashboard)/layout': [
        'static/chunks/webpack.js',
        'static/chunks/main-app.js',
        'static/chunks/dashboard-layout.js',
      ],
      '/(dashboard)/page': [
        'static/chunks/webpack.js',
        'static/chunks/main-app.js',
        'static/chunks/dashboard-layout.js',
        'static/chunks/dashboard-page.js',
      ],
      '/(dashboard)/attendance/page': [
        'static/chunks/webpack.js',
        'static/chunks/main-app.js',
        'static/chunks/dashboard-layout.js',
        'static/chunks/attendance-page.js',
      ],
    },
  };
  writeFileSync(join(fixtureRoot, 'app-build-manifest.json'), JSON.stringify(appManifest, null, 2));

  // build-manifest.json (Pages Router) — empty pages map, mimics an
  // App-Router-only build.
  writeFileSync(
    join(fixtureRoot, 'build-manifest.json'),
    JSON.stringify({ pages: {}, rootMainFiles: [] }, null, 2),
  );
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// gzipSize
// ---------------------------------------------------------------------------

describe('gzipSize', () => {
  it('returns a smaller number than the raw size for repetitive text', () => {
    const buf = Buffer.from('a'.repeat(10_000), 'utf8');
    const size = gate.gzipSize(buf);
    // gzip on a constant byte stream should compress to well under 1 KB.
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(buf.length);
    expect(size).toBeLessThan(200);
  });

  it('matches zlib.gzipSync at level 9', () => {
    const buf = Buffer.from('hello world '.repeat(500), 'utf8');
    const expected = gzipSync(buf, { level: 9 }).length;
    expect(gate.gzipSize(buf)).toBe(expected);
  });

  it('returns the exact gzip length for an empty buffer', () => {
    const empty = Buffer.alloc(0);
    expect(gate.gzipSize(empty)).toBe(gzipSync(empty, { level: 9 }).length);
  });

  it('throws when given a non-Buffer input', () => {
    // @ts-expect-error - intentional misuse to exercise the type guard.
    expect(() => gate.gzipSize('hello')).toThrow(/expected Buffer/);
  });
});

// ---------------------------------------------------------------------------
// parseManifests
// ---------------------------------------------------------------------------

describe('parseManifests', () => {
  it('reads both Next.js manifests when present', async () => {
    const result = await gate.parseManifests(fixtureRoot);
    expect(result.appManifest).toBeTruthy();
    expect(result.appManifest.pages['/layout']).toContain('static/chunks/webpack.js');
    expect(result.pagesManifest).toBeTruthy();
    expect(result.appManifestPath.endsWith('app-build-manifest.json')).toBe(true);
    expect(result.pagesManifestPath.endsWith('build-manifest.json')).toBe(true);
  });

  it('returns null for a missing manifest rather than throwing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'check-bundle-empty-'));
    try {
      const result = await gate.parseManifests(empty);
      expect(result.appManifest).toBeNull();
      expect(result.pagesManifest).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRouteChunks
// ---------------------------------------------------------------------------

describe('resolveRouteChunks', () => {
  it('unions chunks across multiple manifest keys and dedupes shared chunks', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const { chunks, missingKeys } = gate.resolveRouteChunks(appManifest, [
      '/layout',
      '/(auth)/layout',
      '/(auth)/login/page',
    ]);
    // webpack.js + main-app.js + auth-layout.js + login-page.js = 4 unique chunks.
    expect(chunks).toHaveLength(4);
    expect(chunks).toContain('static/chunks/webpack.js');
    expect(chunks).toContain('static/chunks/main-app.js');
    expect(chunks).toContain('static/chunks/auth-layout.js');
    expect(chunks).toContain('static/chunks/login-page.js');
    expect(missingKeys).toEqual([]);
  });

  it('preserves first-appearance order for deterministic reporting', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const { chunks } = gate.resolveRouteChunks(appManifest, [
      '/layout',
      '/(dashboard)/layout',
      '/(dashboard)/attendance/page',
    ]);
    // webpack.js comes from /layout first, so it appears at index 0.
    expect(chunks[0]).toBe('static/chunks/webpack.js');
    expect(chunks[1]).toBe('static/chunks/main-app.js');
    // dashboard-layout.js first appears in /(dashboard)/layout, before the page.
    expect(chunks.indexOf('static/chunks/dashboard-layout.js')).toBeLessThan(
      chunks.indexOf('static/chunks/attendance-page.js'),
    );
  });

  it('reports missing manifest keys without throwing', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const { chunks, missingKeys } = gate.resolveRouteChunks(appManifest, [
      '/layout',
      '/does/not/exist/page',
    ]);
    expect(chunks).toEqual(['static/chunks/webpack.js', 'static/chunks/main-app.js']);
    expect(missingKeys).toEqual(['/does/not/exist/page']);
  });

  it('returns every key as missing when the manifest is null', () => {
    const { chunks, missingKeys } = gate.resolveRouteChunks(null, ['/a', '/b']);
    expect(chunks).toEqual([]);
    expect(missingKeys).toEqual(['/a', '/b']);
  });
});

// ---------------------------------------------------------------------------
// measureChunk
// ---------------------------------------------------------------------------

describe('measureChunk', () => {
  it('returns gzip size for an existing chunk', async () => {
    const measurement = await gate.measureChunk(fixtureRoot, 'static/chunks/webpack.js');
    expect(measurement.exists).toBe(true);
    expect(measurement.rawBytes).toBe(1024);
    expect(measurement.gzipBytes).toBeGreaterThan(0);
    expect(measurement.gzipBytes).toBeLessThan(1024);
    expect(measurement.error).toBeNull();
  });

  it('reports exists=false (and 0 bytes) for a missing chunk without throwing', async () => {
    const measurement = await gate.measureChunk(fixtureRoot, 'static/chunks/does-not-exist.js');
    expect(measurement.exists).toBe(false);
    expect(measurement.rawBytes).toBe(0);
    expect(measurement.gzipBytes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateRoutes
// ---------------------------------------------------------------------------

describe('evaluateRoutes', () => {
  it('marks a small synthetic route as passing under the 500 KB budget', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const reports = await gate.evaluateRoutes({
      buildDir: fixtureRoot,
      appManifest,
      routes: [
        {
          canonical: '/auth/signin',
          description: 'sign-in (synthetic)',
          appManifestKeys: ['/layout', '/(auth)/layout', '/(auth)/login/page'],
        },
      ],
      threshold: gate.BUDGET_BYTES,
    });
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.present).toBe(true);
    expect(r.passes).toBe(true);
    expect(r.totalGzipBytes).toBeGreaterThan(0);
    expect(r.totalGzipBytes).toBeLessThanOrEqual(gate.BUDGET_BYTES);
    // The synthetic route includes 4 chunks; raw bytes = 1024 + 10240 + 2048 + 2048 = 15360.
    expect(r.totalRawBytes).toBe(1024 + 10 * 1024 + 2 * 1024 + 2 * 1024);
    expect(r.presentChunkCount).toBe(4);
  });

  it('flags an over-budget route with passes=false', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    // Use a tiny threshold (1 byte) to force every present route to fail.
    const reports = await gate.evaluateRoutes({
      buildDir: fixtureRoot,
      appManifest,
      routes: [
        {
          canonical: '/auth/signin',
          description: 'sign-in (synthetic)',
          appManifestKeys: ['/layout', '/(auth)/layout', '/(auth)/login/page'],
        },
      ],
      threshold: 1,
    });
    expect(reports[0].passes).toBe(false);
    expect(reports[0].totalGzipBytes).toBeGreaterThan(1);
  });

  it('marks an absent route as not-present and does NOT count it as a failure', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const reports = await gate.evaluateRoutes({
      buildDir: fixtureRoot,
      appManifest,
      routes: [
        {
          canonical: '/never/landed',
          description: 'nonexistent route (synthetic)',
          appManifestKeys: ['/never/landed/page'],
        },
      ],
      threshold: gate.BUDGET_BYTES,
    });
    const r = reports[0];
    expect(r.present).toBe(false);
    // An absent route MUST pass — Requirement 39 AC 1 only binds present routes.
    expect(r.passes).toBe(true);
    expect(r.missingKeys).toEqual(['/never/landed/page']);
  });

  it('dedupes shared chunks across layout + page so the budget is not double-counted', async () => {
    const { appManifest } = await gate.parseManifests(fixtureRoot);
    const reports = await gate.evaluateRoutes({
      buildDir: fixtureRoot,
      appManifest,
      routes: [
        {
          canonical: '/auth/signin',
          description: 'sign-in (synthetic)',
          appManifestKeys: ['/layout', '/(auth)/layout', '/(auth)/login/page'],
        },
      ],
      threshold: gate.BUDGET_BYTES,
    });
    // Without dedup, webpack.js and main-app.js would be counted 3 times.
    // Confirm we have 4 present chunks (one of each), not 9.
    expect(reports[0].presentChunkCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ROUTES
// ---------------------------------------------------------------------------

describe('DEFAULT_ROUTES', () => {
  it('covers every route called out in Requirement 39 AC 1', () => {
    const canonical = gate.DEFAULT_ROUTES.map((r: { canonical: string }) => r.canonical);
    expect(canonical).toContain('/auth/signin');
    expect(canonical).toContain('/app/dashboard');
    expect(canonical).toContain('/app/attendance');
  });

  it('declares manifest keys for every route', () => {
    for (const route of gate.DEFAULT_ROUTES) {
      expect(Array.isArray(route.appManifestKeys)).toBe(true);
      expect(route.appManifestKeys.length).toBeGreaterThan(0);
      // Every key MUST start with '/' to match Next.js manifest format.
      for (const key of route.appManifestKeys) {
        expect(key.startsWith('/')).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// BUDGET_BYTES
// ---------------------------------------------------------------------------

describe('BUDGET_BYTES', () => {
  it('is exactly 500 KB (Requirement 39 AC 1)', () => {
    expect(gate.BUDGET_BYTES).toBe(500 * 1024);
  });
});

// ---------------------------------------------------------------------------
// fmtDelta + renderSummaryTable (task 60.6 — tabular per-route report)
// ---------------------------------------------------------------------------

describe('fmtDelta', () => {
  it('renders a negative delta (under budget) with a leading "-"', () => {
    expect(gate.fmtDelta(100 * 1024, 500 * 1024)).toBe('-400.00 KB');
  });

  it('renders a positive delta (over budget) with a leading "+"', () => {
    expect(gate.fmtDelta(550 * 1024, 500 * 1024)).toBe('+50.00 KB');
  });

  it('renders an exact match with "±"', () => {
    expect(gate.fmtDelta(500 * 1024, 500 * 1024)).toBe('±0 B');
  });
});

describe('renderSummaryTable', () => {
  it('shows each route, its size, the budget, the delta, and the pass/fail status', () => {
    const reports = [
      {
        canonical: '/auth/signin',
        present: true,
        passes: true,
        totalGzipBytes: 220 * 1024,
        presentChunkCount: 12,
      },
      {
        canonical: '/app/dashboard',
        present: true,
        passes: false,
        totalGzipBytes: 600 * 1024,
        presentChunkCount: 18,
      },
      {
        canonical: '/app/attendance',
        present: false,
        passes: true,
        totalGzipBytes: 0,
        presentChunkCount: 0,
      },
    ];
    const table = gate.renderSummaryTable(reports, 500 * 1024);
    // Header row.
    expect(table).toMatch(/Route\s+Size\s+Budget\s+Delta\s+Status/);
    // Passing route shows a negative delta and the pass icon.
    expect(table).toContain('/auth/signin');
    expect(table).toContain('-280.00 KB');
    expect(table).toContain('✅');
    // Over-budget route shows a positive delta and the fail icon.
    expect(table).toContain('/app/dashboard');
    expect(table).toContain('+100.00 KB');
    expect(table).toContain('❌');
    // Absent route is tagged with ⚠️ and shows "absent" in the size column.
    expect(table).toContain('/app/attendance');
    expect(table).toContain('absent');
  });
});

// ---------------------------------------------------------------------------
// ensureBuildDir
// ---------------------------------------------------------------------------

describe('ensureBuildDir', () => {
  it('returns state="present" when the directory already exists', async () => {
    const result = await gate.ensureBuildDir({
      buildDir: fixtureRoot,
      noBuild: false,
      ci: false,
    });
    expect(result.state).toBe('present');
  });

  it('throws when the dir is missing and --no-build is set', async () => {
    const missing = join(fixtureRoot, 'definitely-not-here');
    await expect(
      gate.ensureBuildDir({
        buildDir: missing,
        noBuild: true,
        ci: false,
      }),
    ).rejects.toThrow(/--no-build was set/);
  });

  it('throws when the dir is missing and CI=true', async () => {
    const missing = join(fixtureRoot, 'also-not-here');
    await expect(
      gate.ensureBuildDir({
        buildDir: missing,
        noBuild: false,
        ci: true,
      }),
    ).rejects.toThrow(/CI=true was set/);
  });

  it('tags the missing-build-dir error with name="BuildDirMissingError"', async () => {
    const missing = join(fixtureRoot, 'tagged-error-dir');
    await expect(
      gate.ensureBuildDir({ buildDir: missing, noBuild: true, ci: false }),
    ).rejects.toMatchObject({ name: 'BuildDirMissingError' });
  });

  it('returns state="skipped" when the dir is missing in a non-CI local run', async () => {
    const missing = join(fixtureRoot, 'still-not-here');
    const result = await gate.ensureBuildDir({
      buildDir: missing,
      noBuild: false,
      ci: false,
    });
    expect(result.state).toBe('skipped');
    expect(result.buildDir).toBe(missing);
  });
});

// ---------------------------------------------------------------------------
// CLI exit-code policy (task 60.6 — "Fail the build on any over-budget chunk")
// ---------------------------------------------------------------------------
// These tests spawn the actual `check-bundle.mjs` CLI against the synthetic
// fixture so we exercise the same `process.exit(...)` paths that CI does.
// We pass `--build-dir` and `--threshold` through argv so each scenario is
// hermetic; no env vars need to be set.
// ---------------------------------------------------------------------------

const cliPath = resolve(fileURLToPath(new URL('../check-bundle.mjs', import.meta.url)));

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'false' },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI exit codes', () => {
  it('exits 0 when every present route fits the 500 KB budget (synthetic build)', () => {
    const { status, stdout } = runCli([
      `--build-dir=${fixtureRoot}`,
      `--threshold=${gate.BUDGET_BYTES}`,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain('0 over-budget routes');
    // Tabular report is printed (task 60.6 verification bullet).
    expect(stdout).toMatch(/Route\s+Size\s+Budget\s+Delta\s+Status/);
  });

  it('exits 1 when ANY route is over the configured threshold', () => {
    // Threshold of 1 byte forces every present route to fail — this is the
    // simulated over-budget condition required by the task verification:
    // "A simulated over-budget condition causes the script to exit non-zero."
    const { status, stderr } = runCli([`--build-dir=${fixtureRoot}`, '--threshold=1']);
    expect(status).toBe(1);
    expect(stderr).toContain('over the');
  });

  it('emits a tabular summary including each route + size + budget delta', () => {
    const { status, stdout } = runCli([`--build-dir=${fixtureRoot}`]);
    expect(status).toBe(0);
    // Each of the three named routes from Requirement 39 AC 1 appears.
    expect(stdout).toContain('/auth/signin');
    expect(stdout).toContain('/app/dashboard');
    expect(stdout).toContain('/app/attendance');
    // Delta column uses signed bytes (`-` for headroom, `+` for breach).
    expect(stdout).toMatch(/[-+]\d+(?:\.\d+)? [KM]?B/);
  });
});
