/**
 * Retry Executor
 *
 * Implements configurable retry policy with exponential backoff
 * for pipeline execution failures. Notifies administrators after
 * final failure as required by Requirement 14.6.
 */

import type { RetryPolicy } from './schemas.js';

export interface RetryState {
  pipelineId: string;
  executionId: string;
  tenantId: string;
  attempt: number;
  maxRetries: number;
  baseBackoffMs: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  exhausted: boolean;
}

export interface RetryResult {
  success: boolean;
  attempts: number;
  lastError: string | null;
  exhausted: boolean;
}

/**
 * Notification handler interface for administrator alerts.
 */
export interface AdminNotifier {
  /**
   * Notify administrators that a pipeline has failed after all retries.
   */
  notifyFinalFailure(notification: PipelineFailureNotification): Promise<void>;
}

export interface PipelineFailureNotification {
  pipelineId: string;
  pipelineName: string;
  tenantId: string;
  executionId: string;
  totalAttempts: number;
  lastError: string;
  failedAt: Date;
}

/**
 * In-memory notifier for testing purposes.
 */
export class InMemoryAdminNotifier implements AdminNotifier {
  public notifications: PipelineFailureNotification[] = [];

  async notifyFinalFailure(notification: PipelineFailureNotification): Promise<void> {
    this.notifications.push(notification);
  }

  clear(): void {
    this.notifications = [];
  }
}

/**
 * Calculates exponential backoff delay for a given attempt.
 * Formula: baseBackoffMs * 2^(attempt - 1)
 * Capped at 5 minutes (300000ms) to prevent excessive delays.
 */
export function calculateBackoffDelay(baseBackoffMs: number, attempt: number): number {
  const MAX_BACKOFF_MS = 300000; // 5 minutes
  const delay = baseBackoffMs * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * RetryExecutor manages retry logic for pipeline executions.
 * It tracks retry state and applies exponential backoff between attempts.
 */
export class RetryExecutor {
  private retryStates: Map<string, RetryState> = new Map();
  private readonly notifier: AdminNotifier;

  constructor(notifier: AdminNotifier) {
    this.notifier = notifier;
  }

  /**
   * Execute a function with retry logic based on the provided policy.
   * Returns the result of the function on success, or throws after all retries are exhausted.
   */
  async executeWithRetry<T>(
    pipelineId: string,
    executionId: string,
    tenantId: string,
    pipelineName: string,
    retryPolicy: RetryPolicy,
    fn: (attempt: number) => Promise<T>,
  ): Promise<RetryResult & { result?: T }> {
    const state: RetryState = {
      pipelineId,
      executionId,
      tenantId,
      attempt: 0,
      maxRetries: retryPolicy.maxRetries,
      baseBackoffMs: retryPolicy.backoffMs,
      lastError: null,
      nextRetryAt: null,
      exhausted: false,
    };

    this.retryStates.set(executionId, state);

    let lastResult: T | undefined;

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      state.attempt = attempt;

      // Apply backoff delay for retries (not the first attempt)
      if (attempt > 0) {
        const delay = calculateBackoffDelay(retryPolicy.backoffMs, attempt);
        state.nextRetryAt = new Date(Date.now() + delay);
        await this.sleep(delay);
      }

      try {
        lastResult = await fn(attempt);
        // Success
        state.lastError = null;
        state.exhausted = false;
        this.retryStates.set(executionId, state);

        return {
          success: true,
          attempts: attempt + 1,
          lastError: null,
          exhausted: false,
          result: lastResult,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = errorMessage;
      }
    }

    // All retries exhausted
    state.exhausted = true;
    state.nextRetryAt = null;
    this.retryStates.set(executionId, state);

    // Notify administrators of final failure
    await this.notifier.notifyFinalFailure({
      pipelineId,
      pipelineName,
      tenantId,
      executionId,
      totalAttempts: retryPolicy.maxRetries + 1,
      lastError: state.lastError ?? 'Unknown error',
      failedAt: new Date(),
    });

    return {
      success: false,
      attempts: retryPolicy.maxRetries + 1,
      lastError: state.lastError,
      exhausted: true,
    };
  }

  /**
   * Get the current retry state for an execution.
   */
  getRetryState(executionId: string): RetryState | undefined {
    return this.retryStates.get(executionId);
  }

  /**
   * Check if an execution has exhausted all retries.
   */
  isExhausted(executionId: string): boolean {
    const state = this.retryStates.get(executionId);
    return state?.exhausted ?? false;
  }

  /**
   * Clear retry state for an execution.
   */
  clearState(executionId: string): void {
    this.retryStates.delete(executionId);
  }

  /**
   * Sleep utility for backoff delays. Can be overridden in tests.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Testable retry executor that doesn't actually sleep.
 */
export class TestableRetryExecutor extends RetryExecutor {
  public sleepCalls: number[] = [];

  protected override sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms);
    return Promise.resolve();
  }
}
