#!/usr/bin/env node
/**
 * NEW-g3_infra_tools-003 — tests for release image-tag sanitisation + the
 * release.yml workflow contract. These assert against the REAL workflow file
 * so a regression (reverting to the raw head-branch tag) fails CI.
 *
 * Run with: node --test tools/scripts/release-image-tag.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateReleaseTagContract,
  isValidOciTag,
  sanitiseImageTag,
} from './release-image-tag.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const releaseWorkflowPath = join(here, '..', '..', '.github', 'workflows', 'release.yml');

test('release/** branch produces an INVALID raw OCI tag (the bug)', () => {
  // This is the concrete regression surface: a raw release/** branch name is
  // not a legal Docker tag, so push + cosign would fail.
  assert.equal(isValidOciTag('release/1.0'), false);
  assert.equal(isValidOciTag('release/2026.q1'), false);
});

test('sanitiseImageTag turns release/** branches into valid OCI tags', () => {
  const cases = [
    ['release/1.0', 'release-1.0'],
    ['release/2026.q1', 'release-2026.q1'],
    ['feature/foo/bar', 'feature-foo-bar'],
    ['main', 'main'],
    ['develop', 'develop'],
  ];
  for (const [branch, expected] of cases) {
    const tag = sanitiseImageTag(branch);
    assert.equal(tag, expected, `sanitise(${branch})`);
    assert.ok(isValidOciTag(tag), `sanitised tag "${tag}" must be a valid OCI tag`);
  }
});

test('sanitiseImageTag strips leading separators and caps length', () => {
  assert.equal(sanitiseImageTag('/release/x'), 'release-x');
  assert.equal(sanitiseImageTag('.hidden'), 'hidden');
  const long = 'a'.repeat(200);
  assert.equal(sanitiseImageTag(long).length, 128);
  assert.ok(isValidOciTag(sanitiseImageTag(long)));
});

test('release.yml feeds a sanitised branch tag to docker/metadata-action', () => {
  const yaml = readFileSync(releaseWorkflowPath, 'utf8');
  const { ok, violations } = evaluateReleaseTagContract(yaml);
  assert.ok(ok, `release.yml tag contract violated:\n- ${violations.join('\n- ')}`);
});

test('release.yml still includes the release/** trigger (bug precondition)', () => {
  const yaml = readFileSync(releaseWorkflowPath, 'utf8');
  // The branch filter deliberately includes release/**; the sanitiser is what
  // makes those branches safe to tag/sign.
  assert.match(yaml, /release\/\*\*/);
});
