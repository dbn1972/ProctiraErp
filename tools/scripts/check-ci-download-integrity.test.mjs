/**
 * PRC-L308 — CI downloads must be checksum- or fingerprint-verified.
 * Run with: node --test tools/scripts/check-ci-download-integrity.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkWorkflow, envLiterals, runBlocks } from './check-ci-download-integrity.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-ci-download-integrity.mjs');
const SHA = 'a'.repeat(64);
const FPR = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';

const wf = (envBlock, run) => `name: X
env:
${envBlock}
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - name: Install
        run: |
${run
  .split('\n')
  .map((l) => `          ${l}`)
  .join('\n')}
      - name: Next
        run: echo done
`;

test('base shape: curl | tar with no digest fails', () => {
  const text = wf(
    "  TOOL_VERSION: '1.0'",
    'curl -fsSL "https://github.com/o/t/releases/download/v${TOOL_VERSION}/t.tar.gz" \\\n  | tar xz -C /tmp t',
  );
  const errors = checkWorkflow('x.yml', text);
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /piped straight into an unpacker/);
  assert.match(errors.join('\n'), /without sha256sum -c/);
});

test('download to file + sha256sum -c against a committed env literal passes', () => {
  const text = wf(
    `  TOOL_SHA256: ${SHA}`,
    'curl -fsSL -o /tmp/t.tgz \\\n  "https://github.com/o/t/releases/download/v1/t.tar.gz"\necho "${TOOL_SHA256}  /tmp/t.tgz" | sha256sum -c -\ntar xzf /tmp/t.tgz',
  );
  assert.deepEqual(checkWorkflow('x.yml', text), []);
});

test('sha256sum against a non-literal or missing env value fails', () => {
  const run =
    'curl -fsSL -o /tmp/t.tgz https://github.com/o/t/releases/download/v1/t.tar.gz\necho "${TOOL_SHA256}  /tmp/t.tgz" | sha256sum -c -';
  assert.equal(checkWorkflow('x.yml', wf('  TOOL_SHA256: ${{ vars.SHA }}', run)).length, 1);
  assert.equal(checkWorkflow('x.yml', wf("  OTHER: '1'", run)).length, 1);
});

test('key download needs a pinned fingerprint check', () => {
  const bad = wf(
    "  X: '1'",
    'sudo curl -fsSL -o /etc/k.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc',
  );
  assert.match(checkWorkflow('r.yml', bad).join('\n'), /without a pinned \*_FINGERPRINT check/);
  const good = wf(
    `  PGDG_KEY_FINGERPRINT: ${FPR}`,
    'curl -fsSL -o /tmp/k.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc\nF="$(gpg --show-keys --with-colons /tmp/k.asc | awk -F: \'/^fpr:/ {print $10}\')"\n[ "$F" = "${PGDG_KEY_FINGERPRINT}" ]',
  );
  assert.deepEqual(checkWorkflow('r.yml', good), []);
});

test('non-artifact curl (health probes) is out of scope', () => {
  assert.deepEqual(
    checkWorkflow('h.yml', wf("  X: '1'", 'curl -fsS "$BASE/login" -o /dev/null')),
    [],
  );
});

test('helpers: run blocks and env literals', () => {
  const text = wf(`  TOOL_SHA256: ${SHA}\n  K_FINGERPRINT: ${FPR}`, 'echo hi');
  assert.equal(runBlocks(text).length, 2);
  const { sha, fpr } = envLiterals(text);
  assert.equal(sha.get('TOOL_SHA256'), SHA);
  assert.equal(fpr.get('K_FINGERPRINT'), FPR);
});

test('repository workflows pass', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
