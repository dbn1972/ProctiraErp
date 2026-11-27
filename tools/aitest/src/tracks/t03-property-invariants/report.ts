/**
 * Turns domain reports into ResultsRecorder cases, coverage lines and a
 * candidate findings.csv (one row per violated invariant, with its shrunk
 * reproduction). Triage (severity, root cause, de-duplication) happens on top
 * of this file; the committed suite asserts only correct behaviour.
 */
import { FindingsWriter, type ResultsRecorder } from '../../foundation/index.js';

import { caseId, UNEXPECTED } from './core.js';
import type { DomainReport, DomainSpec, RealBase } from './runner.js';

export function summariseDomain<M extends object, R extends RealBase, C>(
  recorder: ResultsRecorder,
  spec: DomainSpec<M, R, C>,
  report: DomainReport,
  focused: boolean,
  pending: ReadonlyMap<string, string>,
): void {
  registerMeta(spec);
  const held = `held over ${report.runsCompleted} runs / ${report.commandsRun} commands (seed ${report.seed})`;
  const describe = (inv: string) => {
    const v = report.violations.get(inv)!;
    const ce = report.counterexamples.find((c) => c.invariant === inv);
    return `${v.count} violation(s); first: ${v.firstDetail}${ce ? `; shrunk: ${ce.commands.slice(0, 400)}; ${ce.reproduce}` : '; not reproduced in focus run'}`;
  };
  const perCommand = [...report.violations.keys()].filter((k) => k.startsWith(`${UNEXPECTED}:`));
  const unlisted = perCommand.filter((k) => !pending.has(caseId(spec.domain, k)));
  for (const inv of spec.invariants) {
    const id = caseId(spec.domain, inv.id);
    if (inv.id === UNEXPECTED) {
      if (focused && unlisted.length === 0) {
        recorder.record(id, 'skip', { reason: 'focused run of another case' });
      } else {
        recorder.record(id, unlisted.length === 0, {
          detail:
            unlisted.length === 0
              ? `${held}; known per-command cases: ${perCommand.join(' ') || 'none'}`
              : unlisted.map(describe).join(' | '),
        });
      }
      continue;
    }
    const v = report.violations.get(inv.id);
    if (focused && !v) {
      recorder.record(id, 'skip', { reason: 'focused run of another case' });
      continue;
    }
    recorder.record(id, v === undefined, { detail: v ? describe(inv.id) : held });
  }
  // Per-command crash cases: violated ones, and listed ones that held (fixed-pending-restore).
  const prefix = `prop:${spec.domain}:${UNEXPECTED}:`;
  const listed = [...pending.keys()]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(`prop:${spec.domain}:`.length));
  for (const inv of new Set([...perCommand, ...listed])) {
    const v = report.violations.get(inv);
    if (focused && !v) continue;
    recorder.record(caseId(spec.domain, inv), v === undefined, {
      detail: v ? describe(inv) : held,
    });
  }
  let run = 0;
  let accepted = 0;
  for (const [name, s] of report.stats.byCommand) {
    run += s.run;
    accepted += s.accepted;
    recorder.coverage(`${spec.domain}: ${name} accepted / run`, s.accepted, s.run);
  }
  recorder.coverage(`${spec.domain}: commands accepted / run (all)`, accepted, run);
  recorder.coverage(
    `${spec.domain}: property runs completed / requested`,
    report.runsCompleted,
    report.numRuns,
  );
}

const META = new Map<
  string,
  { module: string; title: string; severity: string; category: string }
>();

export function registerMeta<M extends object, R extends RealBase, C>(spec: DomainSpec<M, R, C>) {
  for (const i of spec.invariants) META.set(caseId(spec.domain, i.id), i);
}

/** Candidate findings for violated invariants (triaged into P/<unit>/findings.csv). */
export function writeFindings(outDir: string, reports: readonly DomainReport[]): string {
  const w = new FindingsWriter(outDir, '03');
  for (const r of reports) {
    for (const [inv, v] of r.violations) {
      const id = caseId(r.domain, inv);
      const meta = META.get(id);
      const ce = r.counterexamples.find((c) => c.invariant === inv);
      w.add({
        severity: (meta?.severity as 'high') ?? 'medium',
        category: (meta?.category as 'money') ?? 'other',
        module: meta?.module ?? r.domain,
        title: `${id}: ${meta?.title ?? inv}`,
        evidence: ce
          ? `${ce.file ?? ''}; ${ce.reproduce}`
          : `observed ${v.count}x (seed ${r.seed})`,
        expected: meta?.title ?? inv,
        actual: ce?.detail ?? v.firstDetail,
        patch: '',
        prc_match: '',
      });
    }
  }
  return w.write();
}
