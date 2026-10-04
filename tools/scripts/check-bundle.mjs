#!/usr/bin/env node
/**
 * Initial-bundle gzip-size CI gate (task 55.2 / Requirement 39 AC 1 / Design §J).
 *
 * Walks the Next.js build output for `apps/web` and, for every "named route"
 * called out in Requirement 39 AC 1 (`/auth/signin`, `/app/dashboard`,
 * `/app/attendance`), enumerates the JavaScript and CSS chunks that ship as
 * part of that route's initial paint, gzips each chunk's on-disk bytes
 * (level 9), and sums the result. The build is failed when any single
 * route's combined initial-chunk gzip size exceeds 500 KB.
 *
 * The script is the enforcement surface for the Performance Budget Strategy
 * documented in design.md §J. It runs locally (`pnpm check:bundle`) and in
 * CI after the Next.js build step in `.github/workflows/ci.yml`.
 *
 * The library surface (`gzipSize`, `parseManifests`, `resolveRouteChunks`,
 * `evaluateRoutes`, `DEFAULT_ROUTES`, `BUDGET_BYTES`) is reused by the
 * accompanying Vitest spec in `tools/scripts/__tests__/check-bundle.test.ts`.
 *
 * Usage
 *   node tools/scripts/check-bundle.mjs
 *   node tools/scripts/check-bundle.mjs --threshold=512000
 *   node tools/scripts/check-bundle.mjs --build-dir=apps/web/.next
 *   node tools/scripts/check-bundle.mjs --no-build      # fail (instead of skip) when .next/ is missing
 *   node tools/scripts/check-bundle.mjs --baseline      # record current sizes (always pass)
 *   node tools/scripts/check-bundle.mjs --json
 *
 * Exits 0 when every present route is at or below the threshold (and any
 * absent route emits a warning, not a failure — Requirement 39 AC 1 only
 * binds the routes that actually exist in the current build). Exits 1 when
 * any route is over budget.
 *
 * Missing-build behaviour (task 55.2 spec item 5):
 *   • CI (env CI=true) or `--no-build`  → fail (the build step must run first).
 *   • Local (CI unset)                  → warn and exit 0 (graceful skip).
 *
 * The graceful local skip exists so contributors who run `pnpm check:bundle`
 * without first building `apps/web` get a friendly nudge instead of a noisy
 * stack trace. CI never skips: the workflow always builds before invoking
 * the gate, and `CI=true` flips the behaviour back to "fail loudly".
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// ============================================================================
// Constants
// ============================================================================

/** Requirement 39 AC 1: 500 KB gzip per named route, summed across initial chunks. */
export const BUDGET_BYTES = 500 * 1024;

/**
 * Map from the canonical route names called out in Requirement 39 AC 1 to
 * the Next.js App Router manifest keys whose chunks make up that route's
 * initial paint.
 *
 * Each canonical route lists the full chain of layouts above the page. Next.js
 * does NOT inline layout chunks into a page's manifest entry, so we have to
 * walk the segment tree explicitly. A missing manifest key is warned (not
 * failed) so the gate stays useful while route ports are still in flight.
 *
 * The canonical names (`/auth/signin` etc.) are deliberately decoupled from
 * the underlying directory structure: the prototype at `School Platform
 * Design/` uses `/auth/signin` but the App Router port uses `/(auth)/login`.
 * Both are valid implementations of Requirement 39 AC 1; the route map below
 * is the single source of truth that translates the requirement-level name
 * into an implementation-level manifest path.
 */
export const DEFAULT_ROUTES = [
  {
    canonical: '/auth/signin',
    description: 'Sign-in page (Requirement 39 AC 1)',
    // App Router groups: /layout + /(auth)/layout + /(auth)/login/page
    appManifestKeys: ['/layout', '/(auth)/layout', '/(auth)/login/page'],
  },
  {
    canonical: '/app/dashboard',
    description: 'Default dashboard (Requirement 39 AC 1)',
    appManifestKeys: ['/layout', '/(dashboard)/layout', '/(dashboard)/page'],
  },
  {
    canonical: '/app/attendance',
    description: 'Attendance marking (Requirement 39 AC 1)',
    appManifestKeys: ['/layout', '/(dashboard)/layout', '/(dashboard)/attendance/page'],
  },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_BUILD_DIR = resolve(REPO_ROOT, 'apps/web/.next');
const DEFAULT_BASELINE_PATH = resolve(__dirname, 'check-bundle-baseline.json');

// ============================================================================
// Compression
// ============================================================================

/**
 * Returns the byte length of `buffer` after gzip level-9 compression.
 *
 * Level 9 matches the encoding emitted by `apps/web/scripts/precompress.mjs`,
 * which is what the API_Gateway / CDN actually serves (Requirement 39's
 * "compression" lever in design §J). Measuring at level 9 therefore reflects
 * what the user's browser downloads on first paint, not a hypothetical
 * level-6 default.
 */
export function gzipSize(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(`gzipSize: expected Buffer, got ${typeof buffer}`);
  }
  return gzipSync(buffer, { level: 9 }).length;
}

// ============================================================================
// Manifest parsing
// ============================================================================

/**
 * Read both Next.js build manifests from `buildDir` and return the parsed
 * objects. Either may be missing (the Pages Router manifest is empty in a
 * pure App Router app, and vice versa) — those return `null` rather than
 * throwing so the caller can decide how to react.
 */
export async function parseManifests(buildDir) {
  const appManifestPath = join(buildDir, 'app-build-manifest.json');
  const pagesManifestPath = join(buildDir, 'build-manifest.json');
  const [app, pages] = await Promise.all([
    readJsonOrNull(appManifestPath),
    readJsonOrNull(pagesManifestPath),
  ]);
  return {
    appManifest: app,
    pagesManifest: pages,
    appManifestPath,
    pagesManifestPath,
  };
}

async function readJsonOrNull(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Resolve a route's initial chunk list by unioning every manifest entry
 * named in `appManifestKeys`. Layout chunks shared by multiple keys are
 * counted exactly once, mirroring the fact that the browser only downloads
 * each chunk once even when several manifest entries reference it.
 *
 * Returns `{ chunks, missingKeys }`. `missingKeys` lets the caller emit a
 * warning when a route key is not present in the manifest (e.g. because the
 * port has not landed yet). `chunks` is a deduplicated array of
 * manifest-relative paths (e.g. `static/chunks/webpack-abc.js`).
 */
export function resolveRouteChunks(appManifest, appManifestKeys) {
  const seen = new Set();
  const chunks = [];
  const missingKeys = [];
  if (!appManifest || !appManifest.pages) {
    return { chunks, missingKeys: [...appManifestKeys] };
  }
  for (const key of appManifestKeys) {
    const list = appManifest.pages[key];
    if (!Array.isArray(list)) {
      missingKeys.push(key);
      continue;
    }
    for (const chunk of list) {
      if (!seen.has(chunk)) {
        seen.add(chunk);
        chunks.push(chunk);
      }
    }
  }
  return { chunks, missingKeys };
}

// ============================================================================
// Per-chunk size lookup
// ============================================================================

/**
 * Look up the on-disk gzip size of a single manifest chunk path. Manifest
 * paths are relative to `.next/`, so we resolve them under `buildDir`.
 *
 * Returns `{ path, exists, rawBytes, gzipBytes, error }`. `exists=false` is
 * surfaced to the report (rather than throwing) so a stale or partial build
 * is reported as "missing chunk X" instead of a generic ENOENT stack trace.
 */
export async function measureChunk(buildDir, manifestRelPath) {
  const absPath = join(buildDir, manifestRelPath);
  let exists = false;
  let rawBytes = 0;
  let gzipBytes = 0;
  let error = null;
  try {
    const s = await stat(absPath);
    exists = s.isFile();
    if (exists) {
      const buffer = await readFile(absPath);
      rawBytes = buffer.length;
      gzipBytes = gzipSize(buffer);
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      exists = false;
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { path: manifestRelPath, exists, rawBytes, gzipBytes, error };
}

// ============================================================================
// Per-route evaluation
// ============================================================================

/**
 * For each route in `routes`, resolve its initial chunks against the
 * manifest and measure each chunk's gzip size. Returns a structured per-route
 * report with `present` (whether any chunks resolved), `chunks` (array of
 * `{ path, gzipBytes, ... }`), `totalGzipBytes`, `passes`, and `missingKeys`.
 *
 * The threshold is per-route (Requirement 39 AC 1 binds each named route
 * separately, not their sum).
 */
export async function evaluateRoutes({
  buildDir,
  appManifest,
  routes = DEFAULT_ROUTES,
  threshold = BUDGET_BYTES,
}) {
  const out = [];
  for (const route of routes) {
    const { chunks, missingKeys } = resolveRouteChunks(appManifest, route.appManifestKeys);
    const measurements = await Promise.all(chunks.map((c) => measureChunk(buildDir, c)));
    const presentChunks = measurements.filter((m) => m.exists);
    const totalGzipBytes = presentChunks.reduce((sum, m) => sum + m.gzipBytes, 0);
    const totalRawBytes = presentChunks.reduce((sum, m) => sum + m.rawBytes, 0);
    const present = presentChunks.length > 0;
    const passes = !present || totalGzipBytes <= threshold;
    out.push({
      canonical: route.canonical,
      description: route.description,
      manifestKeys: [...route.appManifestKeys],
      missingKeys,
      chunks: measurements,
      presentChunkCount: presentChunks.length,
      totalRawBytes,
      totalGzipBytes,
      threshold,
      present,
      passes,
    });
  }
  return out;
}

/**
 * PRC-L384: decide whether absent routes fail the gate. Zero resolved routes
 * always fails (the manifest no longer maps our canonical routes, so nothing
 * was measured). In CI any absent canonical route fails.
 */
export function absentRouteFailures(reports, { ci = false } = {}) {
  const absent = reports.filter((r) => !r.present);
  if (reports.length > 0 && absent.length === reports.length) return absent;
  return ci ? absent : [];
}

/** Default allowed growth over the recorded baseline (5%). */
export const BASELINE_TOLERANCE = 0.05;

/**
 * PRC-L384: compare present routes with a recorded baseline. Returns the
 * routes whose gzip total grew beyond `tolerance` (fraction) and routes that
 * the baseline does not know (cannot be compared, so they fail closed).
 */
export function compareToBaseline(reports, baseline, tolerance = BASELINE_TOLERANCE) {
  const byRoute = new Map((baseline?.routes ?? []).map((r) => [r.canonical, r]));
  const regressions = [];
  for (const r of reports) {
    if (!r.present) continue;
    const base = byRoute.get(r.canonical);
    if (!base || !base.present || !Number.isFinite(base.totalGzipBytes)) {
      regressions.push({ canonical: r.canonical, reason: 'missing from baseline' });
      continue;
    }
    const limit = Math.floor(base.totalGzipBytes * (1 + tolerance));
    if (r.totalGzipBytes > limit) {
      regressions.push({
        canonical: r.canonical,
        reason: `grew ${(((r.totalGzipBytes - base.totalGzipBytes) / base.totalGzipBytes) * 100).toFixed(1)}% over baseline (${base.totalGzipBytes} → ${r.totalGzipBytes} B)`,
      });
    }
  }
  return regressions;
}

// ============================================================================
// Build directory bootstrap
// ============================================================================

/**
 * Result codes returned by `ensureBuildDir`. The caller uses these to decide
 * the script's exit code without having to re-test `existsSync(buildDir)`:
 *
 *   • `present`         — `.next/` exists; proceed with the gate.
 *   • `skipped`         — `.next/` is missing in a non-CI run; warn and exit 0.
 *   • (otherwise throws — `.next/` is missing in CI or under `--no-build`.)
 */

/**
 * Confirm the build directory exists.
 *
 * Behaviour matrix (task 55.2 spec item 5):
 *   • dir present                              → { state: 'present' }
 *   • dir missing AND (ci=true OR noBuild)     → throw (hard failure)
 *   • dir missing AND ci=false AND !noBuild    → { state: 'skipped' } (warn)
 *
 * `ci` defaults to `process.env.CI === 'true'` so the CLI auto-detects GitHub
 * Actions / GitLab CI without an explicit flag. Tests pass `ci` and `noBuild`
 * directly to exercise both branches without touching the environment.
 */
export async function ensureBuildDir({
  buildDir,
  noBuild = false,
  ci = process.env.CI === 'true',
} = {}) {
  if (existsSync(buildDir)) return { state: 'present' };
  if (ci || noBuild) {
    const reason = ci ? 'CI=true was set' : '--no-build was set';
    const err = new Error(
      `build directory not found at ${buildDir} and ${reason}. ` +
        `Run \`pnpm --filter @proctira/web build\` first.`,
    );
    err.name = 'BuildDirMissingError';
    throw err;
  }
  return { state: 'skipped', buildDir };
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = {
    buildDir: DEFAULT_BUILD_DIR,
    threshold: BUDGET_BYTES,
    noBuild: false,
    baseline: false,
    baselinePath: DEFAULT_BASELINE_PATH,
    compareBaseline: false,
    baselineTolerance: BASELINE_TOLERANCE,
    json: false,
    quiet: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--build-dir=')) {
      const v = arg.slice('--build-dir='.length);
      args.buildDir = isAbsolute(v) ? v : resolve(process.cwd(), v);
    } else if (arg.startsWith('--threshold=')) {
      const v = Number(arg.slice('--threshold='.length));
      if (!Number.isFinite(v) || v <= 0) {
        console.error(`Invalid --threshold: ${arg.slice('--threshold='.length)}`);
        process.exit(2);
      }
      args.threshold = v;
    } else if (arg === '--no-build') {
      args.noBuild = true;
    } else if (arg === '--baseline') {
      args.baseline = true;
    } else if (arg.startsWith('--baseline-path=')) {
      const v = arg.slice('--baseline-path='.length);
      args.baselinePath = isAbsolute(v) ? v : resolve(process.cwd(), v);
    } else if (arg === '--compare-baseline') {
      args.compareBaseline = true;
    } else if (arg.startsWith('--baseline-tolerance=')) {
      const v = Number(arg.slice('--baseline-tolerance='.length));
      if (!Number.isFinite(v) || v < 0) {
        console.error(`Invalid --baseline-tolerance: ${arg.slice('--baseline-tolerance='.length)}`);
        process.exit(2);
      }
      args.baselineTolerance = v;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--') {
      // pnpm v7+ used to strip the `--` separator before forwarding; pnpm
      // v10 does not. Accept it as a no-op so callers can keep writing
      // `pnpm run check:bundle -- --no-build` without surprise.
      continue;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: check-bundle [options]',
      '',
      'Validates that every named route (Requirement 39 AC 1) ships ≤ 500 KB',
      'gzip in initial chunks, computed against the on-disk Next.js build.',
      '',
      'Options:',
      '  --build-dir=<path>       Path to .next/ (default: apps/web/.next)',
      '  --threshold=<bytes>      Override the 500 KB gzip budget (in bytes)',
      '  --no-build               Fail (instead of skip) when .next/ is missing',
      '  --baseline               Record current sizes (writes baseline JSON, always passes)',
      '  --baseline-path=<path>   Override the baseline JSON path',
      '  --compare-baseline       Fail when a route grows beyond the baseline tolerance',
      '  --baseline-tolerance=<f> Allowed growth fraction for --compare-baseline (default 0.05)',
      '',
      'Absent routes: zero resolved routes always fails; in CI any absent route fails.',
      '  --json                   Emit a JSON report on stdout instead of pretty text',
      '  --quiet                  Suppress per-chunk output',
      '  -h, --help               Show this help',
    ].join('\n'),
  );
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '   n/a';
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

/**
 * Render a signed budget delta — e.g. `-273.85 KB` for a route that is
 * comfortably under the threshold, `+12.40 KB` for one that is over. The
 * sign is mandatory so the column reads naturally in `console.log` output
 * (negative = headroom, positive = breach).
 */
export function fmtDelta(usedBytes, thresholdBytes) {
  const delta = usedBytes - thresholdBytes;
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
  const magnitude = Math.abs(delta);
  return `${sign}${fmtBytes(magnitude)}`;
}

function fmtRow(chunk) {
  const tag = chunk.exists ? '  ' : '⚠️ ';
  const size = chunk.exists ? fmtBytes(chunk.gzipBytes).padStart(10, ' ') : '   missing';
  const note = !chunk.exists ? ' (file not found)' : chunk.error ? ` — ${chunk.error}` : '';
  return `    ${tag} ${size}  ${chunk.path}${note}`;
}

/**
 * Render the per-route summary table at the top of the report (task 60.6
 * verification bullet: "Print a tabular report showing each route + size +
 * budget delta"). Pulled out of `main()` so the unit tests can exercise
 * the formatting without spawning the CLI.
 *
 * Absent routes show `absent` in the size column and are tagged ⚠️ —
 * Requirement 39 AC 1 only binds routes present in the current build.
 */
export function renderSummaryTable(reports, threshold) {
  const header = ['Route', 'Size', 'Budget', 'Delta', 'Status'];
  const rows = reports.map((r) => {
    if (!r.present) {
      return [r.canonical, 'absent', fmtBytes(threshold), '   n/a', '⚠️ '];
    }
    return [
      r.canonical,
      fmtBytes(r.totalGzipBytes),
      fmtBytes(threshold),
      fmtDelta(r.totalGzipBytes, threshold),
      r.passes ? '✅' : '❌',
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const padCols = (cols) => cols.map((c, i) => c.padEnd(widths[i], ' ')).join('  ');
  return [padCols(header), ...rows.map(padCols)].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildDirState = await ensureBuildDir({
    buildDir: args.buildDir,
    noBuild: args.noBuild,
  });

  // Graceful local skip: in non-CI runs, a missing .next/ produces a warning
  // and exit 0. CI never reaches this branch (ensureBuildDir throws when
  // CI=true or --no-build is set).
  if (buildDirState.state === 'skipped') {
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            buildDir: args.buildDir,
            threshold: args.threshold,
            skipped: true,
            reason: 'build directory not found (non-CI run)',
            routes: [],
          },
          null,
          2,
        )}\n`,
      );
    } else if (!args.quiet) {
      console.warn(`\n⚠️  check-bundle: ${args.buildDir} not found — skipping the bundle gate.`);
      console.warn(
        `   Run \`pnpm --filter @proctira/web build\` first to enforce Requirement 39 AC 1 locally.`,
      );
      console.warn(`   (CI=true would fail here; this is a graceful local skip.)`);
    }
    process.exit(0);
  }

  const { appManifest, appManifestPath, pagesManifestPath } = await parseManifests(args.buildDir);

  if (!appManifest) {
    console.error(`check-bundle: app-build-manifest.json not found at ${appManifestPath}`);
    process.exit(2);
  }

  const reports = await evaluateRoutes({
    buildDir: args.buildDir,
    appManifest,
    routes: DEFAULT_ROUTES,
    threshold: args.threshold,
  });

  // Baseline mode: write a JSON snapshot and ALWAYS exit 0 (used to seed the
  // first baseline or to record a deliberate regression).
  if (args.baseline) {
    const fsp = await import('node:fs/promises');
    const baseline = {
      generatedAt: new Date().toISOString(),
      threshold: args.threshold,
      routes: reports.map((r) => ({
        canonical: r.canonical,
        present: r.present,
        totalGzipBytes: r.totalGzipBytes,
        chunkCount: r.presentChunkCount,
      })),
    };
    await fsp.writeFile(args.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    if (!args.quiet) {
      console.log(`check-bundle: wrote baseline to ${args.baselinePath}`);
      for (const r of reports) {
        console.log(
          `   • ${r.canonical} → ${r.present ? fmtBytes(r.totalGzipBytes) : 'absent (skipped)'}`,
        );
      }
    }
    process.exit(0);
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          buildDir: args.buildDir,
          threshold: args.threshold,
          appManifestPath,
          pagesManifestPath,
          routes: reports,
        },
        null,
        2,
      )}\n`,
    );
  } else if (!args.quiet) {
    console.log(`\nBundle gate (Requirement 39 AC 1 — ≤ ${fmtBytes(args.threshold)} gzip/route)`);
    console.log(`Build:    ${args.buildDir}`);
    console.log(`Manifest: ${appManifestPath}`);

    // Per-route summary table (task 60.6 verification bullet).
    console.log('');
    console.log(renderSummaryTable(reports, args.threshold));

    for (const r of reports) {
      const status = !r.present ? '⚠️ ' : r.passes ? '✅' : '❌';
      const total = r.present ? fmtBytes(r.totalGzipBytes) : 'absent';
      const delta = r.present ? `  Δ ${fmtDelta(r.totalGzipBytes, args.threshold)}` : '';
      console.log(
        `\n${status} ${r.canonical}  →  ${total}${r.present ? ` (${r.presentChunkCount} chunks)` : ''}${delta}`,
      );
      console.log(`   ${r.description}`);
      for (const m of r.chunks) {
        console.log(fmtRow(m));
      }
      if (r.missingKeys.length > 0) {
        console.log(`   ⚠️  manifest keys not found: ${r.missingKeys.join(', ')}`);
      }
    }
  }

  // Exit code policy: a route that is present but over-budget is a FAILURE.
  // Absent routes are a local WARNING only when at least one route resolved;
  // see absentRouteFailures (PRC-L384) for the fail-closed cases.
  const overBudget = reports.filter((r) => r.present && !r.passes);
  const absent = reports.filter((r) => !r.present);
  // PRC-L384: absent routes fail closed (all absent, or any absent in CI).
  const absentFailures = absentRouteFailures(reports, { ci: process.env.CI === 'true' });
  if (absentFailures.length > 0) {
    console.error(
      `\n❌ check-bundle: ${absentFailures.length} canonical route(s) absent from the manifest: ${absentFailures.map((r) => r.canonical).join(', ')}`,
    );
    console.error('   Update DEFAULT_ROUTES manifest keys if the routes moved.');
    process.exit(1);
  }
  if (args.compareBaseline) {
    let baseline;
    try {
      const fsp = await import('node:fs/promises');
      baseline = JSON.parse(await fsp.readFile(args.baselinePath, 'utf8'));
    } catch (err) {
      console.error(`check-bundle: cannot read baseline ${args.baselinePath}: ${err.message}`);
      process.exit(2);
    }
    const regressions = compareToBaseline(reports, baseline, args.baselineTolerance);
    if (regressions.length > 0) {
      console.error(
        `\n❌ check-bundle: ${regressions.length} route(s) regressed vs baseline (tolerance ${(args.baselineTolerance * 100).toFixed(1)}%)`,
      );
      for (const r of regressions) console.error(`   • ${r.canonical}: ${r.reason}`);
      process.exit(1);
    }
  }
  if (overBudget.length === 0) {
    if (!args.quiet && !args.json) {
      const absentNote = absent.length > 0 ? ` (${absent.length} absent route(s) skipped)` : '';
      console.log(`\n✅ check-bundle: 0 over-budget routes${absentNote}`);
    }
    process.exit(0);
  }

  if (!args.json) {
    console.error(
      `\n❌ check-bundle: ${overBudget.length} route(s) over the ${fmtBytes(args.threshold)} budget`,
    );
    for (const r of overBudget) {
      console.error(`   • ${r.canonical}: ${fmtBytes(r.totalGzipBytes)} gzip`);
    }
    console.error(
      `\nReduce per-route initial chunks (lazy-load feature modules, split vendor chunks),`,
    );
    console.error(`then rerun \`pnpm --filter @proctira/web build && pnpm check:bundle\`.`);
  }
  process.exit(1);
}

// Only execute the CLI when this file is the entry point. Importing the
// module (Vitest spec) does not run main().
const isMainModule = (() => {
  try {
    return resolve(process.argv[1] ?? '') === resolve(__filename);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    // Controlled "missing build directory" failures don't need a stack —
    // the error message itself tells the user exactly what to do.
    const isExpected = err instanceof Error && err.name === 'BuildDirMissingError';
    console.error(
      `check-bundle: ${
        isExpected ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)
      }`,
    );
    process.exit(2);
  });
}
