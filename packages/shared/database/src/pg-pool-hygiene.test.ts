/**
 * W3-D3 — guard against reintroducing unbounded node-pg pools in runtime code.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

const SCAN_ROOTS = ['packages', 'apps', 'workers'].map((dir) => join(REPO_ROOT, dir));

const ALLOWLIST = new Set([
  'packages/shared/database/src/pg-pool.ts',
  'apps/api-gateway/src/plugins/health.ts',
]);

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      collectTsFiles(full, out);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.live.test.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('W3-D3 shared pg pool hygiene', () => {
  it('runtime code does not construct bare connectionString-only pools', () => {
    const offenders: string[] = [];
    const pattern = /new\s+Pool\s*\(\s*\{\s*connectionString:/;

    for (const root of SCAN_ROOTS) {
      for (const file of collectTsFiles(root)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (ALLOWLIST.has(rel)) continue;
        const source = readFileSync(file, 'utf8');
        if (pattern.test(source)) offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
