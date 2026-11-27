/**
 * Property runner for t03: observe → focus → shrink.
 *
 * 1. Observe: `numRuns` random command sequences, each against a fresh random
 *    tenant on the live database. Every invariant is checked after every
 *    command; violations are only counted, so one defect does not hide others.
 * 2. Focus: each violated invariant is re-run with the same seed where only
 *    that invariant throws. fast-check shrinks the sequence to a minimal one.
 * 3. The shrunk sequence, seed, path and replay path are written to
 *    `<outDir>/counterexamples/<case>.json` with a one-line reproduction.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import {
  caseId,
  CommandStats,
  InvariantError,
  ViolationLog,
  type Domain,
  type InvariantMeta,
  type ViolationRecord,
} from './core.js';

export interface RealBase {
  log: ViolationLog;
  stats: CommandStats;
}

export interface DomainSpec<M extends object, R extends RealBase, C> {
  domain: Domain;
  invariants: readonly InvariantMeta[];
  commands: Array<fc.Arbitrary<fc.AsyncCommand<M, R, boolean>>>;
  config: fc.Arbitrary<C>;
  maxCommands: number;
  setup(log: ViolationLog, stats: CommandStats, config: C): Promise<{ model: M; real: R }>;
  /** Checks after the last command (reports, read models). */
  finalCheck?(model: M, real: R): Promise<void>;
  teardown?(real: R): Promise<void>;
}

export interface CounterExample {
  caseId: string;
  invariant: string;
  seed: number;
  path: string | null;
  replayPath: string | null;
  numRuns: number;
  shrunk: boolean;
  interrupted: boolean;
  commands: string;
  config: string;
  detail: string;
  reproduce: string;
  file?: string;
}

export interface DomainReport {
  domain: Domain;
  seed: number;
  numRuns: number;
  runsCompleted: number;
  commandsRun: number;
  violations: Map<string, ViolationRecord>;
  counterexamples: CounterExample[];
  stats: CommandStats;
  harnessError: string | null;
  ms: number;
}

export interface RunOptions {
  numRuns: number;
  seed: number;
  outDir: string;
  /** Focus/replay one case (`prop:<domain>:<invariant>`). */
  focus?: string;
  path?: string;
  replayPath?: string;
  /** Time budget per focused shrink. */
  shrinkMs?: number;
  /** Runs allowed in focus mode before giving up reproducing a violation. */
  focusRuns?: number;
}

const REPLAY_RE = /replayPath="([^"]*)"/;

export function reproduceLine(c: Pick<CounterExample, 'caseId' | 'seed' | 'path' | 'replayPath'>) {
  const env = [
    `AITEST_FOCUS=${c.caseId}`,
    `AITEST_SEED=${c.seed}`,
    c.path ? `AITEST_PATH=${c.path}` : '',
    c.replayPath ? `AITEST_REPLAY_PATH=${c.replayPath}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${env} pnpm --filter @proctira/aitest aitest run t03-property-invariants`;
}

function property<M extends object, R extends RealBase, C>(
  spec: DomainSpec<M, R, C>,
  focus: string | null,
  sink: {
    violations: Map<string, ViolationRecord>;
    stats: CommandStats;
    runs: number;
    commands: number;
  },
  replayPath?: string,
) {
  const known = new Set(spec.invariants.map((i) => i.id));
  return fc.asyncProperty(
    spec.config,
    fc.commands(spec.commands, {
      maxCommands: spec.maxCommands,
      size: 'max',
      ...(replayPath ? { replayPath } : {}),
    }),
    async (config, cmds) => {
      const log = new ViolationLog(known, focus);
      const stats = new CommandStats();
      const { model, real } = await spec.setup(log, stats, config);
      try {
        await fc.asyncModelRun(() => ({ model, real }), cmds);
        await spec.finalCheck?.(model, real);
      } finally {
        await spec.teardown?.(real);
        sink.runs += 1;
        for (const v of stats.byCommand.values()) sink.commands += v.run;
        sink.stats.merge(stats);
        for (const [inv, rec] of log.violations) {
          const prior = sink.violations.get(inv);
          if (prior) prior.count += rec.count;
          else sink.violations.set(inv, { ...rec, firstRun: `${String(config)} ${String(cmds)}` });
        }
      }
    },
  );
}

function shortString(v: unknown): string {
  try {
    return fc.stringify(v);
  } catch {
    return String(v);
  }
}

async function focusOne<M extends object, R extends RealBase, C>(
  spec: DomainSpec<M, R, C>,
  invariant: string,
  o: RunOptions,
): Promise<CounterExample | null> {
  const sink = { violations: new Map(), stats: new CommandStats(), runs: 0, commands: 0 };
  const id = caseId(spec.domain, invariant);
  const details = await fc.check(property(spec, invariant, sink, o.replayPath), {
    seed: o.seed,
    numRuns: o.path ? 1 : (o.focusRuns ?? o.numRuns),
    ...(o.path ? { path: o.path } : {}),
    interruptAfterTimeLimit: o.shrinkMs ?? 600_000,
    markInterruptAsFailure: false,
  });
  if (!details.failed || !details.counterexample) return null;
  const [config, cmds] = details.counterexample as [C, unknown];
  const commands = String(cmds);
  const err = details.errorInstance;
  const replayPath = REPLAY_RE.exec(commands)?.[1] ?? null;
  const ce: CounterExample = {
    caseId: id,
    invariant,
    seed: details.seed,
    path: details.counterexamplePath ?? null,
    replayPath,
    numRuns: details.numRuns,
    shrunk: details.numShrinks > 0,
    interrupted: details.interrupted,
    commands,
    config: shortString(config),
    detail:
      err instanceof InvariantError
        ? err.detail
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err),
    reproduce: '',
  };
  ce.reproduce = reproduceLine(ce);
  mkdirSync(join(o.outDir, 'counterexamples'), { recursive: true });
  ce.file = join(o.outDir, 'counterexamples', `${id.replace(/[^a-z0-9-]+/gi, '_')}.json`);
  writeFileSync(ce.file, `${JSON.stringify(ce, null, 2)}\n`);
  return ce;
}

/**
 * Run one domain: observe all invariants, then focus and shrink every
 * violated one. A harness error (an exception that is not an invariant
 * violation) is returned, never swallowed.
 */
export async function runDomain<M extends object, R extends RealBase, C>(
  spec: DomainSpec<M, R, C>,
  o: RunOptions,
): Promise<DomainReport> {
  const started = Date.now();
  const sink = {
    violations: new Map<string, ViolationRecord>(),
    stats: new CommandStats(),
    runs: 0,
    commands: 0,
  };
  const report: DomainReport = {
    domain: spec.domain,
    seed: o.seed,
    numRuns: o.numRuns,
    runsCompleted: 0,
    commandsRun: 0,
    violations: sink.violations,
    counterexamples: [],
    stats: sink.stats,
    harnessError: null,
    ms: 0,
  };
  const focusInvariant = o.focus?.startsWith(`prop:${spec.domain}:`)
    ? o.focus.slice(`prop:${spec.domain}:`.length)
    : null;
  if (focusInvariant) {
    // Replay / focused reproduction of one case.
    const ce = await focusOne(spec, focusInvariant, o);
    if (ce) {
      report.counterexamples.push(ce);
      sink.violations.set(focusInvariant, { count: 1, firstDetail: ce.detail });
    }
    report.ms = Date.now() - started;
    return report;
  }
  const observed = await fc.check(property(spec, null, sink), {
    seed: o.seed,
    numRuns: o.numRuns,
  });
  report.runsCompleted = sink.runs;
  report.commandsRun = sink.commands;
  if (observed.failed) {
    const e = observed.errorInstance;
    report.harnessError =
      e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}`.slice(0, 4000) : String(e);
  }
  for (const inv of sink.violations.keys()) {
    const ce = await focusOne(spec, inv, o);
    if (ce) report.counterexamples.push(ce);
  }
  report.ms = Date.now() - started;
  return report;
}
