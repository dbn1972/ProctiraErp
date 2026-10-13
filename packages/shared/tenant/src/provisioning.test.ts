import { describe, it, expect, vi } from 'vitest';
import { provisionTenant, type ProvisioningDbClient } from './provisioning.js';

/**
 * PRC-L496 — provisionTenant previously inserted into a non-existent `users`
 * table (password_hash/role) and had no production caller. It now fails closed,
 * directing callers to the Keycloak-backed provisionTenantAdmin flow. These
 * tests assert the fail-closed contract (not the old broken happy path).
 */
describe('provisionTenant (PRC-L496 fail-closed)', () => {
  const db: ProvisioningDbClient = {
    $transaction: vi.fn(async (fn) =>
      fn({
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      }),
    ),
  };

  const validInput = {
    name: 'Test Ministry',
    slug: 'test-ministry',
    config: { timezone: 'UTC', locale: 'en' },
    admin: {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@test-ministry.org',
      passwordHash: '$2b$10$hashedpassword',
    },
  };

  it('fails closed and points to the Keycloak-backed provisionTenantAdmin flow', async () => {
    await expect(provisionTenant(db, validInput)).rejects.toThrow(
      /not implemented|users` table|Keycloak|PRC-L496/,
    );
  });

  it('does not attempt any raw INSERT INTO users', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const spyDb: ProvisioningDbClient = {
      $transaction: vi.fn(async (fn) =>
        fn({ $executeRawUnsafe: executeRawUnsafe, $queryRawUnsafe: queryRawUnsafe }),
      ),
    };
    await expect(provisionTenant(spyDb, validInput)).rejects.toThrow();
    const allSql = [
      ...executeRawUnsafe.mock.calls.map((c) => String(c[0])),
      ...queryRawUnsafe.mock.calls.map((c) => String(c[0])),
    ];
    expect(allSql.some((s) => /INSERT INTO users/i.test(s))).toBe(false);
  });
});
