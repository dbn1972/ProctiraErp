/**
 * PRC-L387 — check-i18n.mjs (locale catalog parity) must fail on a missing
 * locale key, an extra key, or a dropped ICU placeholder, and pass on parity.
 * Uses temp catalogs via --messages=; the real catalogs are not touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'check-i18n.mjs');

const EN = { nav: { home: 'Home', greet: 'Hello {name}' }, title: 'Proctira' };

function run(catalogs) {
  const dir = mkdtempSync(join(tmpdir(), 'l387-i18n-'));
  try {
    for (const [locale, body] of Object.entries(catalogs)) {
      writeFileSync(join(dir, `${locale}.json`), JSON.stringify(body));
    }
    return spawnSync(process.execPath, [script, `--messages=${dir}`, '--json'], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('matching catalogs pass', () => {
  const r = run({
    en: EN,
    hi: { nav: { home: 'घर', greet: 'नमस्ते {name}' }, title: 'प्रोक्टिरा' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('absent locale key fails', () => {
  const r = run({ en: EN, hi: { nav: { home: 'घर' }, title: 'प्रोक्टिरा' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nav\.greet/);
});

test('extra locale key fails', () => {
  const r = run({ en: EN, hi: { ...EN, extra: 'x' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /extra/);
});

test('dropped ICU placeholder fails', () => {
  const r = run({ en: EN, hi: { nav: { home: 'घर', greet: 'नमस्ते' }, title: 'प्रोक्टिरा' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /name/);
});

test('missing reference en.json fails closed', () => {
  const r = run({ hi: EN });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Reference locale en\.json is missing/);
});
