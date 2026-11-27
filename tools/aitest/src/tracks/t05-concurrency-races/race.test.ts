import { describe, expect, it } from 'vitest';
import {
  aggregateRounds,
  allOf,
  checkStatuses,
  expectEq,
  race,
  rounds,
  settle,
  spread,
  statusMultiset,
  type RoundResult,
} from './race.js';
import { chainCheck } from './scenarios/marks.js';
import { rotate } from './scenarios/env.js';
describe('race barrier', () => {
  it('starts every call before any call is allowed to finish', async () => {
    const started: number[] = [];
    let releaseAll!: () => void;
    const hold = new Promise<void>((r) => (releaseAll = r));
    const p = race(5, async (i) => {
      started.push(i);
      if (started.length === 5) releaseAll();
      await hold;
      return i * 10;
    });
    const out = await p;
    expect(started.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(out.map((r) => r.value)).toEqual([0, 10, 20, 30, 40]);
  });
  it('fires nothing until the gate opens on the next macrotask', async () => {
    let calls = 0;
    const p = race(3, async () => {
      calls++;
      return calls;
    });
    // Still synchronous with race(): the setImmediate gate has not run.
    expect(calls).toBe(0);
    await p;
    expect(calls).toBe(3);
  });
  it('records a thrown call as an error in index order', async () => {
    const out = await race(3, async (i) => {
      if (i === 1) throw new Error('boom');
      return i;
    });
    expect(out.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(out[1]?.error).toBe('boom');
    expect(out[1]?.value).toBeUndefined();
  });
  it('rejects n < 1', async () => {
    await expect(race(0, async () => 1)).rejects.toThrow(/n >= 1/);
  });
});
describe('spread / rotate', () => {
  it('spreads round-robin over the gateways', () => {
    const g = ['gw1', 'gw2'];
    expect([0, 1, 2, 3, 4].map((i) => spread(g, i))).toEqual(['gw1', 'gw2', 'gw1', 'gw2', 'gw1']);
    expect(() => spread([], 0)).toThrow();
  });
  it('rotates distinct items and wraps', () => {
    expect(rotate(['a', 'b', 'c'], 2, 3)).toEqual(['c', 'a', 'b']);
    expect(() => rotate(['a'], 0, 2)).toThrow(/pool too small/);
  });
});
describe('status multiset matcher', () => {
  it('formats counts by ascending status', () => {
    expect(statusMultiset([409, 201, 409, 0])).toBe('0×1 201×1 409×2');
  });
  it('passes exact winners and allowed losers', () => {
    const c = checkStatuses([201, 409, 409, 409], { winners: { 201: 1 }, losers: [409] });
    expect(c.ok).toBe(true);
    expect(c.detail).toBe('201×1 409×3');
  });
  it('fails on a duplicate winner', () => {
    const c = checkStatuses([201, 201, 409], { winners: { 201: 1 }, losers: [409] });
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/201: 2, expected 1/);
  });
  it('fails on a 5xx, a transport error or a wrong loser status', () => {
    for (const bad of [500, 0, 400]) {
      const c = checkStatuses([201, bad], { winners: { 201: 1 }, losers: [409, 422] });
      expect(c.ok).toBe(false);
      expect(c.detail).toMatch(/unexpected/);
    }
  });
  it('supports ranges and a total over several winner statuses', () => {
    const contract = {
      winners: { 201: [0, 1], 200: [0, 2] },
      totalWinners: [1, 2],
      losers: [422],
    } as const;
    expect(checkStatuses([201, 422, 422], contract).ok).toBe(true);
    expect(checkStatuses([200, 200, 422], contract).ok).toBe(true);
    expect(checkStatuses([422, 422], contract).ok).toBe(false);
    expect(checkStatuses([201, 200, 200], contract).ok).toBe(false);
  });
});
describe('checks and rounds', () => {
  const round = (n: number, ok: boolean): RoundResult => ({
    round: n,
    statuses: [201, 409],
    invariant: { ok, detail: ok ? 'fine' : 'duplicate' },
    status: { ok: true, detail: '201×1 409×1' },
    entities: { id: `e${n}` },
    ms: 1,
  });
  it('allOf reports only the failing parts', () => {
    const c = allOf({ a: expectEq(1, 1), b: expectEq(2, 3) });
    expect(c.ok).toBe(false);
    expect(c.detail).toBe('b: 2 (expected 3)');
  });
  it('aggregates rounds and names the first failing round with its entities', () => {
    const agg = aggregateRounds([round(0, true), round(1, false), round(2, false)]);
    expect(agg.invariant.ok).toBe(false);
    expect(agg.invariant.failedRounds).toBe(2);
    expect(agg.invariant.detail).toContain('first failing round 1: duplicate');
    expect(agg.invariant.detail).toContain('"id":"e1"');
    expect(agg.status.ok).toBe(true);
    expect(agg.status.detail).toContain('statuses 201×3 409×3');
  });
  it('treats zero rounds as a failure', () => {
    expect(aggregateRounds([]).invariant.ok).toBe(false);
  });
  it('reads AITEST_RACE_ROUNDS with default 20', () => {
    expect(rounds({})).toBe(20);
    expect(rounds({ AITEST_RACE_ROUNDS: '100' })).toBe(100);
    expect(() => rounds({ AITEST_RACE_ROUNDS: 'x' })).toThrow();
    expect(() => rounds({ AITEST_RACE_ROUNDS: '0' })).toThrow();
  });
  it('settle polls until done or timeout', async () => {
    let n = 0;
    expect(
      await settle(
        async () => ++n,
        (v) => v >= 3,
        { intervalMs: 1 },
      ),
    ).toBe(3);
    expect(
      await settle(
        async () => 0,
        (v) => v > 0,
        { timeoutMs: 20, intervalMs: 5 },
      ),
    ).toBe(0);
  });
});
describe('grade audit chain (lost-update detector)', () => {
  it('accepts a linear chain ending at the stored score', () => {
    const edges = [
      { from: 40, to: 71 },
      { from: 71, to: 74 },
    ];
    expect(chainCheck(40, 74, edges, 2).ok).toBe(true);
  });
  it('flags two writes from the same prior score as a lost update', () => {
    const edges = [
      { from: 40, to: 71 },
      { from: 40, to: 72 },
    ];
    const c = chainCheck(40, 72, edges, 2);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/lost update/);
  });
  it('flags a chain that does not end at the stored score, or a count mismatch', () => {
    expect(chainCheck(40, 99, [{ from: 40, to: 71 }], 1).ok).toBe(false);
    expect(chainCheck(40, 71, [{ from: 40, to: 71 }], 2).ok).toBe(false);
    expect(chainCheck(null, 61, [{ from: null, to: 61 }], 1).ok).toBe(true);
  });
});
