/**
 * t05 concurrency and race suite (live, nightly).
 *
 * Every variant in scenarios/ runs AITEST_RACE_ROUNDS rounds (default 20)
 * with fresh entities. Each round releases its requests together on a barrier
 * and spreads them round-robin over both gateways (two processes sharing
 * Postgres and Redis). Two cases per variant:
 *   race:<variant>         no duplicates, no lost updates, balanced books (SQL)
 *   race:<variant>:status  winners get the documented 2xx, losers 409 (or the
 *                          module's documented 422 refusal), never 5xx
 * Per-round statuses and entity ids go to race-rounds.json in AITEST_OUT_DIR
 * so a failing round can be replayed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadStackContext, ResultsRecorder } from '../../foundation/index.js';

import { aggregateRounds, rounds, type RoundResult } from './race.js';
import { COMPAT_CASES } from './scenarios/compat.js';
import { createRaceEnv, type RaceEnv } from './scenarios/env.js';
import { ALL_VARIANTS } from './scenarios/index.js';
const ctx = loadStackContext();
const recorder = new ResultsRecorder(ctx.outDir, 't05-concurrency-races', { trackDir: __dirname });
const ROUNDS = rounds();
const log: Record<string, RoundResult[]> = {};
let env: RaceEnv;
beforeAll(async () => {
  env = await createRaceEnv(ctx);
});
afterAll(async () => {
  await env?.close();
  const done = Object.values(log).reduce((s, r) => s + r.length, 0);
  const runnable = ALL_VARIANTS.filter((v) => !v.skip).length;
  recorder.coverage('variants run (of all listed variants)', runnable, ALL_VARIANTS.length);
  recorder.coverage('rounds completed (variants × rounds)', done, runnable * ROUNDS);
  recorder.write();
  writeFileSync(
    join(ctx.outDir, 'race-rounds.json'),
    `${JSON.stringify({ rounds: ROUNDS, gateways: ctx.state.urls.gateways.length, variants: log }, null, 2)}\n`,
  );
});
describe('t05 concurrency races', () => {
  it('runs against two gateways', () => {
    recorder.record('setup:two-gateways', ctx.state.urls.gateways.length === 2, {
      detail: `${ctx.state.urls.gateways.length} gateway(s)`,
    });
  });
  for (const c of COMPAT_CASES) {
    it(c.id, async () => {
      let out: { ok: boolean; detail: string };
      try {
        out = await c.run(env);
      } catch (err) {
        out = { ok: false, detail: `error: ${err instanceof Error ? err.message : String(err)}` };
      }
      recorder.record(c.id, out.ok, { detail: `[${c.module}] ${out.detail}` });
    });
  }
  for (const v of ALL_VARIANTS) {
    it(`${v.id}: ${v.title}`, async () => {
      if (v.skip) {
        recorder.record(`race:${v.id}`, 'skip', { reason: v.skip });
        recorder.record(`race:${v.id}:status`, 'skip', { reason: v.skip });
        return;
      }
      const results: RoundResult[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const started = performance.now();
        try {
          const r = await v.run(env, round);
          results.push({ round, ...r, ms: Math.round(performance.now() - started) });
        } catch (err) {
          const detail = `round error: ${err instanceof Error ? err.message : String(err)}`;
          results.push({
            round,
            statuses: [],
            invariant: { ok: false, detail },
            status: { ok: false, detail },
            entities: {},
            ms: Math.round(performance.now() - started),
          });
        }
      }
      log[v.id] = results;
      const agg = aggregateRounds(results);
      recorder.record(`race:${v.id}`, agg.invariant.ok, {
        detail: `[${v.module}] ${agg.invariant.detail}`,
      });
      recorder.record(`race:${v.id}:status`, agg.status.ok, {
        detail: `[${v.module}] ${agg.status.detail}`,
      });
    });
  }
  it('no case failed (pending-fix cases excepted)', () => {
    expect(recorder.failures()).toEqual([]);
  });
});
