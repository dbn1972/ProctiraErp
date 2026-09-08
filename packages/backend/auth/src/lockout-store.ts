/**
 * In-memory implementation of LockoutStore.
 *
 * Suitable for single-instance deployments and testing.
 * For production multi-instance deployments, use PrismaLockoutStore or a Redis-backed store.
 */
import type { FailedAttempt, AccountLockout, LockoutStore } from './lockout-service.js';

/**
 * In-memory lockout store for tracking failed attempts and lockouts.
 */
export class InMemoryLockoutStore implements LockoutStore {
  private failures: FailedAttempt[] = [];
  private lockouts: AccountLockout[] = [];

  async recordFailure(attempt: FailedAttempt): Promise<void> {
    this.failures.push(attempt);
  }

  async getFailureCount(userId: string, tenantId: string, windowStart: Date): Promise<number> {
    return this.failures.filter(
      (f) => f.userId === userId && f.tenantId === tenantId && f.attemptedAt >= windowStart,
    ).length;
  }

  async clearFailures(userId: string, tenantId: string): Promise<void> {
    this.failures = this.failures.filter((f) => !(f.userId === userId && f.tenantId === tenantId));
  }

  async createLockout(lockout: AccountLockout): Promise<void> {
    this.lockouts.push(lockout);
  }

  async getActiveLockout(userId: string, tenantId: string): Promise<AccountLockout | null> {
    const now = new Date();
    const active = this.lockouts.find(
      (l) => l.userId === userId && l.tenantId === tenantId && l.expiresAt > now,
    );
    return active ?? null;
  }

  async removeExpiredLockouts(userId: string, tenantId: string): Promise<void> {
    const now = new Date();
    this.lockouts = this.lockouts.filter(
      (l) => !(l.userId === userId && l.tenantId === tenantId && l.expiresAt <= now),
    );
  }

  /**
   * Clear all data (useful for testing).
   */
  clear(): void {
    this.failures = [];
    this.lockouts = [];
  }
}
