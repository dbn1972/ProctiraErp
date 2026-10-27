#!/usr/bin/env node
/**
 * PRC-L309 — repository-wide ESLint debt ratchet.
 *
 * PR CI lints only the files a change touches (ci.yml "Run ESLint (full change
 * range)"), so existing debt elsewhere is never enforced and can grow through
 * config or dependency changes. This ratchet lints every git-tracked TS/JS file
 * (same exclusions as the PR lint step) and compares per-file ESLint error
 * counts with tools/scripts/lint-ratchet-baseline.json:
 *   --check           fail when any file's error count increased or a new file
 *                     has errors; print files that improved
 *   --write-baseline  write current counts; when a baseline already exists it
 *                     refuses to record any increase, so the baseline only shrinks
 *
 * Runs nightly from .github/workflows/lint-ratchet.yml. Heavy (type-aware lint
 * of the whole repository); batches of BATCH_SIZE files per ESLint process.
 *
 * Usage: node tools/scripts/lint-ratchet.mjs --check | --write-baseline
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE_REL = 'tools/scripts/lint-ratchet-baseline.json';
const PATTERNS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'];
// Same exclusions as the ci.yml PR ESLint step.
export const EXCLUDE_RE = /(^|\/)(dist|\.next|coverage|node_modules|%5F%5Ftests)\//;
const BATCH_SIZE = Number(process.env.LINT_RATCHET_BATCH_SIZE || 400);

/**
 * Pure comparison of per-file error counts.
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} current
 */
export function compareCounts(baseline, current) {
  const regressions = [];
  const improvements = [];
  for (const [file, count] of Object.entries(current)) {
    const before = baseline[file] ?? 0;
    if (count > before) regressions.push({ file, before, after: count });
  }
  for (const [file, before] of Object.entries(baseline)) {
    const after = current[file] ?? 0;
    if (after < before) improvements.push({ file, before, after });
  }
  const sort = (a, b) => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(sort), improvements: improvements.sort(sort) };
}

/** Converts ESLint JSON results to { relativePath: errorCount } (errors > 0 only). */
export function countsFromResults(results, root = ROOT) {
  const counts = {};
  for (const r of results) {
    if (r.errorCount > 0) counts[relative(root, r.filePath).split('\\').join('/')] = r.errorCount;
  }
  return counts;
}

export function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function listFiles() {
  return execFileSync('git', ['ls-files', '--', ...PATTERNS], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !EXCLUDE_RE.test(f) && existsSync(join(ROOT, f)));
}

/**
 * ESLint aborts the whole run (exit 2) when a rule crashes on one file. That
 * file is a lint failure in its own right (the PR lint step would also abort on
 * it), so it is recorded as one fatal error and the batch is re-run without it.
 */
export function crashedFile(stderr, batch, root = ROOT) {
  const m = /Occurred while linting (.+?)(?::\d+)?\s*$/m.exec(stderr || '');
  if (!m) return null;
  const rel = relative(root, m[1].trim()).split('\\').join('/');
  return batch.includes(rel) ? rel : null;
}

function lintAll(files) {
  const results = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    let batch = files.slice(i, i + BATCH_SIZE);
    console.error(`lint-ratchet: ESLint batch ${i / BATCH_SIZE + 1} (${batch.length} files)`);
    while (batch.length > 0) {
      const r = spawnSync(
        'pnpm',
        ['exec', 'eslint', '--format', 'json', '--no-error-on-unmatched-pattern', ...batch],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
      );
      // ESLint exits 1 when lint errors exist; 2 means it could not run.
      if (r.status === 0 || r.status === 1) {
        results.push(...JSON.parse(r.stdout));
        break;
      }
      const crashed = crashedFile(r.stderr, batch);
      if (!crashed) {
        throw new Error(`eslint exited ${r.status}: ${(r.stderr || '').slice(0, 2000)}`);
      }
      console.error(`lint-ratchet: ESLint crashed on ${crashed}; counted as 1 fatal error`);
      results.push({ filePath: join(ROOT, crashed), errorCount: 1, fatal: true });
      batch = batch.filter((f) => f !== crashed);
    }
  }
  return results;
}

function readBaseline() {
  const path = join(ROOT, BASELINE_REL);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')).files ?? {};
}

function main(argv) {
  const mode = argv.includes('--write-baseline')
    ? 'write'
    : argv.includes('--check')
      ? 'check'
      : null;
  if (!mode) {
    console.error('usage: node tools/scripts/lint-ratchet.mjs --check | --write-baseline');
    return 2;
  }
  const baseline = readBaseline();
  if (mode === 'check' && baseline === null) {
    console.error(`lint-ratchet: FAIL — ${BASELINE_REL} is missing`);
    return 1;
  }
  const files = listFiles();
  const current = countsFromResults(lintAll(files));
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  const { regressions, improvements } = compareCounts(baseline ?? {}, current);
  if (mode === 'write') {
    if (baseline !== null && regressions.length > 0) {
      console.error('lint-ratchet: refusing to record lint debt growth in the baseline:');
      for (const r of regressions) console.error(`  ${r.file}: ${r.before} -> ${r.after}`);
      return 1;
    }
    const doc = {
      $comment:
        'PRC-L309: per-file ESLint error counts for every git-tracked TS/JS file (ci.yml PR lint exclusions). Generated by `node tools/scripts/lint-ratchet.mjs --write-baseline`; may only shrink.',
      totalErrors: total,
      files: sortedCounts(current),
    };
    writeFileSync(join(ROOT, BASELINE_REL), `${JSON.stringify(doc, null, 2)}\n`);
    console.log(
      `lint-ratchet: baseline written (${files.length} files linted, ${total} errors in ${Object.keys(current).length} files)`,
    );
    return 0;
  }
  for (const i of improvements) console.log(`improved: ${i.file}: ${i.before} -> ${i.after}`);
  if (regressions.length > 0) {
    console.error('lint-ratchet: FAIL — lint debt grew:');
    for (const r of regressions) console.error(`  ${r.file}: ${r.before} -> ${r.after}`);
    return 1;
  }
  console.log(
    `lint-ratchet: PASS (${files.length} files linted, ${total} errors, none above baseline)`,
  );
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`lint-ratchet: FAIL — ${err.message}`);
    process.exit(1);
  }
}
