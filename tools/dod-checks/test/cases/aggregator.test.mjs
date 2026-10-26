/**
 * Smoke test for the aggregator: verify that running it against a small
 * fixture directory produces a structured report with the expected shape.
 *
 * We run the aggregator out-of-process so this also serves as a CLI test.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExitCode } from '../../src/lib/baseline-gate.mjs';

export const title = 'aggregator: end-to-end CLI smoke';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../bin/dod-check.mjs');
const repoBaseline = resolve(here, '../../reports/baseline.json');

export async function run() {
  const results = [];
  const dir = mkdtempSync(resolve(tmpdir(), 'dod-aggregator-'));
  try {
    const reportPath = resolve(dir, 'report.json');
    const proc = spawnSync(
      process.execPath,
      [cli, '--only=table-naming', `--report=${reportPath}`],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
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
      ok:
        Array.isArray(json.checks) &&
        json.checks.length === 1 &&
        json.checks[0].check === 'table-naming',
    });
    results.push({
      name: 'report has totals object',
      ok: json.totals && typeof json.totals.totalErrors === 'number',
    });

    // PR #579: a baselined error entry must say why the debt is tolerated.
    const debt = {
      check: 'table-naming',
      severity: 'error',
      file: 'packages/database/prisma/schema.prisma',
      line: 1,
      message: 'fixture debt entry',
    };
    const gate = (finding) => {
      const baselinePath = resolve(dir, 'baseline.json');
      writeFileSync(
        baselinePath,
        JSON.stringify({
          schemaVersion: 1,
          totals: { totalErrors: 1, totalWarnings: 0, totalFiles: 0 },
          checks: [{ check: 'table-naming', errorCount: 1, warningCount: 0, findings: [finding] }],
        }),
      );
      return spawnSync(
        process.execPath,
        [cli, '--only=table-naming', `--report=${reportPath}`, `--baseline=${baselinePath}`],
        { cwd: dir, encoding: 'utf8' },
      );
    };
    const noReason = gate(debt);
    results.push({
      name: 'PR #579: baseline error entry without a reason fails the gate',
      ok: noReason.status === 1 && /baseline entry has no reason/.test(noReason.stdout),
      message: `exit=${noReason.status} stdout=${noReason.stdout.slice(-300)}`,
    });
    const placeholder = gate({ ...debt, reason: 'debt' });
    results.push({
      name: 'PR #579: placeholder reason shorter than the minimum fails the gate',
      ok: placeholder.status === 1,
      message: `exit=${placeholder.status}`,
    });
    const withReason = gate({
      ...debt,
      reason: 'fixture: tolerated pre-existing debt with a ticketed follow-up',
    });
    results.push({
      name: 'PR #579: baseline error entry with a reason passes',
      ok: withReason.status === 0,
      message: `exit=${withReason.status} stdout=${withReason.stdout.slice(-300)}`,
    });

    // PRC-M551: a missing baseline fails closed instead of passing.
    const missing = spawnSync(
      process.execPath,
      [
        cli,
        '--only=table-naming',
        `--report=${reportPath}`,
        `--baseline=${resolve(dir, 'absent.json')}`,
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    results.push({
      name: 'PRC-M551: missing baseline exits 2',
      ok: missing.status === 2 && /baseline missing/.test(missing.stderr),
      message: `exit=${missing.status} stderr=${missing.stderr.slice(-300)}`,
    });

    // PRC-M551: --update-baseline must not pass when it absorbs error debt
    // without a reason. api-schema has baselined (reasoned) errors in the repo.
    const update = (baselinePath) =>
      spawnSync(
        process.execPath,
        [
          cli,
          '--only=api-schema',
          `--report=${reportPath}`,
          `--baseline=${baselinePath}`,
          '--update-baseline',
        ],
        { cwd: dir, encoding: 'utf8' },
      );
    const repoApiSchemaErrors =
      JSON.parse(readFileSync(repoBaseline, 'utf8')).checks.find((c) => c.check === 'api-schema')
        ?.errorCount ?? 0;
    results.push({
      name: 'PRC-M551: fixture precondition — repo baseline has api-schema error debt',
      ok: repoApiSchemaErrors > 0,
      message: `api-schema baseline errors=${repoApiSchemaErrors}`,
    });
    const fresh = update(resolve(dir, 'new-baseline.json'));
    results.push({
      name: 'PRC-M551: --update-baseline with unreasoned new error debt exits 1',
      ok: fresh.status === 1 && /without a reason/.test(fresh.stderr),
      message: `exit=${fresh.status} stderr=${fresh.stderr.slice(-300)}`,
    });
    const carriedPath = resolve(dir, 'carried.json');
    copyFileSync(repoBaseline, carriedPath);
    const carried = update(carriedPath);
    results.push({
      name: 'PRC-M551: --update-baseline with every error reasoned exits 0',
      ok: carried.status === 0,
      message: `exit=${carried.status} stderr=${carried.stderr.slice(-300)}`,
    });

    // PRC-M551: exit-code decision matrix.
    const totals = (totalErrors, totalWarnings = 0) => ({ totalErrors, totalWarnings });
    const base = {
      noBaseline: false,
      updateBaseline: false,
      strict: false,
      totals: totals(0),
      comparison: { ok: true },
      baselineMissing: false,
      unreasonedAfterUpdate: 0,
    };
    const matrix = [
      ['missing baseline', { baselineMissing: true, comparison: null }, 2],
      ['update absorbing unreasoned errors', { updateBaseline: true, unreasonedAfterUpdate: 3 }, 1],
      ['update fully reasoned', { updateBaseline: true, totals: totals(5) }, 0],
      ['within baseline', { totals: totals(5) }, 0],
      ['regression beyond baseline', { comparison: { ok: false } }, 1],
      ['--no-baseline with errors', { noBaseline: true, totals: totals(1), comparison: null }, 1],
      ['--no-baseline clean', { noBaseline: true, comparison: null }, 0],
      [
        '--no-baseline --strict with warnings',
        { noBaseline: true, strict: true, totals: totals(0, 1), comparison: null },
        1,
      ],
    ];
    for (const [label, overrides, expected] of matrix) {
      const got = resolveExitCode({ ...base, ...overrides });
      results.push({
        name: `PRC-M551: resolveExitCode — ${label} → ${expected}`,
        ok: got === expected,
        message: `got ${got}`,
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}
