/**
 * Track results (CONVENTIONS section 3.2): results.json + results.md with
 * counts of cases run, passed, failed, skipped (with why), pending-fix and
 * coverage lines.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRootFromHere } from '../repo.js';

import { loadPendingFixes } from './pending.js';

export type Outcome = 'pass' | 'fail' | 'skip' | 'pending-fix' | 'fixed-pending-restore';

export interface CaseResult {
  caseId: string;
  outcome: Outcome;
  reason?: string;
  detail?: string;
  finding?: string;
}

export interface ResultsSummary {
  track: string;
  generatedAt: string;
  counts: Record<Outcome, number> & { run: number };
  coverage: Array<{ label: string; covered: number; total: number }>;
  cases: CaseResult[];
}

export function outcomeFor(passed: boolean | 'skip', pendingFinding?: string): Outcome {
  if (passed === 'skip') return 'skip';
  if (pendingFinding) return passed ? 'fixed-pending-restore' : 'pending-fix';
  return passed ? 'pass' : 'fail';
}

export class ResultsRecorder {
  private readonly cases = new Map<string, CaseResult>();
  private readonly cov: Array<{ label: string; covered: number; total: number }> = [];
  private readonly pending: ReadonlyMap<string, string>;

  constructor(
    private readonly outDir: string,
    private readonly track: string,
    o: { trackDir?: string; pending?: ReadonlyMap<string, string> } = {},
  ) {
    this.pending =
      o.pending ??
      loadPendingFixes(o.trackDir ?? join(repoRootFromHere(), 'tools/aitest/src/tracks', track));
  }

  record(
    caseId: string,
    passed: boolean | 'skip',
    meta: { reason?: string; detail?: string } = {},
  ): Outcome {
    if (this.cases.has(caseId)) throw new Error(`case ${caseId} recorded twice`);
    if (passed === 'skip' && !meta.reason) throw new Error(`skipped case ${caseId} needs a reason`);
    const finding = this.pending.get(caseId);
    const outcome = outcomeFor(passed, finding);
    this.cases.set(caseId, {
      caseId,
      outcome,
      ...(meta.reason ? { reason: meta.reason } : {}),
      ...(meta.detail ? { detail: meta.detail } : {}),
      ...(finding ? { finding } : {}),
    });
    return outcome;
  }

  coverage(label: string, covered: number, total: number): void {
    this.cov.push({ label, covered, total });
  }

  summary(): ResultsSummary {
    const counts = {
      run: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      'pending-fix': 0,
      'fixed-pending-restore': 0,
    };
    for (const c of this.cases.values()) {
      counts[c.outcome]++;
      if (c.outcome !== 'skip') counts.run++;
    }
    return {
      track: this.track,
      generatedAt: new Date().toISOString(),
      counts,
      coverage: this.cov,
      cases: [...this.cases.values()],
    };
  }

  /** Failures that should fail the job: real fails only (pending-fix does not). */
  failures(): CaseResult[] {
    return [...this.cases.values()].filter((c) => c.outcome === 'fail');
  }

  write(): { json: string; md: string } {
    mkdirSync(this.outDir, { recursive: true });
    const s = this.summary();
    const json = join(this.outDir, 'results.json');
    const md = join(this.outDir, 'results.md');
    writeFileSync(json, `${JSON.stringify(s, null, 2)}\n`);
    writeFileSync(md, renderResultsMd(s));
    return { json, md };
  }
}

const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderResultsMd(s: ResultsSummary): string {
  const c = s.counts;
  const lines = [
    `# Results: ${s.track}`,
    '',
    `Generated ${s.generatedAt}.`,
    '',
    '| Run | Passed | Failed | Skipped | Pending fix | Fixed, pending restore |',
    '|---|---|---|---|---|---|',
    `| ${c.run} | ${c.pass} | ${c.fail} | ${c.skip} | ${c['pending-fix']} | ${c['fixed-pending-restore']} |`,
    '',
  ];
  if (s.coverage.length > 0) {
    lines.push('## Coverage', '', '| Area | Covered | Total | % |', '|---|---|---|---|');
    for (const x of s.coverage) {
      const pct = x.total > 0 ? ((100 * x.covered) / x.total).toFixed(1) : 'n/a';
      lines.push(`| ${cell(x.label)} | ${x.covered} | ${x.total} | ${pct} |`);
    }
    lines.push('');
  }
  const notable = s.cases.filter((x) => x.outcome !== 'pass');
  if (notable.length > 0) {
    lines.push(
      '## Cases not passing',
      '',
      '| Case | Outcome | Finding | Reason / detail |',
      '|---|---|---|---|',
    );
    for (const x of notable) {
      lines.push(
        `| ${cell(x.caseId)} | ${x.outcome} | ${x.finding ?? ''} | ${cell(x.reason ?? x.detail ?? '')} |`,
      );
    }
    lines.push('');
  }
  lines.push('## All cases', '', '| Case | Outcome | Detail |', '|---|---|---|');
  for (const x of s.cases)
    lines.push(`| ${cell(x.caseId)} | ${x.outcome} | ${cell(x.detail ?? x.reason ?? '')} |`);
  return `${lines.join('\n')}\n`;
}
