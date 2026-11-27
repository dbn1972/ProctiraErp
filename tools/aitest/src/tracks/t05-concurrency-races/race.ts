/**
 * Generic race driver for t05 (cross-process HTTP races).
 *
 * `race(n, fire)` creates all `n` request promises behind one barrier and
 * releases them together on a `setImmediate` gate, so every request is in
 * flight before any response arrives. Callers spread the requests over the
 * stack's gateways (`spread`), as production runs gateway replicas.
 *
 * A scenario variant runs for `rounds()` rounds with fresh entities. Each
 * round yields an invariant check (no duplicate, no lost update, balances)
 * and a status-contract check (winners get the documented 2xx, losers a
 * conflict status, never a 5xx). `aggregateRounds` folds the rounds into one
 * result per check with the status multiset and the first failing round's
 * entity ids, so a failure can be reproduced by rerunning that round.
 */
export interface Timed<T> {
  index: number;
  value?: T;
  error?: string;
  ms: number;
}
/** Release `n` calls of `fire` together and collect them in index order. */
export async function race<T>(n: number, fire: (i: number) => Promise<T>): Promise<Timed<T>[]> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`race needs n >= 1, got ${n}`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runs = Array.from({ length: n }, (_, index) =>
    gate.then(async (): Promise<Timed<T>> => {
      const started = performance.now();
      try {
        const value = await fire(index);
        return { index, value, ms: Math.round(performance.now() - started) };
      } catch (err) {
        return {
          index,
          error: err instanceof Error ? err.message : String(err),
          ms: Math.round(performance.now() - started),
        };
      }
    }),
  );
  setImmediate(release);
  return Promise.all(runs);
}
/** Round-robin pick: request i goes to item i mod length (gateway #1, #2, #1, ...). */
export function spread<T>(items: readonly T[], i: number): T {
  if (items.length === 0) throw new Error('spread needs at least one item');
  return items[i % items.length] as T;
}
/** `201×1 409×9`, statuses ascending; 0 stands for a transport error. */
export function statusMultiset(statuses: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, c]) => `${s}×${c}`)
    .join(' ');
}
/**
 * Status contract of one race. `winners` maps each allowed success status to
 * an exact count, or to a [min, max] range; every other response must be in
 * `losers`. Any 5xx or transport error (0) fails.
 */
export interface StatusContract {
  winners: Record<number, number | readonly [number, number]>;
  losers: readonly number[];
  /** Exact number of successes over all winner statuses together. */
  totalWinners?: number | readonly [number, number];
}
export interface Check {
  ok: boolean;
  detail: string;
}
const inRange = (v: number, r: number | readonly [number, number]) =>
  typeof r === 'number' ? v === r : v >= r[0] && v <= r[1];
const fmtRange = (r: number | readonly [number, number]) =>
  typeof r === 'number' ? String(r) : `${r[0]}..${r[1]}`;
export function checkStatuses(statuses: readonly number[], c: StatusContract): Check {
  const problems: string[] = [];
  const winnerStatuses = Object.keys(c.winners).map(Number);
  let winners = 0;
  for (const w of winnerStatuses) {
    const got = statuses.filter((s) => s === w).length;
    winners += got;
    const want = c.winners[w] as number | readonly [number, number];
    if (!inRange(got, want)) problems.push(`${w}: ${got}, expected ${fmtRange(want)}`);
  }
  if (c.totalWinners !== undefined && !inRange(winners, c.totalWinners)) {
    problems.push(`successes ${winners}, expected ${fmtRange(c.totalWinners)}`);
  }
  const unexpected = statuses.filter((s) => !winnerStatuses.includes(s) && !c.losers.includes(s));
  if (unexpected.length > 0) {
    problems.push(
      `unexpected ${statusMultiset(unexpected)} (losers must be ${c.losers.join('/')})`,
    );
  }
  return {
    ok: problems.length === 0,
    detail: `${statusMultiset(statuses)}${problems.length ? `: ${problems.join('; ')}` : ''}`,
  };
}
/** Combine named sub-checks into one (all must pass). */
export function allOf(parts: Record<string, Check>): Check {
  const failed = Object.entries(parts).filter(([, p]) => !p.ok);
  const show = failed.length > 0 ? failed : Object.entries(parts);
  return {
    ok: failed.length === 0,
    detail: show.map(([k, p]) => `${k}: ${p.detail}`).join('; '),
  };
}
export function expectEq(actual: unknown, expected: unknown, label = ''): Check {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return {
    ok,
    detail: `${label}${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`,
  };
}
export interface RoundResult {
  round: number;
  statuses: number[];
  invariant: Check;
  status: Check;
  /** Entity ids created for the round (reproduction). */
  entities: Record<string, string>;
  ms: number;
}
export interface Aggregate {
  rounds: number;
  failedRounds: number;
  ok: boolean;
  detail: string;
}
function aggregateOne(rounds: readonly RoundResult[], pick: (r: RoundResult) => Check): Aggregate {
  const failed = rounds.filter((r) => !pick(r).ok);
  const all = rounds.flatMap((r) => r.statuses);
  const first = failed[0];
  const parts = [
    `rounds ${rounds.length}, failed ${failed.length}`,
    `statuses ${statusMultiset(all) || 'none'}`,
  ];
  if (first) {
    parts.push(
      `first failing round ${first.round}: ${pick(first).detail}; entities ${JSON.stringify(first.entities)}`,
    );
  }
  return {
    rounds: rounds.length,
    failedRounds: failed.length,
    ok: rounds.length > 0 && failed.length === 0,
    detail: parts.join('; '),
  };
}
export function aggregateRounds(rounds: readonly RoundResult[]): {
  invariant: Aggregate;
  status: Aggregate;
} {
  return {
    invariant: aggregateOne(rounds, (r) => r.invariant),
    status: aggregateOne(rounds, (r) => r.status),
  };
}
/** AITEST_RACE_ROUNDS (default 20). */
export function rounds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['AITEST_RACE_ROUNDS'];
  if (raw === undefined || raw === '') return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new Error(`AITEST_RACE_ROUNDS must be an integer 1..1000, got ${raw}`);
  }
  return n;
}
/** Poll `read` until `done` holds or the timeout passes; returns the last value. */
export async function settle<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  o: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (o.timeoutMs ?? 3000);
  let v = await read();
  while (!done(v) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, o.intervalMs ?? 100));
    v = await read();
  }
  return v;
}
