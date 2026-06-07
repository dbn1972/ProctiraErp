/**
 * Account Lockout Service
 *
 * Tracks consecutive failed login attempts per user within a configurable window.
 * Locks the account after a configurable threshold of failures.
 * Auto-unlocks after a configurable duration.
 * Resets the failure counter on successful authentication.
 */
import type { AuthConfig } from '@proctira/auth';

/**
 * Represents a single failed login attempt.
 */
export interface FailedAttempt {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Timestamp of the failed attempt */
  attemptedAt: Date;
  /** IP address of the client */
  ipAddress?: string;
}

/**
 * Represents an account lockout record.
 */
export interface AccountLockout {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** When the lockout started */
  lockedAt: Date;
  /** When the lockout expires */
  expiresAt: Date;
  /** Number of consecutive failures that triggered the lockout */
  failureCount: number;
}

/**
 * Interface for lockout data storage.
 */
export interface LockoutStore {
  /** Record a failed login attempt */
  recordFailure(attempt: FailedAttempt): Promise<void>;
  /** Get the count of consecutive failures within the tracking window */
  getFailureCount(userId: string, tenantId: string, windowStart: Date): Promise<number>;
  /** Clear all failure records for a user (on successful login) */
  clearFailures(userId: string, tenantId: string): Promise<void>;
  /** Create a lockout record */
  createLockout(lockout: AccountLockout): Promise<void>;
  /** Get the active lockout for a user (if any) */
  getActiveLockout(userId: string, tenantId: string): Promise<AccountLockout | null>;
  /** Remove expired lockouts for a user */
  removeExpiredLockouts(userId: string, tenantId: string): Promise<void>;
}

/**
 * Result of checking account lockout status.
 */
export interface LockoutStatus {
  /** Whether the account is currently locked */
  isLocked: boolean;
  /** When the lockout expires (if locked) */
  expiresAt?: Date;
  /** Number of remaining attempts before lockout (if not locked) */
  remainingAttempts?: number;
}

/**
 * Account Lockout Service manages failed login attempt tracking and account locking.
 */
export class AccountLockoutService {
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;
  private readonly durationSeconds: number;

  constructor(
    private readonly config: AuthConfig,
    private readonly lockoutStore: LockoutStore,
  ) {
    this.maxAttempts = config.lockout.maxAttempts;
    this.windowSeconds = config.lockout.windowSeconds;
    this.durationSeconds = config.lockout.durationSeconds;
  }

  /**
   * Check if an account is currently locked.
   * Also cleans up expired lockouts.
   */
  async isAccountLocked(userId: string, tenantId: string): Promise<LockoutStatus> {
    // Remove any expired lockouts first
    await this.lockoutStore.removeExpiredLockouts(userId, tenantId);

    // Check for active lockout
    const lockout = await this.lockoutStore.getActiveLockout(userId, tenantId);

    if (lockout && lockout.expiresAt > new Date()) {
      return {
        isLocked: true,
        expiresAt: lockout.expiresAt,
      };
    }

    // Get current failure count within window
    const windowStart = new Date(Date.now() - this.windowSeconds * 1000);
    const failureCount = await this.lockoutStore.getFailureCount(userId, tenantId, windowStart);
    const remainingAttempts = Math.max(0, this.maxAttempts - failureCount);

    return {
      isLocked: false,
      remainingAttempts,
    };
  }

  /**
   * Record a failed login attempt.
   * If the failure count reaches the threshold, locks the account.
   *
   * @returns The updated lockout status after recording the failure
   */
  async recordFailure(
    userId: string,
    tenantId: string,
    ipAddress?: string,
  ): Promise<LockoutStatus> {
    // Record the failure
    await this.lockoutStore.recordFailure({
      userId,
      tenantId,
      attemptedAt: new Date(),
      ipAddress,
    });

    // Check failure count within window
    const windowStart = new Date(Date.now() - this.windowSeconds * 1000);
    const failureCount = await this.lockoutStore.getFailureCount(userId, tenantId, windowStart);

    // If threshold reached, lock the account
    if (failureCount >= this.maxAttempts) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.durationSeconds * 1000);

      await this.lockoutStore.createLockout({
        userId,
        tenantId,
        lockedAt: now,
        expiresAt,
        failureCount,
      });

      return {
        isLocked: true,
        expiresAt,
      };
    }

    return {
      isLocked: false,
      remainingAttempts: this.maxAttempts - failureCount,
    };
  }

  /**
   * Reset the failure counter on successful authentication.
   * Also removes any active lockouts (in case of edge cases).
   */
  async resetOnSuccess(userId: string, tenantId: string): Promise<void> {
    await this.lockoutStore.clearFailures(userId, tenantId);
    await this.lockoutStore.removeExpiredLockouts(userId, tenantId);
  }
}
