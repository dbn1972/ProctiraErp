/**
 * Reporter primitives shared by every check. A check builds a `Report` object
 * by appending `Finding`s; the aggregator merges all reports into a single
 * machine-readable JSON file plus a colorized human summary.
 *
 * Finding shape:
 *   {
 *     check: string,        // CHECK_IDS.* value
 *     severity: 'error' | 'warning',
 *     file: string,         // repo-relative path
 *     line: number | null,
 *     message: string,
 *     suggestion?: string,
 *     ruleRef?: string,     // e.g. "Charter §32"
 *   }
 */
import { SEVERITY } from './constants.mjs';
import { toRepoRelative } from './paths.mjs';

export class Report {
  constructor(checkId, title) {
    this.checkId = checkId;
    this.title = title;
    /** @type {Array<object>} */
    this.findings = [];
    this.filesScanned = 0;
    this.startedAt = Date.now();
    this.finishedAt = null;
  }

  addError(file, message, opts = {}) {
    this.findings.push({
      check: this.checkId,
      severity: SEVERITY.ERROR,
      file: file ? toRepoRelative(file) : null,
      line: opts.line ?? null,
      column: opts.column ?? null,
      message,
      suggestion: opts.suggestion,
      ruleRef: opts.ruleRef ?? 'Charter §32',
    });
  }

  addWarning(file, message, opts = {}) {
    this.findings.push({
      check: this.checkId,
      severity: SEVERITY.WARNING,
      file: file ? toRepoRelative(file) : null,
      line: opts.line ?? null,
      column: opts.column ?? null,
      message,
      suggestion: opts.suggestion,
      ruleRef: opts.ruleRef ?? 'Charter §32',
    });
  }

  finish() {
    this.finishedAt = Date.now();
    return this;
  }

  get errorCount() {
    return this.findings.filter((f) => f.severity === SEVERITY.ERROR).length;
  }

  get warningCount() {
    return this.findings.filter((f) => f.severity === SEVERITY.WARNING).length;
  }

  toJSON() {
    return {
      check: this.checkId,
      title: this.title,
      filesScanned: this.filesScanned,
      durationMs: (this.finishedAt ?? Date.now()) - this.startedAt,
      errorCount: this.errorCount,
      warningCount: this.warningCount,
      findings: this.findings,
    };
  }
}

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const supportsColor = process.stdout && process.stdout.isTTY && !process.env.NO_COLOR;
const c = (color, s) => (supportsColor ? `${color}${s}${RESET}` : s);

/** Print a single check report in human-readable form. */
export function printReport(report) {
  const header = `📋 [${report.checkId}] ${report.title}`;
  console.log(`\n${c(CYAN, header)}`);
  if (report.findings.length === 0) {
    console.log(
      `   ${c(GREEN, '✅ pass')} ${c(DIM, `(${report.filesScanned} files scanned in ${report.toJSON().durationMs}ms)`)}`,
    );
    return;
  }
  for (const f of report.findings) {
    const tag = f.severity === SEVERITY.ERROR ? c(RED, '❌') : c(YELLOW, '⚠️ ');
    const loc = f.line ? `:${f.line}${f.column ? `:${f.column}` : ''}` : '';
    const suffix = f.suggestion ? `\n      ${c(DIM, '↪ ' + f.suggestion)}` : '';
    console.log(`   ${tag} ${f.file ?? ''}${loc} — ${f.message}${suffix}`);
  }
  console.log(
    c(DIM, `   (${report.errorCount} error(s), ${report.warningCount} warning(s), ${report.filesScanned} files scanned)`),
  );
}

/** Print a summary line for the aggregator output. */
export function printSummary(reports) {
  const totalErrors = reports.reduce((s, r) => s + r.errorCount, 0);
  const totalWarnings = reports.reduce((s, r) => s + r.warningCount, 0);
  const totalFiles = reports.reduce((s, r) => s + r.filesScanned, 0);

  console.log('\n' + '═'.repeat(70));
  console.log(' Definition-of-Done Summary');
  console.log('═'.repeat(70));
  for (const r of reports) {
    const status =
      r.errorCount > 0
        ? c(RED, 'FAIL')
        : r.warningCount > 0
          ? c(YELLOW, 'WARN')
          : c(GREEN, 'PASS');
    console.log(
      ` ${status}  ${r.checkId.padEnd(22)} errors=${String(r.errorCount).padStart(3)}  warnings=${String(r.warningCount).padStart(3)}  files=${r.filesScanned}`,
    );
  }
  console.log('─'.repeat(70));
  console.log(` Totals: ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalFiles} files scanned`);
  console.log('═'.repeat(70));
  return { totalErrors, totalWarnings, totalFiles };
}

export const colors = { c, RED, YELLOW, GREEN, CYAN, DIM, RESET };
