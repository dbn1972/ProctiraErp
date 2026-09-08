/**
 * Circuit Breaker pattern implementation
 *
 * Prevents cascading failures by wrapping external calls.
 * When failures exceed a threshold, the circuit opens and
 * subsequent calls fail fast without attempting the operation.
 *
 * States:
 * - CLOSED: Normal operation, calls pass through
 * - OPEN: Calls fail immediately (circuit tripped)
 * - HALF_OPEN: One test call allowed to check recovery
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before transitioning from OPEN to HALF_OPEN (default: 30000) */
  resetTimeoutMs?: number;
  /** Optional name for logging/identification */
  name?: string;
}

export class CircuitBreakerError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly state: CircuitState,
  ) {
    super(`Circuit breaker "${circuitName}" is ${state} — call rejected`);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.name = options.name ?? 'default';
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitBreakerError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitBreakerError(this.name, this.state);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get the current state of the circuit breaker.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get the current consecutive failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.resetTimeoutMs;
  }
}
