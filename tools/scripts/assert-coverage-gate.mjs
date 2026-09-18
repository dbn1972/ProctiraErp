#!/usr/bin/env node
/**
 * W3-TEST-04 — assert unit-test coverage artifacts exist and meet baseline floors.
 *
 * Walks the workspace for coverage/coverage-summary.json files (Vitest v8 /
 * Istanbul format) and aggregates totals. Fails closed in CI when no artifacts
 * are found or aggregate percentages fall below tools/scripts/coverage-gate-baseline.json.
 *
 * Usage:
 *   node tools/scripts/assert-coverage-gate.mjs [repo-root]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_BASELINE = {
  globalMinimum: { lines: 5, statements: 5, functions: 5, branches: 3 },
  requireArtifacts: true,
};

export function coverageGateRequired(env = process.env) {
  if (env.ALLOW_COVERAGE_SKIP === '1') return false;
  if (env.REQUIRE_COVERAGE_GATE === '1') return true;
  return env.CI === 'true' || env.CI === '1';
}

function loadBaseline(root) {
  const path = join(root, 'tools/scripts/coverage-gate-baseline.json');
  try {
    return { ...DEFAULT_BASELINE, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return DEFAULT_BASELINE;
  }
}

function walkCoverageArtifacts(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next')
        continue;
      walkCoverageArtifacts(full, out);
      continue;
    }
    if (entry.name === 'coverage-summary.json' || entry.name === 'coverage-final.json') {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} finalMap Istanbul coverage-final.json payload
 */
export function aggregateFromCoverageFinal(finalMap) {
  const keys = ['lines', 'statements', 'functions', 'branches'];
  const totals = Object.fromEntries(keys.map((k) => [k, { covered: 0, total: 0 }]));

  for (const entry of Object.values(finalMap)) {
    if (!entry || typeof entry !== 'object') continue;
    const statements = entry.s ?? {};
    const functions = entry.f ?? {};
    const branches = entry.b ?? {};

    for (const count of Object.values(statements)) {
      totals.statements.total += 1;
      if (Number(count) > 0) totals.statements.covered += 1;
    }
    for (const count of Object.values(functions)) {
      totals.functions.total += 1;
      if (Number(count) > 0) totals.functions.covered += 1;
    }
    for (const branchHits of Object.values(branches)) {
      if (Array.isArray(branchHits)) {
        for (const hit of branchHits) {
          totals.branches.total += 1;
          if (Number(hit) > 0) totals.branches.covered += 1;
        }
      }
    }
    // Vitest v8 maps statements ≈ lines for gate purposes.
    totals.lines.total += Object.keys(statements).length;
    totals.lines.covered += Object.values(statements).filter((n) => Number(n) > 0).length;
  }

  const pct = {};
  for (const key of keys) {
    const { covered, total } = totals[key];
    pct[key] = total > 0 ? (covered / total) * 100 : 0;
  }
  return { totals, pct };
}

function loadArtifactAggregate(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (path.endsWith('coverage-summary.json')) {
    return aggregateCoverage(raw);
  }
  return aggregateFromCoverageFinal(raw);
}

/**
 * @param {Record<string, { lines?: { pct?: number }, statements?: { pct?: number }, functions?: { pct?: number }, branches?: { pct?: number } }>} summary
 */
export function aggregateCoverage(summary) {
  const keys = ['lines', 'statements', 'functions', 'branches'];
  const totals = Object.fromEntries(keys.map((k) => [k, { covered: 0, total: 0 }]));

  for (const entry of Object.values(summary)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const key of keys) {
      const metric = entry[key];
      if (!metric || typeof metric !== 'object') continue;
      const covered = Number(metric.covered ?? 0);
      const total = Number(metric.total ?? 0);
      totals[key].covered += covered;
      totals[key].total += total;
    }
  }

  const pct = {};
  for (const key of keys) {
    const { covered, total } = totals[key];
    pct[key] = total > 0 ? (covered / total) * 100 : 0;
  }
  return { totals, pct };
}

export function evaluateCoverage({ artifactPaths, aggregates, baseline, env = process.env }) {
  const errors = [];
  const required = coverageGateRequired(env);

  if (required && baseline.requireArtifacts && artifactPaths.length === 0) {
    // An affected-package filter can legitimately select no test-bearing
    // workspace (for example a docs- or tooling-only change). That must not be
    // reported as a missing-coverage failure, but "tests ran and produced no
    // coverage" still must. The runner reports its executed task count so the
    // two cases stay distinguishable instead of both looking like zero
    // artifacts. Absent the signal we keep the strict, fail-closed reading.
    if (env.COVERAGE_GATE_EXECUTED_TASKS === '0') {
      return {
        ok: true,
        errors: [],
        aggregate: null,
        artifactCount: 0,
        skipped: true,
        noAffectedTestTasks: true,
      };
    }
    errors.push(
      'No coverage artifacts found (coverage-summary.json or coverage-final.json) — unit tests must run with --coverage in CI (W3-TEST-04)',
    );
    return { ok: false, errors, aggregate: null, artifactCount: 0 };
  }

  if (artifactPaths.length === 0) {
    return { ok: true, errors: [], aggregate: null, artifactCount: 0, skipped: true };
  }

  const keys = ['lines', 'statements', 'functions', 'branches'];
  const totals = Object.fromEntries(keys.map((k) => [k, { covered: 0, total: 0 }]));
  for (const agg of aggregates) {
    for (const key of keys) {
      totals[key].covered += agg.totals[key].covered;
      totals[key].total += agg.totals[key].total;
    }
  }
  const aggregate = {
    totals,
    pct: Object.fromEntries(
      keys.map((key) => [
        key,
        totals[key].total > 0 ? (totals[key].covered / totals[key].total) * 100 : 0,
      ]),
    ),
  };
  const floor = baseline.globalMinimum ?? DEFAULT_BASELINE.globalMinimum;

  for (const key of Object.keys(floor)) {
    const minimum = Number(floor[key] ?? 0);
    const actual = aggregate.pct[key] ?? 0;
    if (actual + 1e-6 < minimum) {
      errors.push(
        `Aggregate ${key} coverage ${actual.toFixed(2)}% is below floor ${minimum}% (W3-TEST-04)`,
      );
    }
  }

  return { ok: errors.length === 0, errors, aggregate, artifactCount: artifactPaths.length };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const root = argv[0] ?? join(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const baseline = loadBaseline(root);
  const artifactPaths = walkCoverageArtifacts(root);
  const aggregates = artifactPaths.map((p) => loadArtifactAggregate(p));

  const result = evaluateCoverage({ artifactPaths, aggregates, baseline, env });

  if (result.skipped) {
    console.warn(
      result.noAffectedTestTasks
        ? '[W3-TEST-04] No affected test tasks executed — no coverage expected, gate satisfied.'
        : '[W3-TEST-04] No coverage artifacts — skipping gate (local mode).',
    );
    return 0;
  }

  // aggregate is null on the fail-closed no-artifacts path. Report the reason
  // instead of dereferencing it and losing the message to a TypeError.
  if (!result.aggregate) {
    for (const e of result.errors) console.error(`[W3-TEST-04] FAIL: ${e}`);
    return 1;
  }

  console.log(
    `[W3-TEST-04] coverage artifacts=${result.artifactCount} lines=${result.aggregate.pct.lines.toFixed(2)}% statements=${result.aggregate.pct.statements.toFixed(2)}% functions=${result.aggregate.pct.functions.toFixed(2)}% branches=${result.aggregate.pct.branches.toFixed(2)}%`,
  );

  if (!result.ok) {
    for (const e of result.errors) console.error(`[W3-TEST-04] FAIL: ${e}`);
    return 1;
  }

  console.log('[W3-TEST-04] OK: coverage artifacts present and above baseline floors');
  return 0;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  process.exit(main());
}
