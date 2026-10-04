/**
 * PRC-L377: pgloader execution and summary parsing.
 *
 * The binary is spawned with execFileSync (no shell), so PGLOADER_BIN is a
 * program path, never a command line. stdout is buffered up to 256 MiB (the
 * default 1 MiB hit ENOBUFS on large loads), and the summary table's `errors`
 * column is parsed so a run with rejected rows is reported as an error rather
 * than success.
 */
import { execFileSync } from 'node:child_process';

export const PGLOADER_MAX_BUFFER = 256 * 1024 * 1024;

export function execPgloader(bin: string, configPath: string, timeoutMs = 600_000): string {
  return execFileSync(bin, [configPath], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: PGLOADER_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface PgloaderSummary {
  /** False when no summary table could be found. */
  parsed: boolean;
  /** Sum of the `errors` column over every summary line. */
  errorCount: number;
  /** Summary lines (table or task names) with a non-zero error count. */
  failedEntries: { name: string; errors: number }[];
  /** Rows imported according to the summary total line (0 when absent). */
  rowsImported: number;
  /** Data lines in the summary (tables and load tasks). */
  entries: number;
}

const SEPARATOR_RE = /^[\s-]+$/;

/**
 * Parse pgloader's end-of-run summary:
 *
 *            table name     errors       rows      bytes      total time
 *   -----------------------  ---------  ---------  ---------  --------------
 *        "public"."users"          3       1200    112.0 kB          0.210s
 *   -----------------------  ---------  ---------  ---------  --------------
 *       Total import time          ✓       1200    112.0 kB          0.900s
 *
 * Newer releases use `read`/`imported` instead of `rows`; both are handled.
 */
export function parsePgloaderSummary(output: string): PgloaderSummary {
  const lines = output.split('\n');
  const headerIdx = lines.findIndex((l) => /\btable name\b/.test(l) && /\berrors\b/.test(l));
  const summary: PgloaderSummary = {
    parsed: false,
    errorCount: 0,
    failedEntries: [],
    rowsImported: 0,
    entries: 0,
  };
  if (headerIdx < 0) return summary;
  summary.parsed = true;

  const header = (lines[headerIdx] ?? '').trim().split(/\s{2,}/);
  const errorsCol = header.indexOf('errors');
  const rowsCol = header.includes('imported') ? header.indexOf('imported') : header.indexOf('rows');

  for (const raw of lines.slice(headerIdx + 1)) {
    const line = raw.trimEnd();
    if (line.trim() === '' || SEPARATOR_RE.test(line)) continue;
    const cells = line.trim().split(/\s{2,}/);
    if (cells.length <= errorsCol) continue;
    const name = cells[0] ?? '';
    const errorsCell = cells[errorsCol] ?? '';
    if (/^Total\b/i.test(name)) {
      const rows =
        rowsCol >= 0 ? Number.parseInt((cells[rowsCol] ?? '').replace(/,/g, ''), 10) : NaN;
      if (Number.isFinite(rows)) summary.rowsImported = rows;
      const totalErrors = Number.parseInt(errorsCell, 10);
      if (Number.isFinite(totalErrors) && totalErrors > summary.errorCount) {
        summary.failedEntries.push({ name, errors: totalErrors - summary.errorCount });
        summary.errorCount = totalErrors;
      }
      continue;
    }
    const errors = Number.parseInt(errorsCell, 10);
    if (!Number.isFinite(errors)) continue;
    summary.entries += 1;
    if (errors > 0) {
      summary.errorCount += errors;
      summary.failedEntries.push({ name, errors });
    }
  }
  return summary;
}
