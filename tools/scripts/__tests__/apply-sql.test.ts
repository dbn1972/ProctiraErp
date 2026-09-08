/**
 * Smoke test for tools/scripts/apply-sql.sh (gap G-002).
 * Verifies --dry-run lists numbered db/sql files in schema-before-seed order.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const scriptPath = resolve(here, '..', 'apply-sql.sh');
const sqlDir = resolve(repoRoot, 'db/sql');

function dryRun(): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', [scriptPath, '--dry-run'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('apply-sql.sh', () => {
  it('dry-run lists expected numbered SQL files in LC_ALL=C order', () => {
    const expected = readdirSync(sqlDir)
      .filter((name) => /^[0-9].*\.sql$/.test(name))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // JS default is code-unit / C-like

    expect(expected.length).toBeGreaterThanOrEqual(14);
    expect(expected.some((n) => n.startsWith('001_'))).toBe(true);
    expect(expected.some((n) => n.startsWith('014_'))).toBe(true);

    // Schema must precede colocated *b* seed for the same number prefix.
    const idx006 = expected.indexOf('006_transport_schema.sql');
    const idx006b = expected.indexOf('006b_transport_seed.sql');
    expect(idx006).toBeGreaterThanOrEqual(0);
    expect(idx006b).toBeGreaterThanOrEqual(0);
    expect(idx006).toBeLessThan(idx006b);

    const { status, stdout, stderr } = dryRun();
    expect(status, stderr).toBe(0);
    expect(stdout).toMatch(/Dry run only/);

    for (const name of expected) {
      expect(stdout).toContain(`db/sql/${name}`);
    }

    const listed = [...stdout.matchAll(/^\s*-\s*(db\/sql\/[^\s]+)/gm)].map((m) => m[1]);
    expect(listed).toEqual(expected.map((n) => `db/sql/${n}`));
  });
});
