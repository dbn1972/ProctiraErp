#!/usr/bin/env node
/**
 * G-405 — lightweight i18n extraction lint for campus module namespaces.
 *
 * Fails if any locale under apps/web/src/messages is missing required keys
 * for transport / library / communication / hostel / fees / nav.
 *
 * Usage: node tools/scripts/check-campus-i18n.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, '../../apps/web/src/messages');

const REQUIRED = {
  transport: ['title', 'routes', 'vehicles', 'assignments'],
  library: ['title', 'catalog', 'circulation', 'overdues', 'fines'],
  communication: ['title', 'campaigns', 'emergency', 'send'],
  hostel: ['title', 'blocks', 'rooms', 'assignments'],
  fees: ['title', 'invoices', 'payments', 'receipts'],
  nav: ['transport', 'library', 'communication', 'hostel', 'fees'],
};

const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'));
const missing = [];

for (const file of locales) {
  const data = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf8'));
  for (const [ns, keys] of Object.entries(REQUIRED)) {
    for (const key of keys) {
      const value = data?.[ns]?.[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        missing.push(`${file}:${ns}.${key}`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error(`❌ G-405 campus i18n: ${missing.length} missing key(s):`);
  for (const m of missing.slice(0, 40)) console.error(`  - ${m}`);
  if (missing.length > 40) console.error(`  … +${missing.length - 40} more`);
  process.exit(1);
}

console.log(`✅ G-405 campus i18n: ${locales.length} locale(s) have required campus keys.`);
