#!/usr/bin/env node
/**
 * Locale catalog parity gate (task 60.4 / Design C, Requirement 18 AC 6, 7, 9).
 *
 * Walks every JSON file under `apps/web/src/messages/`, compares the key set
 * of each locale catalog against the canonical English (`en.json`) catalog,
 * and exits non-zero if any catalog is missing keys, has extra keys, or
 * disagrees on ICU placeholders.
 *
 * Checks performed against `en.json`:
 *   • Every locale must define every leaf key (no missing keys).
 *   • Locales may not introduce keys absent from `en.json` (no extra keys).
 *   • The set of ICU placeholders ({name}, {brand}, …) inside each leaf
 *     value must match English exactly. Translations are free to reorder
 *     placeholders inside the string but must not drop or invent any.
 *
 * Outputs a human-readable diff per locale and exits 1 on any failure so
 * CI can use this script as a release gate (`pnpm check:i18n`).
 *
 * Usage
 *   node tools/scripts/check-i18n.mjs
 *   node tools/scripts/check-i18n.mjs --json
 *   node tools/scripts/check-i18n.mjs --messages=/abs/path/to/messages
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MESSAGES_DIR = resolve(
  REPO_ROOT,
  'apps',
  'web',
  'src',
  'messages',
);
const REFERENCE_LOCALE = 'en';

/**
 * Recursively flattens a nested message object into a flat map of dotted
 * key paths to leaf strings.
 *
 * @param {unknown} value
 * @param {string} prefix
 * @param {Map<string, string>} out
 */
function flatten(value, prefix, out) {
  if (typeof value === 'string') {
    out.set(prefix, value);
    return;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const nextPrefix = prefix === '' ? key : `${prefix}.${key}`;
      flatten(child, nextPrefix, out);
    }
    return;
  }
  // Numbers, booleans, arrays, null are not legal message leaves.
  out.set(prefix, `__INVALID_LEAF__:${typeof value}`);
}

/**
 * Extract the set of ICU placeholder names (e.g. `{name}`) used in a
 * message string. Only simple `{name}` and `{name, ...}` placeholders are
 * recognised; that's enough to catch divergence between catalogs.
 *
 * @param {string} message
 * @returns {Set<string>}
 */
function extractPlaceholders(message) {
  const placeholders = new Set();
  const pattern = /\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let match;
  while ((match = pattern.exec(message)) !== null) {
    placeholders.add(match[1]);
  }
  return placeholders;
}

/**
 * Compare two placeholder sets and return the symmetric diff.
 *
 * @param {Set<string>} expected
 * @param {Set<string>} actual
 */
function diffPlaceholders(expected, actual) {
  const missing = [...expected].filter((p) => !actual.has(p));
  const extra = [...actual].filter((p) => !expected.has(p));
  return { missing, extra };
}

/**
 * Parse a JSON file and flatten it.
 *
 * @param {string} filePath
 * @returns {Promise<Map<string, string>>}
 */
async function loadCatalog(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const flat = new Map();
  flatten(parsed, '', flat);
  return flat;
}

/**
 * Audit every locale catalog under `messagesDir` against the reference
 * locale (`en.json`).
 *
 * @param {string} messagesDir
 * @returns {Promise<{report: object, ok: boolean}>}
 */
export async function checkI18n(messagesDir = DEFAULT_MESSAGES_DIR) {
  const entries = await readdir(messagesDir);
  const localeFiles = entries
    .filter((name) => name.endsWith('.json'))
    .sort();

  const referenceFile = `${REFERENCE_LOCALE}.json`;
  if (!localeFiles.includes(referenceFile)) {
    throw new Error(
      `Reference locale ${referenceFile} is missing from ${messagesDir}`,
    );
  }

  const reference = await loadCatalog(join(messagesDir, referenceFile));

  const report = {
    messagesDir,
    referenceLocale: REFERENCE_LOCALE,
    referenceKeyCount: reference.size,
    locales: {},
  };

  let ok = true;

  for (const file of localeFiles) {
    if (file === referenceFile) {
      report.locales[REFERENCE_LOCALE] = {
        keyCount: reference.size,
        missing: [],
        extra: [],
        placeholderMismatches: [],
        ok: true,
      };
      continue;
    }
    const locale = file.replace(/\.json$/, '');
    const catalog = await loadCatalog(join(messagesDir, file));

    const missing = [];
    const extra = [];
    const placeholderMismatches = [];

    for (const [key, refValue] of reference) {
      if (!catalog.has(key)) {
        missing.push(key);
        continue;
      }
      const refPlaceholders = extractPlaceholders(refValue);
      const localePlaceholders = extractPlaceholders(catalog.get(key));
      const diff = diffPlaceholders(refPlaceholders, localePlaceholders);
      if (diff.missing.length > 0 || diff.extra.length > 0) {
        placeholderMismatches.push({ key, ...diff });
      }
    }
    for (const key of catalog.keys()) {
      if (!reference.has(key)) {
        extra.push(key);
      }
    }

    const localeOk =
      missing.length === 0 &&
      extra.length === 0 &&
      placeholderMismatches.length === 0;

    report.locales[locale] = {
      keyCount: catalog.size,
      missing,
      extra,
      placeholderMismatches,
      ok: localeOk,
    };

    if (!localeOk) {
      ok = false;
    }
  }

  return { report, ok };
}

function formatHuman(report) {
  const lines = [];
  lines.push(
    `Locale catalog audit (reference: ${report.referenceLocale}.json, ${report.referenceKeyCount} keys)`,
  );
  lines.push(`Messages dir: ${report.messagesDir}`);
  lines.push('');

  const locales = Object.keys(report.locales).sort();
  for (const locale of locales) {
    const info = report.locales[locale];
    const status = info.ok ? '✓' : '✗';
    lines.push(`${status} ${locale}.json — ${info.keyCount} keys`);
    if (info.missing.length > 0) {
      lines.push(`    missing (${info.missing.length}):`);
      for (const key of info.missing) {
        lines.push(`      - ${key}`);
      }
    }
    if (info.extra.length > 0) {
      lines.push(`    extra (${info.extra.length}):`);
      for (const key of info.extra) {
        lines.push(`      + ${key}`);
      }
    }
    if (info.placeholderMismatches.length > 0) {
      lines.push(
        `    placeholder mismatches (${info.placeholderMismatches.length}):`,
      );
      for (const m of info.placeholderMismatches) {
        const parts = [];
        if (m.missing.length > 0)
          parts.push(`missing {${m.missing.join(', ')}}`);
        if (m.extra.length > 0) parts.push(`extra {${m.extra.join(', ')}}`);
        lines.push(`      ! ${m.key}: ${parts.join('; ')}`);
      }
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { json: false, messages: DEFAULT_MESSAGES_DIR };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') args.json = true;
    else if (arg.startsWith('--messages=')) args.messages = arg.slice('--messages='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { report, ok } = await checkI18n(args.messages);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(report)}\n`);
  }
  if (!ok) {
    process.exitCode = 1;
  }
}

const isDirectInvocation = process.argv[1] === __filename;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
