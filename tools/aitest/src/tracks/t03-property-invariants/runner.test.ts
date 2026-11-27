/**
 * The runner on an in-memory toy domain: a counter whose "service" wrongly
 * goes negative after three decrements in a row. Observe finds the violation,
 * focus shrinks it to the minimal sequence and writes a counterexample with a
 * reproduction line; pending cases are reported pending-fix, not fail.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ResultsRecorder } from '../../foundation/index.js';
import { agree, attempt, COMMON_INVARIANTS, type InvariantMeta } from './core.js';
import { summariseDomain } from './report.js';
import { reproduceLine, runDomain, type DomainSpec, type RealBase } from './runner.js';

interface Model {
  value: number;
  streak: number;
}
interface Real extends RealBase {
  value: number;
  streak: number;
}

const INV: InvariantMeta[] = [
  {
    id: 'non-negative',
    title: 'never negative',
    module: 'toy',
    category: 'money',
    severity: 'high',
    source: 'toy',
  },
  ...COMMON_INVARIANTS('toy'),
];

class Inc implements fc.AsyncCommand<Model, Real, boolean> {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    m.value += 1;
    r.value += 1;
    m.streak = r.streak = 0;
    r.stats.note('Inc', true);
    r.log.check('non-negative', r.value >= 0, () => `value ${r.value}`);
  }
  toString() {
    return 'Inc';
  }
}
class Dec implements fc.AsyncCommand<Model, Real, boolean> {
  check() {
    return true;
  }
  async run(m: Model, r: Real) {
    const accept = m.value > 0;
    const got = await attempt(async () => {
      r.streak += 1;
      if (r.value <= 0 && r.streak < 3)
        throw Object.assign(new Error('empty'), { statusCode: 422 });
      r.value -= 1; // bug: the third decrement in a row ignores the floor
      return r.value;
    });
    if (agree(r.log, 'Dec', { accept, why: `value ${m.value}` }, got)) m.value -= 1;
    r.stats.note('Dec', got.ok);
    r.log.check('non-negative', r.value >= 0, () => `value ${r.value}`);
  }
  toString() {
    return 'Dec';
  }
}

const spec: DomainSpec<Model, Real, null> = {
  domain: 'fees',
  invariants: INV,
  commands: [fc.constant(new Inc()), fc.constant(new Dec())],
  config: fc.constant(null),
  maxCommands: 12,
  async setup(log, stats) {
    return { model: { value: 0, streak: 0 }, real: { log, stats, value: 0, streak: 0 } };
  },
};

describe('t03 runner', () => {
  it('observes, then shrinks a violated invariant to a minimal reproduction', async () => {
    const out = mkdtempSync(join(tmpdir(), 't03-runner-'));
    const report = await runDomain(spec, {
      numRuns: 200,
      seed: 1234,
      outDir: out,
      shrinkMs: 20_000,
    });
    expect(report.harnessError).toBeNull();
    expect(report.runsCompleted).toBe(200);
    expect(report.violations.has('non-negative')).toBe(true);
    const ce = report.counterexamples.find((c) => c.invariant === 'non-negative')!;
    expect(ce.commands).toMatch(/^Dec,Dec,Dec/);
    expect(ce.caseId).toBe('prop:fees:non-negative');
    expect(existsSync(ce.file!)).toBe(true);
    expect(JSON.parse(readFileSync(ce.file!, 'utf8')).reproduce).toContain(
      'AITEST_FOCUS=prop:fees:non-negative',
    );

    // Replay the shrunk case from its seed/path in focus mode.
    const replay = await runDomain(spec, {
      numRuns: 200,
      seed: ce.seed,
      outDir: out,
      focus: ce.caseId,
      ...(ce.path ? { path: ce.path } : {}),
      ...(ce.replayPath ? { replayPath: ce.replayPath } : {}),
    });
    expect(replay.counterexamples[0]?.commands).toMatch(/^Dec,Dec,Dec/);

    const pending = new Map([['prop:fees:non-negative', 'AIT-T03-999']]);
    const rec = new ResultsRecorder(out, 't03-property-invariants', { pending });
    summariseDomain(rec, spec, report, false, pending);
    const byId = new Map(rec.summary().cases.map((c) => [c.caseId, c.outcome]));
    expect(byId.get('prop:fees:non-negative')).toBe('pending-fix');
    expect(rec.failures().map((c) => c.caseId)).toEqual(['prop:fees:model-agreement']);
  });

  it('reproduction line names the case, seed and paths', () => {
    expect(reproduceLine({ caseId: 'prop:fees:x', seed: 5, path: '1:2', replayPath: 'AB' })).toBe(
      'AITEST_FOCUS=prop:fees:x AITEST_SEED=5 AITEST_PATH=1:2 AITEST_REPLAY_PATH=AB pnpm --filter @proctira/aitest aitest run t03-property-invariants',
    );
  });
});
