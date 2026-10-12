#!/usr/bin/env node
/**
 * PRC-L109 — tests for the release.yml image-tag sanitiser + contract.
 * Run with: node --test tools/scripts/check-release-image-tag.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isValidDockerTag,
  releaseTagViolations,
  sanitizeBranchTag,
} from './check-release-image-tag.mjs';
import { loadWorkflow } from './check-workflow-step-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const base = loadWorkflow(read('.github/workflows/release.yml'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('sanitizeBranchTag turns release/1.0 into a valid tag', () => {
  const tag = sanitizeBranchTag('release/1.0');
  assert.equal(tag, 'release-1.0');
  assert.ok(isValidDockerTag(tag), 'sanitised tag must be a valid Docker tag');
});

test('sanitizeBranchTag leaves plain branches untouched and strips leading separators', () => {
  assert.equal(sanitizeBranchTag('main'), 'main');
  assert.equal(sanitizeBranchTag('develop'), 'develop');
  assert.equal(sanitizeBranchTag('feature/foo/bar'), 'feature-foo-bar');
  assert.equal(sanitizeBranchTag('/leading/slash'), 'leading-slash');
  assert.ok(isValidDockerTag(sanitizeBranchTag('user/fix#42@weird')));
});

test('raw release/** branch name is NOT a valid Docker tag (regression guard)', () => {
  assert.equal(isValidDockerTag('release/1.0'), false);
});

test('on-disk release.yml satisfies the image-tag contract', () => {
  assert.deepEqual(releaseTagViolations(base), []);
});

test('using the raw head-branch for the image tag fails the contract', () => {
  const wf = clone(base);
  for (const job of Object.values(wf.jobs)) {
    for (const step of job.steps ?? []) {
      if (step && /docker\/metadata-action/.test(String(step.uses ?? ''))) {
        step.with.tags = step.with.tags.replace(/head-branch-tag/g, 'head-branch');
      }
    }
  }
  assert.match(releaseTagViolations(wf).join('\n'), /raw head-branch|must include the sanitised/);
});

test('dropping the head-branch-tag output fails the contract', () => {
  const wf = clone(base);
  delete wf.jobs['ci-gate'].outputs['head-branch-tag'];
  assert.match(releaseTagViolations(wf).join('\n'), /head-branch-tag output/);
});
