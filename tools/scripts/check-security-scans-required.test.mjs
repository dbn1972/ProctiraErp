/**
 * PRC-L387 — check-security-scans-required.sh must pass on the committed
 * workflows and fail when any part of the scanner contract is violated
 * (soft-pass step, missing scanner, aggregate unwired).
 *
 * The script derives ROOT from its own location, so each case runs a copy in a
 * temp mirror of the repo with the relevant files mutated. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCANS = '.github/workflows/security-scans.yml';
const CI = '.github/workflows/ci.yml';
const AGG = 'tools/scripts/ci-aggregate-gate.mjs';

function runInMirror(mutate = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'l387-scans-'));
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    mkdirSync(join(dir, 'tools/scripts'), { recursive: true });
    // Helpers the script may shell out to (e.g. step-contract checker) + deps.
    for (const name of readdirSync(join(ROOT, 'tools/scripts'))) {
      if (name.endsWith('.mjs') || name === 'check-security-scans-required.sh') {
        copyFileSync(join(ROOT, 'tools/scripts', name), join(dir, 'tools/scripts', name));
      }
    }
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    for (const rel of [SCANS, CI, AGG]) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      writeFileSync(join(dir, rel), mutate[rel] ? mutate[rel](text) : text);
    }
    return spawnSync('bash', [join(dir, 'tools/scripts/check-security-scans-required.sh')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function replaceOnce(text, from, to) {
  assert.ok(text.includes(from), `fixture precondition: ${from}`);
  return text.replace(from, to);
}

test('committed workflows satisfy the scanner contract', () => {
  const r = runInMirror();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-security-scans-required: PASS/);
});

test('a soft-pass scanner step (continue-on-error: true) fails', () => {
  const r = runInMirror({
    [SCANS]: (t) => replaceOnce(t, 'continue-on-error: false', 'continue-on-error: true'),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /continue-on-error|not all fail-closed/);
});

test('a missing scanner job fails', () => {
  const r = runInMirror({ [SCANS]: (t) => t.replace(/^(\s*)iac-trivy:/m, '$1iac-removed:') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing job iac-trivy/);
});

test('secret scan without gitleaks detect fails', () => {
  const r = runInMirror({ [SCANS]: (t) => t.replaceAll('gitleaks detect', 'gitleaks version') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gitleaks/);
});

test('ci-aggregate not depending on security-scans fails', () => {
  const r = runInMirror({
    [CI]: (t) => t.replace(/^(\s*)- security-scans$/m, '$1- security-scans-dropped'),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ci-aggregate needs must include security-scans/);
});

test('aggregate gate making security-scans conditional fails', () => {
  const r = runInMirror({
    [AGG]: (t) =>
      t.replace(
        /(job:\s*'security-scans'[\s\S]*?requiredWhen:\s*)\(\)\s*=>\s*true/,
        '$1(c) => c.packagesChanged',
      ),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requiredWhen: \(\) => true/);
});
