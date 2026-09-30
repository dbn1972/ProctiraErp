#!/usr/bin/env node
/**
 * PRC-L177 — tools/scripts must not self-declare ledger status.
 *
 * Code comments, output strings, and README rows reference ledger IDs only
 * (e.g. `W1-DATA-11`). Status (FULLY_CLOSED / PARTIAL / OPEN / …) lives in the
 * tip-verified audit ledger, never in the script that is being audited.
 *
 * Audit-document *filenames* (`*_COMPLETE.md`) and doc-content fixtures that
 * model those audit files are not status claims and are allowlisted below.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Files whose COMPLETE tokens model audit-document content (fixtures), not claims. */
const DOC_FIXTURE_ALLOWLIST = new Set([
  'check-migration-timeouts.test.mjs',
  'check-runtime-role-gate.test.mjs',
  'no-completion-claims.test.mjs',
]);

/** Ledger-ID status claims: `W1-DATA-11 COMPLETE`, `G-718 COMPLETE`, `(COMPLETE)`. */
export const CLAIM_PATTERNS = [
  /\b(?:W\d+-[A-Z]+-\d+|G-\d+|PRC-[A-Z]?\d+)\s+COMPLETE\b/,
  /\(COMPLETE\b/,
];

/**
 * @param {string} text
 * @returns {string[]} offending lines
 */
export function findCompletionClaims(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => CLAIM_PATTERNS.some((re) => re.test(line)))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(mjs|js|ts|sh|md|json|py)$/.test(name)) out.push(full);
  }
  return out;
}

test('findCompletionClaims flags ledger status claims', () => {
  assert.equal(findCompletionClaims('# W1-DATA-11 COMPLETE — sync').length, 1);
  assert.equal(findCompletionClaims('-- generated (W1-DATA-11 COMPLETE)').length, 1);
  assert.equal(findCompletionClaims('drift gate (COMPLETE / fail closed)').length, 1);
  assert.equal(findCompletionClaims("AUDIT='docs/audits/OPS_W1_OPS_04_COMPLETE.md'").length, 0);
  assert.equal(findCompletionClaims('# W1-DATA-11 — sync').length, 0);
});

test('tools/scripts contains no self-declared COMPLETE status claims', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of walk(SCRIPTS_DIR)) {
    const rel = relative(SCRIPTS_DIR, file);
    if (DOC_FIXTURE_ALLOWLIST.has(rel)) continue;
    for (const hit of findCompletionClaims(readFileSync(file, 'utf8'))) {
      offenders.push(`${rel}:${hit}`);
    }
  }
  assert.deepEqual(offenders, [], `status claims found:\n${offenders.join('\n')}`);
});
