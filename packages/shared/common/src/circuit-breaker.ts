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
  /**
   * Classify a thrown error as a breaker failure (default: every error counts).
   * Return false for caller errors (e.g. validation/4xx) that say nothing about
   * downstream health (PRC-L349).
   */
  isFailure?: (error: unknown) => boolean;
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
  private readonly isFailure: (error: unknown) => boolean;
  /** PRC-L349: only one probe may run while HALF_OPEN. */
  private probeInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.name = options.name ?? 'default';
    this.isFailure = options.isFailure ?? (() => true);
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
    let isProbe = false;
    if (this.state === CircuitState.HALF_OPEN) {
      // PRC-L349: a single in-flight probe; concurrent callers fail fast.
      if (this.probeInFlight) {
        throw new CircuitBreakerError(this.name, this.state);
      }
      this.probeInFlight = true;
      isProbe = true;
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.onFailure(isProbe);
      } else if (isProbe) {
        // Non-failure error proves the downstream answered — treat as recovery.
        this.onSuccess();
      }
      throw error;
    } finally {
      if (isProbe) this.probeInFlight = false;
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
    this.probeInFlight = false;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(isProbe = false): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    // A failed half-open probe re-opens immediately.
    if (isProbe || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.resetTimeoutMs;
  }
}
