#!/usr/bin/env node
/**
 * Lightweight unit-test runner for the DoD checks. We avoid bringing a full
 * test framework into the tools folder so the checks can run from a clean
 * `node_modules`-less environment in the bootstrap stage of CI.
 *
 * Each test file under `test/cases/` exports an async `run()` function that
 * returns `{ name, ok, message }` for every assertion.
 */
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = resolve(here, 'cases');

let passed = 0;
let failed = 0;

async function loadCases() {
  const entries = await readdir(casesDir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.test.mjs')).map((e) => resolve(casesDir, e.name));
}

console.log('═'.repeat(70));
console.log(' DoD Checks — Unit Tests');
console.log('═'.repeat(70));

const cases = await loadCases();
for (const file of cases) {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.run !== 'function') {
    console.warn(`  ⚠️  ${file} has no exported run()`);
    continue;
  }
  console.log(`\n📋 ${mod.title ?? file}`);
  const results = await mod.run();
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✅ ${r.name}`);
      passed++;
    } else {
      console.error(`  ❌ ${r.name}: ${r.message ?? '(no detail)'}`);
      failed++;
    }
  }
}

console.log('\n' + '═'.repeat(70));
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(70));
process.exit(failed > 0 ? 1 : 0);
