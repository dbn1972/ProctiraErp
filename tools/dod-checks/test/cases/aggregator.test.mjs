/**
 * Smoke test for the aggregator: verify that running it against a small
 * fixture directory produces a structured report with the expected shape.
 *
 * We run the aggregator out-of-process so this also serves as a CLI test.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const title = 'aggregator: end-to-end CLI smoke';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../bin/dod-check.mjs');

export async function run() {
  const results = [];
  const dir = mkdtempSync(resolve(tmpdir(), 'dod-aggregator-'));
  try {
    const reportPath = resolve(dir, 'report.json');
    const proc = spawnSync(process.execPath, [cli, '--only=table-naming', `--report=${reportPath}`], {
      cwd: dir,
      encoding: 'utf8',
    });
    results.push({
      name: 'aggregator runs without crashing',
      ok: proc.status === 0 || proc.status === 1,
      message: `exit=${proc.status}, stderr=${proc.stderr.slice(0, 200)}`,
    });

    let json;
    try {
      json = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (err) {
      results.push({ name: 'JSON report is parseable', ok: false, message: err.message });
      return results;
    }

    results.push({
      name: 'report has schemaVersion = 1',
      ok: json.schemaVersion === 1,
      message: `got ${json.schemaVersion}`,
    });
    results.push({
      name: 'report contains the requested check',
      ok: Array.isArray(json.checks) && json.checks.length === 1 && json.checks[0].check === 'table-naming',
    });
    results.push({
      name: 'report has totals object',
      ok: json.totals && typeof json.totals.totalErrors === 'number',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}
