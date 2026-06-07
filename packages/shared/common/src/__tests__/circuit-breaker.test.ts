import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState, CircuitBreakerError } from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      name: 'test-service',
    });
  });

  describe('CLOSED state', () => {
    it('starts in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('passes through successful calls', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('passes through errors without opening if below threshold', async () => {
      const failingFn = async () => {
        throw new Error('service error');
      };

      await expect(breaker.execute(failingFn)).rejects.toThrow('service error');
      await expect(breaker.execute(failingFn)).rejects.toThrow('service error');

      // 2 failures, threshold is 3 — still closed
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getFailureCount()).toBe(2);
    });

    it('resets failure count on success', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      // Success resets the counter
      await breaker.execute(async () => 'ok');

      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    it('opens after reaching failure threshold', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('rejects calls immediately when open', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
      }

      // Now calls should be rejected without executing
      const spy = vi.fn().mockResolvedValue('should not run');
      await expect(breaker.execute(spy)).rejects.toThrow(CircuitBreakerError);
      expect(spy).not.toHaveBeenCalled();
    });

    it('throws CircuitBreakerError with correct metadata', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow();
      }

      try {
        await breaker.execute(async () => 'nope');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerError);
        expect((err as CircuitBreakerError).circuitName).toBe('test-service');
        expect((err as CircuitBreakerError).state).toBe(CircuitState.OPEN);
      }
    });
  });

  describe('HALF_OPEN state', () => {
    it('transitions to HALF_OPEN after reset timeout', async () => {
      vi.useFakeTimers();

      const failingFn = async () => {
        throw new Error('fail');
      };

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Advance time past reset timeout
      vi.advanceTimersByTime(1100);

      // Next call should be allowed (HALF_OPEN)
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      vi.useRealTimers();
    });

    it('re-opens on failure in HALF_OPEN state', async () => {
      vi.useFakeTimers();

      const failingFn = async () => {
        throw new Error('fail');
      };

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
      }

      // Advance time past reset timeout
      vi.advanceTimersByTime(1100);

      // Attempt in HALF_OPEN fails — should re-open
      await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      vi.useRealTimers();
    });
  });

  describe('manual reset', () => {
    it('resets circuit to CLOSED state', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow();
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getFailureCount()).toBe(0);

      // Should work again
      const result = await breaker.execute(async () => 'works');
      expect(result).toBe('works');
    });
  });

  describe('default options', () => {
    it('uses default threshold of 5', async () => {
      const defaultBreaker = new CircuitBreaker();
      const failingFn = async () => {
        throw new Error('fail');
      };

      for (let i = 0; i < 4; i++) {
        await expect(defaultBreaker.execute(failingFn)).rejects.toThrow('fail');
      }
      // 4 failures, default threshold is 5 — still closed
      expect(defaultBreaker.getState()).toBe(CircuitState.CLOSED);

      await expect(defaultBreaker.execute(failingFn)).rejects.toThrow('fail');
      expect(defaultBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });
});
