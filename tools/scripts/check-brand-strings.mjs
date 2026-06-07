#!/usr/bin/env node
/**
 * Brand-string CI grep gate (task 57.4 / Design M).
 *
 * Complements the ESLint rule `proctira/no-hardcoded-brand-strings` (task 57.3)
 * which scans TypeScript/JSX. This script covers everything ESLint cannot:
 * Markdown, HTML, plain text, YAML, JSON, CSV, Handlebars / MJML email
 * templates, etc.
 *
 * Behaviour
 *   • Walks the workspace (using `ripgrep` if available, else a pure-Node
 *     recursive walker) looking for occurrences of any configured brand
 *     string (default `ProctiraERP`, `EduZo`).
 *   • Excludes files matched by globs in
 *     tools/scripts/brand-strings-allowlist.json.
 *   • Exits non-zero on any non-allowlisted match and prints
 *     `<file>:<line>:<matched-line>` for each violation.
 *
 * Usage
 *   node tools/scripts/check-brand-strings.mjs
 *   node tools/scripts/check-brand-strings.mjs --brands=ProctiraERP,EduZo
 *   node tools/scripts/check-brand-strings.mjs --root=/path/to/repo --json
 *
 * The script is also reusable as a library (`scanBrandStrings`,
 * `loadAllowlist`, `isAllowlisted`) for the accompanying Vitest spec.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// CLI argument parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    brands: ['ProctiraERP', 'EduZo'],
    root: null,
    allowlist: null,
    json: false,
    quiet: false,
    forceNode: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--brands=')) {
      args.brands = arg
        .slice('--brands='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--root=')) {
      args.root = arg.slice('--root='.length);
    } else if (arg.startsWith('--allowlist=')) {
      args.allowlist = arg.slice('--allowlist='.length);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--force-node') {
      args.forceNode = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--')) {
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
      'Usage: check-brand-strings [options]',
      '',
      'Options:',
      '  --brands=A,B        Comma-separated brand strings (default ProctiraERP,EduZo)',
      '  --root=PATH         Workspace root to scan (default: monorepo root)',
      '  --allowlist=PATH    Path to allowlist JSON (default: alongside script)',
      '  --json              Emit machine-readable JSON output',
      '  --quiet             Suppress informational logging on success',
      '  --force-node        Skip ripgrep auto-detection; use Node walker',
      '  -h, --help          Show this help',
    ].join('\n'),
  );
}

// ============================================================================
// Allowlist (glob → regexp)
// ============================================================================

/**
 * Convert a POSIX glob into a regular expression. Supports:
 *   *      → any run of non-`/` characters (one segment)
 *   **     → any run of characters including `/` (any number of segments)
 *   ?      → a single non-`/` character
 *   [abc]  → character class
 *
 * The implementation is intentionally small (≈30 lines) so the scanner has
 * zero runtime dependencies and runs even before `pnpm install` completes.
 */
export function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` or `**` → any path segments
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '.') {
      re += '\\.';
    } else if (ch === '/') {
      re += '/';
    } else if (ch === '[') {
      const end = glob.indexOf(']', i);
      if (end === -1) {
        re += '\\[';
      } else {
        re += glob.slice(i, end + 1);
        i = end;
      }
    } else if ('+()^$|{}\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

export async function loadAllowlistAsync(allowlistPath) {
  const raw = await readFile(allowlistPath, 'utf8');
  const parsed = JSON.parse(raw);
  /** @type {{ globs: string[]; matchers: RegExp[] }} */
  const out = { globs: [], matchers: [] };
  const cats = parsed.categories ?? {};
  for (const globs of Object.values(cats)) {
    if (!Array.isArray(globs)) continue;
    for (const g of globs) {
      if (typeof g !== 'string') continue;
      out.globs.push(g);
      out.matchers.push(globToRegExp(g));
    }
  }
  return out;
}

export function isAllowlisted(relPath, allowlist) {
  for (const re of allowlist.matchers) {
    if (re.test(relPath)) return true;
  }
  return false;
}

// ============================================================================
// File walker
// ============================================================================

// File extensions to scan. TypeScript/JSX/JS are excluded — they are covered
// by the ESLint rule from task 57.3.
const SCANNED_EXTS = new Set([
  '.md',
  '.mdx',
  '.html',
  '.htm',
  '.txt',
  '.yml',
  '.yaml',
  '.json',
  '.csv',
  '.hbs',
  '.handlebars',
  '.mjml',
]);

// Directory names whose contents are always skipped during the walk. This is
// a *performance* short-circuit — the same directories are also covered by
// allowlist globs so any accidental match is still ignored.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  '.vscode',
  '.idea',
]);

function shouldScanFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return SCANNED_EXTS.has(name.slice(dot).toLowerCase());
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile() && shouldScanFile(entry.name)) {
      yield full;
    }
  }
}

// ============================================================================
// Scanners
// ============================================================================

/**
 * Build a single regular expression that matches any of the configured
 * brand strings as a whole, case-sensitive.
 */
export function buildBrandRegExp(brands) {
  const escaped = brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`);
}

/**
 * Scan a single file's text for brand strings, returning all match
 * locations (1-indexed line numbers).
 */
export function scanText(text, brandRegExp) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (brandRegExp.test(lines[i])) {
      matches.push({ line: i + 1, content: lines[i] });
    }
  }
  return matches;
}

/**
 * Try to invoke ripgrep. Returns null if rg is unavailable or fails — the
 * caller falls back to the Node walker.
 */
function tryRipgrep(root, brands) {
  const pattern = brands.join('|');
  const args = [
    '-n',
    '--no-heading',
    '--with-filename',
    '-g',
    '*.md',
    '-g',
    '*.mdx',
    '-g',
    '*.html',
    '-g',
    '*.htm',
    '-g',
    '*.txt',
    '-g',
    '*.yml',
    '-g',
    '*.yaml',
    '-g',
    '*.json',
    '-g',
    '*.csv',
    '-g',
    '*.hbs',
    '-g',
    '*.handlebars',
    '-g',
    '*.mjml',
    '-g',
    '!node_modules/**',
    '-g',
    '!**/node_modules/**',
    '-g',
    '!.git/**',
    '-g',
    '!**/.git/**',
    '-g',
    '!.turbo/**',
    '-g',
    '!dist/**',
    '-g',
    '!build/**',
    '-g',
    '!.next/**',
    '-g',
    '!coverage/**',
    '-e',
    pattern,
    root,
  ];
  let result;
  try {
    result = spawnSync('rg', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  if (result.error || result.status === null) return null;
  // rg exits 1 when no matches found — that's success for us; only treat
  // status >= 2 as "tool failure → fall back".
  if (result.status > 1) return null;
  /** @type {Array<{ file: string; line: number; content: string }>} */
  const hits = [];
  if (!result.stdout) return hits;
  for (const raw of result.stdout.split('\n')) {
    if (!raw) continue;
    // Format: <path>:<line>:<content>
    const firstColon = raw.indexOf(':');
    if (firstColon === -1) continue;
    const secondColon = raw.indexOf(':', firstColon + 1);
    if (secondColon === -1) continue;
    const file = raw.slice(0, firstColon);
    const line = Number.parseInt(raw.slice(firstColon + 1, secondColon), 10);
    const content = raw.slice(secondColon + 1);
    if (!Number.isFinite(line)) continue;
    hits.push({ file, line, content });
  }
  return hits;
}

async function scanWithNode(root, brandRegExp) {
  /** @type {Array<{ file: string; line: number; content: string }>} */
  const hits = [];
  for await (const file of walk(root)) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const fileHits = scanText(text, brandRegExp);
    for (const h of fileHits) {
      hits.push({ file, line: h.line, content: h.content });
    }
  }
  return hits;
}

/**
 * Top-level scanner. Picks ripgrep when available and not forced off,
 * falls back to the Node walker. Returns the unfiltered hit list — the
 * caller is responsible for applying the allowlist.
 */
export async function scanBrandStrings({ root, brands, forceNode = false } = {}) {
  const brandRegExp = buildBrandRegExp(brands);
  if (!forceNode) {
    const rg = tryRipgrep(root, brands);
    if (rg !== null) return { engine: 'ripgrep', hits: rg };
  }
  const hits = await scanWithNode(root, brandRegExp);
  return { engine: 'node', hits };
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(args.root ?? join(here, '..', '..'));
  const allowlistPath = resolve(args.allowlist ?? join(here, 'brand-strings-allowlist.json'));

  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (err) {
    console.error(`check-brand-strings: cannot access root ${root}: ${err.message}`);
    process.exit(2);
  }
  if (!rootStat.isDirectory()) {
    console.error(`check-brand-strings: --root must be a directory (got ${root})`);
    process.exit(2);
  }

  const allowlist = await loadAllowlistAsync(allowlistPath);

  if (!args.quiet && !args.json) {
    console.log(
      `check-brand-strings: scanning ${root} for ${args.brands.join(', ')} (allowlist: ${allowlist.globs.length} globs)`,
    );
  }

  const { engine, hits } = await scanBrandStrings({
    root,
    brands: args.brands,
    forceNode: args.forceNode,
  });

  // Filter out allowlisted files. Path matching is performed against the
  // POSIX-style relative path so globs work the same on Windows runners.
  const violations = [];
  for (const hit of hits) {
    const rel = relative(root, hit.file).split(sep).join('/');
    if (rel.startsWith('..')) continue; // outside root, ignore
    if (isAllowlisted(rel, allowlist)) continue;
    violations.push({ ...hit, relPath: rel });
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          engine,
          root,
          brands: args.brands,
          totalHits: hits.length,
          violations,
        },
        null,
        2,
      ) + '\n',
    );
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    if (!args.quiet) {
      console.log(
        `✅ check-brand-strings: 0 violations (${hits.length} allowlisted match(es), engine=${engine}).`,
      );
    }
    process.exit(0);
  }

  console.error(
    `❌ check-brand-strings: ${violations.length} hardcoded brand string(s) found outside the allowlist (engine=${engine}).`,
  );
  console.error(
    'Either replace the literal with a tenant-resolved value (e.g. {{brand_name}} or `useBrand().name`) or extend tools/scripts/brand-strings-allowlist.json.\n',
  );
  for (const v of violations) {
    console.error(`  ${v.relPath}:${v.line}: ${v.content.trim()}`);
  }
  process.exit(1);
}

// Only run main() when invoked directly, not when imported by tests.
const invokedDirectly = (() => {
  try {
    return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error('check-brand-strings: fatal error', err);
    process.exit(2);
  });
}
