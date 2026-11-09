#!/usr/bin/env node
/**
 * UAT-ENV-007 — fail-closed skip gate for Playwright JSON reports.
 *
 * The E2E backend-ready shards and live gate used to fail only on unexpected
 * tests, so a shard could be green while silently skipping tests. This gate
 * fails when:
 *   - the report is missing, unreadable, malformed or executed no test;
 *   - the report has top-level errors or unexpected (failed) tests;
 *   - its per-test statuses do not add up to `stats`;
 *   - any skipped test is not on the allowlist
 *     (tools/scripts/e2e-backend-ready-skip-allowlist.json);
 *   - an allowlisted test ran and did not skip (stale entry).
 * Merged mode (the live gate, all shards in one report) also fails when an
 * allowlisted test is absent although its spec file ran. With
 * --require-allowlisted it fails when an allowlisted test is absent at all.
 * Shard mode cannot require presence: Playwright puts each test in exactly one
 * shard, so an allowlisted test is legitimately absent from the other shards.
 *
 * Allowlist entries are keyed by spec file (relative to the Playwright testDir,
 * apps/web/e2e) plus the full title path (describe titles, then the test
 * title). The line number is informational only.
 *
 * Usage:
 *   node tools/scripts/assert-playwright-skips.mjs --report <playwright-json>
 *     [--allowlist <json>] [--mode shard|merged] [--require-allowlisted]
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TAG = '[UAT-ENV-007]';
const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOWLIST = resolve(here, 'e2e-backend-ready-skip-allowlist.json');
const STATUSES = ['expected', 'unexpected', 'flaky', 'skipped'];

function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

/** Spec path relative to the report's rootDir (the Playwright testDir). */
export function normalizeFile(file, rootDir) {
  let f = toPosix(file);
  if (rootDir && isAbsolute(f)) f = toPosix(relative(rootDir, f));
  return f.replace(/^\.\//, '');
}

export function testKey(file, titlePath) {
  return JSON.stringify([file, ...titlePath]);
}

/**
 * @param {unknown} doc parsed allowlist JSON
 * @returns {{ entries: Array<{file: string, title: string[], key: string}>, errors: string[] }}
 */
export function parseAllowlist(doc) {
  const errors = [];
  const entries = [];
  if (!doc || !Array.isArray(doc.entries)) {
    return { entries, errors: ['allowlist must be an object with an "entries" array'] };
  }
  const seen = new Set();
  doc.entries.forEach((e, i) => {
    const titleOk =
      Array.isArray(e?.title) &&
      e.title.length > 0 &&
      e.title.every((t) => typeof t === 'string' && t.length > 0);
    const missing = ['file', 'reason', 'decision'].filter(
      (k) => typeof e?.[k] !== 'string' || e[k].trim() === '',
    );
    if (!titleOk) missing.push('title');
    if (missing.length > 0) {
      errors.push(`allowlist entry ${i} lacks ${missing.join(', ')}`);
      return;
    }
    const file = normalizeFile(e.file);
    const key = testKey(file, e.title);
    if (seen.has(key)) {
      errors.push(`allowlist entry ${i} duplicates ${key}`);
      return;
    }
    seen.add(key);
    entries.push({ file, title: e.title, key });
  });
  return { entries, errors };
}

/**
 * Flattens a Playwright JSON report into one row per test (spec x project).
 * @returns {Array<{file: string, titlePath: string[], status: string, project: string, line: number}>}
 */
export function collectTests(report) {
  const rootDir = report?.config?.rootDir;
  const rows = [];
  const walk = (suite, titles) => {
    for (const spec of suite?.specs ?? []) {
      const file = normalizeFile(spec.file ?? suite.file, rootDir);
      for (const t of spec.tests ?? []) {
        rows.push({
          file,
          titlePath: [...titles, String(spec.title)],
          status: String(t?.status ?? ''),
          project: String(t?.projectName ?? ''),
          line: Number(spec.line ?? 0),
        });
      }
    }
    for (const child of suite?.suites ?? []) walk(child, [...titles, String(child.title)]);
  };
  // Top-level suites are the spec files; their titles are not part of the test title path.
  for (const top of report?.suites ?? []) walk(top, []);
  return rows;
}

/**
 * @param {unknown} report Playwright JSON reporter payload
 * @param {unknown} allowlistDoc parsed allowlist JSON
 * @param {{ mode?: 'shard' | 'merged', requireAllowlisted?: boolean }} [options]
 */
export function evaluatePlaywrightReport(report, allowlistDoc, options = {}) {
  const mode = options.mode ?? 'shard';
  const requireAllowlisted = options.requireAllowlisted === true;
  const errors = [];
  const notes = [];
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const result = () => ({
    ok: errors.length === 0,
    errors,
    notes,
    mode,
    counts,
    executed: counts.expected + counts.unexpected + counts.flaky,
  });

  const allowlist = parseAllowlist(allowlistDoc);
  errors.push(...allowlist.errors);
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites) || !report.stats) {
    errors.push('report is not a Playwright JSON report (needs "suites" and "stats")');
    return result();
  }
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    errors.push(`report has ${report.errors.length} top-level error(s)`);
  }

  const rows = collectTests(report);
  for (const row of rows) {
    if (STATUSES.includes(row.status)) counts[row.status] += 1;
    else errors.push(`unknown test status "${row.status}" for ${testKey(row.file, row.titlePath)}`);
  }
  for (const s of STATUSES) {
    if (Number(report.stats[s] ?? 0) !== counts[s]) {
      errors.push(`stats.${s}=${report.stats[s]} but the report lists ${counts[s]} ${s} test(s)`);
    }
  }
  if (counts.expected + counts.unexpected + counts.flaky === 0) {
    errors.push('report executed no tests (empty run)');
  }
  if (counts.unexpected > 0) {
    errors.push(`${counts.unexpected} unexpected (failed) test(s)`);
  }

  const allowed = new Map(allowlist.entries.map((e) => [e.key, e]));
  const byKey = new Map();
  for (const row of rows) {
    const key = testKey(row.file, row.titlePath);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
    if (row.status === 'skipped' && !allowed.has(key)) {
      errors.push(
        `unlisted skip: ${row.file}:${row.line} ${row.titlePath.join(' > ')} [${row.project}]`,
      );
    }
  }

  const filesInRun = new Set(rows.map((r) => r.file));
  for (const entry of allowlist.entries) {
    const label = `${entry.file} ${entry.title.join(' > ')}`;
    const found = byKey.get(entry.key) ?? [];
    const ran = found.filter((r) => r.status !== 'skipped');
    if (ran.length > 0) {
      errors.push(
        `stale allowlist entry: ${label} ran with status ${ran.map((r) => r.status).join(',')}; remove it from the allowlist`,
      );
      continue;
    }
    if (found.length > 0) {
      notes.push(`allowlisted skip: ${label}`);
      continue;
    }
    if (requireAllowlisted) {
      errors.push(`allowlisted test missing from the run: ${label}`);
    } else if (mode === 'merged' && filesInRun.has(entry.file)) {
      errors.push(
        `allowlisted test missing although ${entry.file} ran (renamed or deleted?): ${label}`,
      );
    } else {
      notes.push(`allowlisted test not in this ${mode === 'merged' ? 'run' : 'shard'}: ${label}`);
    }
  }
  return result();
}

function parseArgs(argv) {
  const opts = { mode: 'shard', allowlist: DEFAULT_ALLOWLIST, requireAllowlisted: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--report') opts.report = argv[++i];
    else if (a === '--allowlist') opts.allowlist = argv[++i];
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--require-allowlisted') opts.requireAllowlisted = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.report) throw new Error('--report <playwright-json> is required');
  if (opts.mode !== 'shard' && opts.mode !== 'merged') {
    throw new Error(`--mode must be shard or merged, got ${opts.mode}`);
  }
  return opts;
}

function readJson(path, what) {
  try {
    return { doc: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { error: `cannot read ${what} ${path}: ${err.message}` };
  }
}

export function main(argv = process.argv.slice(2), out = console) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    out.error(`${TAG} usage error: ${err.message}`);
    out.error(
      'Usage: assert-playwright-skips.mjs --report <json> [--allowlist <json>] [--mode shard|merged] [--require-allowlisted]',
    );
    return 2;
  }
  const report = readJson(opts.report, 'Playwright JSON report');
  const allowlist = readJson(opts.allowlist, 'skip allowlist');
  const loadErrors = [report.error, allowlist.error].filter(Boolean);
  if (loadErrors.length > 0) {
    for (const e of loadErrors) out.error(`${TAG} FAIL: ${e}`);
    return 1;
  }
  const r = evaluatePlaywrightReport(report.doc, allowlist.doc, opts);
  out.log(
    `${TAG} mode=${r.mode} executed=${r.executed} skipped=${r.counts.skipped} unexpected=${r.counts.unexpected} flaky=${r.counts.flaky}`,
  );
  for (const n of r.notes) out.log(`${TAG} ${n}`);
  if (!r.ok) {
    for (const e of r.errors) out.error(`${TAG} FAIL: ${e}`);
    return 1;
  }
  out.log(`${TAG} OK: every skip is allowlisted and every allowlisted test that ran skipped`);
  return 0;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  process.exit(main());
}
