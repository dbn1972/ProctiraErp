/**
 * PRC-L467: trace-graph.mjs must default to this repository (derived from the
 * script location), not a hard-coded machine path, when run without args.
 *
 * Run: node --test docs/multitenant/trace-graph.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'trace-graph.mjs');

test('runs against the repo it lives in when no root is given', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'trace-graph-'));
  try {
    const proc = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    assert.equal(proc.status, 0, `exit=${proc.status} stderr=${proc.stderr.slice(0, 400)}`);
    const summaryPath = join(cwd, 'graph', 'summary.json');
    assert.ok(existsSync(summaryPath), 'graph/summary.json is written under cwd');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.ok(summary.pages > 0, `pages=${summary.pages}`);
    assert.ok(summary.routeHandlers > 0, `routeHandlers=${summary.routeHandlers}`);
    assert.ok(summary.tables > 0, `tables=${summary.tables}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('documents its own location in the usage line', () => {
  const src = readFileSync(script, 'utf8');
  assert.match(src, /Usage: node docs\/multitenant\/trace-graph\.mjs/);
  assert.doesNotMatch(src, /\/home\/claude\//);
});
