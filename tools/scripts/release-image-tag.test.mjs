/**
 * PRC-L109 — release image tags derived from branch names are valid OCI tags.
 * Run with: node --test tools/scripts/release-image-tag.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OCI_TAG_RE, toImageTag } from './release-image-tag.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'release-image-tag.mjs');
const RELEASE = readFileSync(join(HERE, '../../.github/workflows/release.yml'), 'utf8');

test('the raw release/** branch name is not a valid tag (base behaviour)', () => {
  assert.equal(OCI_TAG_RE.test('release/2026.10'), false);
});

test('release/2026.10 maps to release-2026.10', () => {
  assert.equal(toImageTag('release/2026.10'), 'release-2026.10');
});

test('main and develop are unchanged', () => {
  assert.equal(toImageTag('main'), 'main');
  assert.equal(toImageTag('develop'), 'develop');
});

test('leading dots/dashes are stripped and length is capped at 128', () => {
  assert.equal(toImageTag('-.release/x'), 'release-x');
  const long = toImageTag(`release/${'a'.repeat(200)}`);
  assert.equal(long.length, 128);
  assert.ok(OCI_TAG_RE.test(long));
});

test('names with no valid tag throw instead of reaching buildx', () => {
  assert.throws(() => toImageTag(''), /does not map to a valid image tag/);
  assert.throws(() => toImageTag('---'), /does not map to a valid image tag/);
});

test('CLI prints the tag and fails closed on invalid input', () => {
  const ok = spawnSync(process.execPath, [SCRIPT, 'release/2026.10'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), 'release-2026.10');
  const bad = spawnSync(process.execPath, [SCRIPT, '...'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

test('release.yml uses the sanitised image-tag output for the branch tag and version label', () => {
  assert.match(RELEASE, /type=raw,value=\$\{\{ needs\.ci-gate\.outputs\.image-tag \}\}/);
  assert.match(
    RELEASE,
    /org\.opencontainers\.image\.version=\$\{\{ needs\.ci-gate\.outputs\.image-tag \}\}/,
  );
  assert.doesNotMatch(RELEASE, /type=raw,value=\$\{\{ needs\.ci-gate\.outputs\.head-branch \}\}/);
  assert.match(RELEASE, /node tools\/scripts\/release-image-tag\.mjs "\$\{HEAD_BRANCH\}"/);
});
