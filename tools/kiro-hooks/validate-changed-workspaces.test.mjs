/**
 * PRC-L506 — validate-changed-workspaces must not report a clean "passed"
 * when the local gate truncated the file/workspace set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalStatus } from './validate-changed-workspaces.mjs';

test('clean run reports passed with exit 0', () => {
  const r = finalStatus({ failed: false, truncated: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.line, /passed/);
  assert.doesNotMatch(r.line, /PARTIAL/);
});

test('truncated run reports PARTIAL and non-zero exit (>8 workspaces)', () => {
  const r = finalStatus({ failed: false, truncated: true });
  assert.equal(r.exitCode, 1);
  assert.match(r.line, /PARTIAL/);
  assert.doesNotMatch(r.line, /checks passed/);
});

test('failed run reports failure regardless of truncation', () => {
  const r = finalStatus({ failed: true, truncated: true });
  assert.equal(r.exitCode, 1);
  assert.match(r.line, /failed/);
});
