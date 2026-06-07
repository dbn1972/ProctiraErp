/**
 * Unit tests for AccountLockoutService - failure tracking, lockout, and reset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthConfig } from '@proctira/auth';
import type { AuthConfig } from '@proctira/auth';

import { AccountLockoutService } from './lockout-service.js';
import { InMemoryLockoutStore } from './lockout-store.js';

describe('AccountLockoutService', () => {
  let config: AuthConfig;
  let lockoutStore: InMemoryLockoutStore;
  let lockoutService: AccountLockoutService;

  const userId = 'user-123';
  const tenantId = 'tenant-1';

  beforeEach(() => {
    config = createAuthConfig({
      lockout: {
        maxAttempts: 3,
        windowSeconds: 900, // 15 minutes
        durationSeconds: 900, // 15 minutes
      },
    });
    lockoutStore = new InMemoryLockoutStore();
    lockoutService = new AccountLockoutService(config, lockoutStore);
  });

  describe('isAccountLocked', () => {
    it('should return not locked for a user with no failures', async () => {
      const status = await lockoutService.isAccountLocked(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(3);
    });

    it('should return not locked after some failures below threshold', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);

      const status = await lockoutService.isAccountLocked(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(1);
    });

    it('should return locked after reaching the threshold', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);

      const status = await lockoutService.isAccountLocked(userId, tenantId);

      expect(status.isLocked).toBe(true);
      expect(status.expiresAt).toBeDefined();
      expect(status.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return not locked after lockout expires', async () => {
      // Create a lockout with a very short duration
      const shortConfig = createAuthConfig({
        lockout: {
          maxAttempts: 3,
          windowSeconds: 900,
          durationSeconds: 0, // Expires immediately
        },
      });
      const shortService = new AccountLockoutService(shortConfig, lockoutStore);

      await shortService.recordFailure(userId, tenantId);
      await shortService.recordFailure(userId, tenantId);
      await shortService.recordFailure(userId, tenantId);

      // The lockout should have expired immediately (duration = 0)
      const status = await shortService.isAccountLocked(userId, tenantId);

      // With 0 duration, the lockout expires at creation time, so it should be cleaned up
      expect(status.isLocked).toBe(false);
    });

    it('should not affect other users', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);

      const otherUserStatus = await lockoutService.isAccountLocked('other-user', tenantId);

      expect(otherUserStatus.isLocked).toBe(false);
      expect(otherUserStatus.remainingAttempts).toBe(3);
    });

    it('should not affect other tenants', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);

      const otherTenantStatus = await lockoutService.isAccountLocked(userId, 'other-tenant');

      expect(otherTenantStatus.isLocked).toBe(false);
      expect(otherTenantStatus.remainingAttempts).toBe(3);
    });
  });

  describe('recordFailure', () => {
    it('should return not locked after first failure', async () => {
      const status = await lockoutService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(2);
    });

    it('should return not locked after second failure', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      const status = await lockoutService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(1);
    });

    it('should return locked after third failure (threshold)', async () => {
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      const status = await lockoutService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(true);
      expect(status.expiresAt).toBeDefined();
    });

    it('should set lockout expiry based on configured duration', async () => {
      const beforeLock = Date.now();

      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      const status = await lockoutService.recordFailure(userId, tenantId);

      const afterLock = Date.now();
      const expectedMinExpiry = beforeLock + config.lockout.durationSeconds * 1000;
      const expectedMaxExpiry = afterLock + config.lockout.durationSeconds * 1000;

      expect(status.expiresAt!.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(status.expiresAt!.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('should record IP address with the failure', async () => {
      await lockoutService.recordFailure(userId, tenantId, '192.168.1.1');

      // Verify the failure was recorded (indirectly through count)
      const status = await lockoutService.isAccountLocked(userId, tenantId);
      expect(status.remainingAttempts).toBe(2);
    });

    it('should lock with configurable threshold of 5', async () => {
      const customConfig = createAuthConfig({
        lockout: {
          maxAttempts: 5,
          windowSeconds: 900,
          durationSeconds: 900,
        },
      });
      const customService = new AccountLockoutService(customConfig, lockoutStore);

      // 4 failures should not lock
      for (let i = 0; i < 4; i++) {
        const status = await customService.recordFailure(userId, tenantId);
        expect(status.isLocked).toBe(false);
      }

      // 5th failure should lock
      const status = await customService.recordFailure(userId, tenantId);
      expect(status.isLocked).toBe(true);
    });
  });

  describe('resetOnSuccess', () => {
    it('should reset failure counter on successful authentication', async () => {
      // Record 2 failures
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);

      // Successful login
      await lockoutService.resetOnSuccess(userId, tenantId);

      // Should be back to full attempts
      const status = await lockoutService.isAccountLocked(userId, tenantId);
      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(3);
    });

    it('should allow new failures after reset', async () => {
      // Record 2 failures, then reset
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.resetOnSuccess(userId, tenantId);

      // Record 2 more failures - should not be locked
      await lockoutService.recordFailure(userId, tenantId);
      const status = await lockoutService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(1);
    });

    it('should not affect other users when resetting', async () => {
      // Both users have 2 failures
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure(userId, tenantId);
      await lockoutService.recordFailure('other-user', tenantId);
      await lockoutService.recordFailure('other-user', tenantId);

      // Reset only one user
      await lockoutService.resetOnSuccess(userId, tenantId);

      // First user should be reset
      const status1 = await lockoutService.isAccountLocked(userId, tenantId);
      expect(status1.remainingAttempts).toBe(3);

      // Other user should still have failures
      const status2 = await lockoutService.isAccountLocked('other-user', tenantId);
      expect(status2.remainingAttempts).toBe(1);
    });
  });

  describe('window-based tracking', () => {
    it('should only count failures within the configured window', async () => {
      // Use a very short window for testing
      const shortWindowConfig = createAuthConfig({
        lockout: {
          maxAttempts: 3,
          windowSeconds: 1, // 1 second window
          durationSeconds: 900,
        },
      });
      const shortWindowStore = new InMemoryLockoutStore();
      const shortWindowService = new AccountLockoutService(shortWindowConfig, shortWindowStore);

      // Record 2 failures
      await shortWindowService.recordFailure(userId, tenantId);
      await shortWindowService.recordFailure(userId, tenantId);

      // Wait for the window to pass
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // This failure should be the only one in the new window
      const status = await shortWindowService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(false);
      expect(status.remainingAttempts).toBe(2);
    });
  });

  describe('configurable lockout duration', () => {
    it('should use the configured lockout duration', async () => {
      const customConfig = createAuthConfig({
        lockout: {
          maxAttempts: 3,
          windowSeconds: 900,
          durationSeconds: 3600, // 1 hour lockout
        },
      });
      const customService = new AccountLockoutService(customConfig, lockoutStore);

      await customService.recordFailure(userId, tenantId);
      await customService.recordFailure(userId, tenantId);
      const status = await customService.recordFailure(userId, tenantId);

      expect(status.isLocked).toBe(true);
      // Lockout should expire approximately 1 hour from now
      const expectedExpiry = Date.now() + 3600 * 1000;
      expect(Math.abs(status.expiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000);
    });
  });
});
