/**
 * Meta-test (PRC-L504): every check under src/checks must have a matching
 * test case under test/cases, so a newly added check cannot ship untested.
 */
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const title = 'coverage: every DoD check has a test case';

const here = dirname(fileURLToPath(import.meta.url));
const checksDir = resolve(here, '../../src/checks');

/** Check files whose test case uses a shorter historical name. */
const CASE_ALIASES = { 'i18n-readiness': 'i18n' };

export async function run() {
  const checks = (await readdir(checksDir)).filter((n) => n.endsWith('.mjs'));
  const cases = new Set((await readdir(here)).filter((n) => n.endsWith('.test.mjs')));
  const results = [
    {
      name: 'src/checks is not empty',
      ok: checks.length > 0,
      message: `no checks found in ${checksDir}`,
    },
  ];
  for (const file of checks) {
    const base = file.replace(/\.mjs$/, '');
    const expected = `${CASE_ALIASES[base] ?? base}.test.mjs`;
    results.push({
      name: `${file} has test/cases/${expected}`,
      ok: cases.has(expected),
      message: `missing test/cases/${expected}`,
    });
  }
  return results;
}
