/**
 * Retry Executor Unit Tests
 */
import { describe, it, expect } from 'vitest';
import {
  TestableRetryExecutor,
  InMemoryAdminNotifier,
  calculateBackoffDelay,
} from './retry-executor.js';

describe('calculateBackoffDelay', () => {
  it('should return base delay for first retry', () => {
    expect(calculateBackoffDelay(1000, 1)).toBe(1000);
  });

  it('should double delay for second retry', () => {
    expect(calculateBackoffDelay(1000, 2)).toBe(2000);
  });

  it('should quadruple delay for third retry', () => {
    expect(calculateBackoffDelay(1000, 3)).toBe(4000);
  });

  it('should cap at 5 minutes (300000ms)', () => {
    expect(calculateBackoffDelay(1000, 20)).toBe(300000);
  });

  it('should handle small base delays', () => {
    expect(calculateBackoffDelay(100, 1)).toBe(100);
    expect(calculateBackoffDelay(100, 2)).toBe(200);
    expect(calculateBackoffDelay(100, 3)).toBe(400);
  });
});

describe('TestableRetryExecutor', () => {
  it('should succeed on first attempt without retries', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    const result = await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 3, backoffMs: 1000 },
      async () => 'success',
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.result).toBe('success');
    expect(result.exhausted).toBe(false);
    expect(notifier.notifications).toHaveLength(0);
    expect(executor.sleepCalls).toHaveLength(0);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    let callCount = 0;
    const result = await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 3, backoffMs: 1000 },
      async () => {
        callCount++;
        if (callCount === 1) throw new Error('Transient error');
        return 'success';
      },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.result).toBe('success');
    expect(notifier.notifications).toHaveLength(0);
    expect(executor.sleepCalls).toHaveLength(1);
    expect(executor.sleepCalls[0]).toBe(1000); // First retry: 1000 * 2^0
  });

  it('should exhaust retries and notify admin on final failure', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    const result = await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 2, backoffMs: 500 },
      async () => {
        throw new Error('Persistent error');
      },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
    expect(result.lastError).toBe('Persistent error');
    expect(result.exhausted).toBe(true);

    // Admin should be notified
    expect(notifier.notifications).toHaveLength(1);
    expect(notifier.notifications[0]!.pipelineId).toBe('pipe-1');
    expect(notifier.notifications[0]!.pipelineName).toBe('Test Pipeline');
    expect(notifier.notifications[0]!.totalAttempts).toBe(3);
    expect(notifier.notifications[0]!.lastError).toBe('Persistent error');
  });

  it('should apply exponential backoff between retries', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 3, backoffMs: 1000 },
      async () => {
        throw new Error('Always fails');
      },
    );

    // Should have 3 sleep calls (for retries 1, 2, 3)
    expect(executor.sleepCalls).toHaveLength(3);
    expect(executor.sleepCalls[0]).toBe(1000);  // 1000 * 2^0
    expect(executor.sleepCalls[1]).toBe(2000);  // 1000 * 2^1
    expect(executor.sleepCalls[2]).toBe(4000);  // 1000 * 2^2
  });

  it('should track retry state', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 1, backoffMs: 500 },
      async () => {
        throw new Error('Fail');
      },
    );

    const state = executor.getRetryState('exec-1');
    expect(state).toBeDefined();
    expect(state!.exhausted).toBe(true);
    expect(state!.attempt).toBe(1);
    expect(state!.lastError).toBe('Fail');
  });

  it('should handle zero retries (no retry)', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    const result = await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 0, backoffMs: 1000 },
      async () => {
        throw new Error('Immediate fail');
      },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.exhausted).toBe(true);
    expect(executor.sleepCalls).toHaveLength(0);
    expect(notifier.notifications).toHaveLength(1);
  });

  it('should report isExhausted correctly', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    expect(executor.isExhausted('exec-1')).toBe(false);

    await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 0, backoffMs: 1000 },
      async () => {
        throw new Error('Fail');
      },
    );

    expect(executor.isExhausted('exec-1')).toBe(true);
  });

  it('should clear retry state', async () => {
    const notifier = new InMemoryAdminNotifier();
    const executor = new TestableRetryExecutor(notifier);

    await executor.executeWithRetry(
      'pipe-1',
      'exec-1',
      'tenant-1',
      'Test Pipeline',
      { maxRetries: 0, backoffMs: 1000 },
      async () => {
        throw new Error('Fail');
      },
    );

    executor.clearState('exec-1');
    expect(executor.getRetryState('exec-1')).toBeUndefined();
    expect(executor.isExhausted('exec-1')).toBe(false);
  });
});
