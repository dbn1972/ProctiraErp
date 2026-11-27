import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { serverGuard, withBuildLock } from './guard.js';

describe('serverGuard', () => {
  it('retries a failing guard until it passes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aitest-guard-'));
    const counter = join(dir, 'n');
    writeFileSync(counter, '0');
    const script = join(dir, 'guard.sh');
    writeFileSync(
      script,
      `n=$(cat ${counter}); n=$((n+1)); echo $n > ${counter}; [ $n -ge 3 ] || { echo "load high"; exit 1; }`,
    );
    const lines: string[] = [];
    await serverGuard('test', {
      env: { ...process.env, AITEST_GUARD_CMD: `bash ${script}` },
      delayMs: 1,
      log: (l) => lines.push(l),
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/attempt 1\/30\): load high/);
  });

  it('gives up after the retry budget', async () => {
    await expect(
      serverGuard('heavy', {
        env: { ...process.env, AITEST_GUARD_CMD: 'exit 1' },
        retries: 2,
        delayMs: 1,
        log: () => {},
      }),
    ).rejects.toThrow(/still failing after 2 attempts; not starting heavy/);
  });

  it('is a no-op when the guard is disabled', async () => {
    await expect(
      serverGuard('x', { env: { ...process.env, AITEST_GUARD_CMD: '' } }),
    ).resolves.toBeUndefined();
  });
});

describe('withBuildLock', () => {
  it('serialises concurrent holders', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'aitest-lock-'));
    const events: string[] = [];
    const job = (name: string) =>
      withBuildLock(
        async () => {
          events.push(`${name}:in`);
          await new Promise((r) => setTimeout(r, 100));
          events.push(`${name}:out`);
          return name;
        },
        { stateDir },
      );
    const results = await Promise.all([job('a'), job('b')]);
    expect(results).toEqual(['a', 'b']);
    expect(events[1]).toMatch(/:out$/);
    expect(events[3]).toMatch(/:out$/);
  });
});
