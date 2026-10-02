/**
 * PRC-L375: degraded analysis must not pass silently.
 *  - CI run without ts-morph exits 2 (unless DOD_REQUIRE_AST=0).
 *  - An unreadable enumerated file throws instead of scanning as ''.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeReadFile } from '../../src/lib/fs-utils.mjs';
import { isAstRequired } from '../../src/lib/ts-ast.mjs';

export const title = 'fail-closed: missing ts-morph in CI and unreadable files';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../bin/dod-check.mjs');

function runCli(env, dir) {
  return spawnSync(
    process.execPath,
    [cli, '--only=error-envelope', '--json', `--report=${resolve(dir, 'r.json')}`],
    { encoding: 'utf8', env: { ...process.env, DOD_SIMULATE_MISSING_TS_MORPH: '1', ...env } },
  );
}

export async function run() {
  const results = [];
  const dir = mkdtempSync(resolve(tmpdir(), 'dod-failclosed-'));
  try {
    const ci = runCli({ CI: 'true', DOD_REQUIRE_AST: '' }, dir);
    results.push({
      name: 'CI run without ts-morph exits 2',
      ok: ci.status === 2 && /AST analysis is required/.test(ci.stderr),
      message: `exit=${ci.status} stderr=${ci.stderr.slice(0, 200)}`,
    });

    const forced = runCli({ CI: '', DOD_REQUIRE_AST: '1' }, dir);
    results.push({
      name: 'DOD_REQUIRE_AST=1 without ts-morph exits 2',
      ok: forced.status === 2,
      message: `exit=${forced.status}`,
    });

    const local = runCli({ CI: '', DOD_REQUIRE_AST: '0' }, dir);
    results.push({
      name: 'explicit local degradation warns instead of crashing',
      ok: local.status !== 2 && /falling back to regex/.test(local.stderr),
      message: `exit=${local.status} stderr=${local.stderr.slice(0, 200)}`,
    });

    results.push({
      name: 'isAstRequired honours CI and explicit overrides',
      ok:
        isAstRequired({ CI: 'true' }) === true &&
        isAstRequired({ CI: 'true', DOD_REQUIRE_AST: '0' }) === false &&
        isAstRequired({ DOD_REQUIRE_AST: '1' }) === true &&
        isAstRequired({}) === false,
    });

    let threw = false;
    try {
      // A directory path is unreadable as a file regardless of uid (EISDIR).
      await safeReadFile(dir);
    } catch (err) {
      threw = /cannot read/.test(err.message);
    }
    results.push({ name: 'unreadable file throws instead of returning ""', ok: threw });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}
