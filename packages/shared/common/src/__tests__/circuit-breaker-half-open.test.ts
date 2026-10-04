/**
 * PRC-L349 — single in-flight half-open probe and optional isFailure classifier.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError, CircuitState } from '../circuit-breaker.js';

async function trip(cb: CircuitBreaker, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await cb.execute(() => Promise.reject(new Error('down'))).catch(() => undefined);
  }
}

describe('CircuitBreaker half-open probe (PRC-L349)', () => {
  afterEach(() => vi.useRealTimers());

  it('10 concurrent calls in HALF_OPEN -> 1 executes, others get CircuitBreakerError', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    await trip(cb, 2);
    expect(cb.getState()).toBe(CircuitState.OPEN);
    vi.advanceTimersByTime(1000);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(async () => {
      await gate;
      return 'ok';
    });
    const calls = Array.from({ length: 10 }, () => cb.execute(fn));
    release();
    const results = await Promise.allSettled(calls);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(CircuitBreakerError);
    }
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('a failed probe re-opens the circuit', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    await trip(cb, 2);
    vi.advanceTimersByTime(1000);
    await expect(cb.execute(() => Promise.reject(new Error('still down')))).rejects.toThrow(
      'still down',
    );
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('isFailure=false errors do not count toward the threshold', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      isFailure: (e) => !(e instanceof Error && e.message.startsWith('4xx')),
    });
    for (let i = 0; i < 5; i++) {
      await cb.execute(() => Promise.reject(new Error('4xx bad input'))).catch(() => undefined);
    }
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });
});
