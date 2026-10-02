#!/usr/bin/env node
/**
 * G-405 — lightweight i18n extraction lint for campus module namespaces.
 *
 * Fails (non-zero) when:
 *   - no locale files are found under apps/web/src/messages;
 *   - en.json is missing a required campus key;
 *   - any locale is missing a nested key that en.json defines under the campus
 *     namespaces (transport / library / communication / hostel / fees / nav),
 *     or has an empty string value for it (PRC-L179).
 *
 * Usage: node tools/scripts/check-campus-i18n.mjs [messagesDir]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MESSAGES_DIR = join(HERE, '../../apps/web/src/messages');
export const BASE_LOCALE = 'en.json';
export const REQUIRED = {
  transport: ['title', 'routes', 'vehicles', 'assignments'],
  library: ['title', 'catalog', 'circulation', 'overdues', 'fines'],
  communication: ['title', 'campaigns', 'emergency', 'send'],
  hostel: ['title', 'blocks', 'rooms', 'assignments'],
  fees: ['title', 'invoices', 'payments', 'receipts'],
  nav: ['transport', 'library', 'communication', 'hostel', 'fees'],
};

/**
 * Flatten leaf keys: `{ a: { b: 'x' } }` → `['a.b']`.
 * @param {unknown} obj
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function leafKeys(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? leafKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function lookup(obj, dotted) {
  return dotted
    .split('.')
    .reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), obj);
}

/**
 * @param {Record<string, unknown>} locales file name → parsed messages
 * @returns {{ errors: string[], localeCount: number }}
 */
export function evaluateCampusI18n(locales) {
  const errors = [];
  const files = Object.keys(locales).sort();
  if (files.length === 0) {
    return { errors: ['no locale files found'], localeCount: 0 };
  }
  const base = locales[BASE_LOCALE];
  if (!base) {
    return { errors: [`base locale ${BASE_LOCALE} not found`], localeCount: files.length };
  }
  /** @type {string[]} */
  const expected = [];
  for (const [ns, keys] of Object.entries(REQUIRED)) {
    const nsKeys = new Set(leafKeys(base[ns]));
    for (const key of keys) {
      if (!nsKeys.has(key)) errors.push(`${BASE_LOCALE}:${ns}.${key} (required)`);
    }
    for (const key of nsKeys) expected.push(`${ns}.${key}`);
  }
  for (const file of files) {
    for (const dotted of expected) {
      const value = lookup(locales[file], dotted);
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`${file}:${dotted}`);
      }
    }
  }
  return { errors, localeCount: files.length };
}

/**
 * @param {string} dir
 * @returns {Record<string, unknown>}
 */
export function loadLocales(dir) {
  if (!existsSync(dir)) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    out[file] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  }
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_MESSAGES_DIR;
  let result;
  try {
    result = evaluateCampusI18n(loadLocales(dir));
  } catch (err) {
    console.error(`❌ G-405 campus i18n: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (result.errors.length > 0) {
    console.error(`❌ G-405 campus i18n: ${result.errors.length} issue(s) in ${dir}:`);
    for (const m of result.errors.slice(0, 40)) console.error(`  - ${m}`);
    if (result.errors.length > 40) console.error(`  … +${result.errors.length - 40} more`);
    process.exit(1);
  }
  console.log(
    `✅ G-405 campus i18n: ${result.localeCount} locale(s) match ${BASE_LOCALE} campus key sets.`,
  );
}
