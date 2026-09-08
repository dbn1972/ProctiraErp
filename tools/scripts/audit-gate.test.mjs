#!/usr/bin/env node
/**
 * Unit tests for the supply-chain advisory gate (G-708).
 * Run with: node --test tools/scripts/audit-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { evaluate, loadAllowlist } from './audit-gate.mjs';

function advisory(ghsa, severity, module = 'pkg') {
  return {
    github_advisory_id: ghsa,
    severity,
    module_name: module,
    vulnerable_versions: '<1.0.0',
    patched_versions: '>=1.0.0',
    title: `${module} ${severity}`,
  };
}

function writeAllowlist(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  const path = join(dir, 'allowlist.json');
  writeFileSync(path, JSON.stringify({ entries }));
  return path;
}

test('unwaived high/critical advisories block; moderate/low do not', () => {
  const allowlist = loadAllowlist(writeAllowlist([]));
  const report = evaluate(
    {
      advisories: {
        1: advisory('GHSA-aaaa', 'high'),
        2: advisory('GHSA-bbbb', 'critical'),
        3: advisory('GHSA-cccc', 'moderate'),
        4: advisory('GHSA-dddd', 'low'),
      },
    },
    allowlist,
    'high',
  );
  assert.deepEqual(
    report.blocking.map((b) => b.ghsa).sort(),
    ['GHSA-aaaa', 'GHSA-bbbb'],
  );
  assert.equal(report.waived.length, 0);
  assert.equal(report.belowThreshold.length, 2);
});

test('an active waiver removes the advisory from blocking and records its justification', () => {
  const allowlist = loadAllowlist(
    writeAllowlist([
      { ghsa: 'GHSA-aaaa', reason: 'major upgrade pending', trackedBy: 'G-735', expires: '2999-01-01' },
    ]),
  );
  const report = evaluate({ advisories: { 1: advisory('GHSA-aaaa', 'high') } }, allowlist, 'high');
  assert.equal(report.blocking.length, 0);
  assert.equal(report.waived.length, 1);
  assert.equal(report.waived[0].trackedBy, 'G-735');
});

test('an expired waiver is reported and no longer suppresses the advisory', () => {
  const allowlist = loadAllowlist(
    writeAllowlist([
      { ghsa: 'GHSA-aaaa', reason: 'lapsed', trackedBy: 'G-735', expires: '2020-01-01' },
    ]),
    new Date('2026-09-08T00:00:00Z'),
  );
  assert.equal(allowlist.expired.length, 1);
  assert.equal(allowlist.active.size, 0);
  const report = evaluate({ advisories: { 1: advisory('GHSA-aaaa', 'high') } }, allowlist, 'high');
  assert.equal(report.blocking.length, 1);
});

test('waivers must carry a reason, owner gap and expiry', () => {
  assert.throws(
    () => loadAllowlist(writeAllowlist([{ ghsa: 'GHSA-aaaa', reason: 'x', expires: '2999-01-01' }])),
    /missing "trackedBy"/,
  );
  assert.throws(
    () => loadAllowlist(writeAllowlist([{ ghsa: 'GHSA-aaaa', reason: 'x', trackedBy: 'G-1', expires: 'never' }])),
    /invalid expires/,
  );
});

test('the committed allowlist is well-formed and has no expired entries', () => {
  const allowlist = loadAllowlist(
    new URL('../supply-chain/audit-allowlist.json', import.meta.url).pathname,
  );
  assert.equal(allowlist.expired.length, 0, `expired waivers: ${allowlist.expired.map((e) => e.ghsa).join(', ')}`);
  for (const entry of allowlist.active.values()) {
    assert.match(entry.trackedBy, /^G-\d+$/);
  }
});
