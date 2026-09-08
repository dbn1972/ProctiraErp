import { describe, it, expect, vi } from 'vitest';
import { provisionTenant, type ProvisioningDbClient } from './provisioning.js';

describe('provisionTenant', () => {
  function createMockDb(overrides?: {
    tenantResult?: unknown[];
    areaResult?: unknown[];
    adminResult?: unknown[];
  }): ProvisioningDbClient {
    const tenantResult = overrides?.tenantResult ?? [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Ministry',
        slug: 'test-ministry',
        status: 'active',
        created_at: new Date('2024-01-01'),
      },
    ];

    const areaResult = overrides?.areaResult ?? [
      {
        id: '660e8400-e29b-41d4-a716-446655440000',
        name: 'Test Ministry - Root Area',
        code: 'ROOT',
      },
    ];

    const adminResult = overrides?.adminResult ?? [
      {
        id: '770e8400-e29b-41d4-a716-446655440000',
        email: 'admin@test-ministry.org',
        first_name: 'Admin',
        last_name: 'User',
      },
    ];

    const mockTx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce(tenantResult)
        .mockResolvedValueOnce(areaResult)
        .mockResolvedValueOnce(adminResult),
    };

    return {
      $transaction: vi.fn(async (fn) => fn(mockTx)),
    };
  }

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

  it('should provision a tenant with all required data', async () => {
    const db = createMockDb();
    const result = await provisionTenant(db, validInput);

    expect(result.tenant.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.tenant.name).toBe('Test Ministry');
    expect(result.tenant.slug).toBe('test-ministry');
    expect(result.tenant.status).toBe('active');

    expect(result.rootArea.id).toBe('660e8400-e29b-41d4-a716-446655440000');
    expect(result.rootArea.name).toBe('Test Ministry - Root Area');
    expect(result.rootArea.code).toBe('ROOT');

    expect(result.adminUser.id).toBe('770e8400-e29b-41d4-a716-446655440000');
    expect(result.adminUser.email).toBe('admin@test-ministry.org');
    expect(result.adminUser.firstName).toBe('Admin');
    expect(result.adminUser.lastName).toBe('User');
  });

  it('should run all operations within a transaction', async () => {
    const db = createMockDb();
    await provisionTenant(db, validInput);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('should create tenant record with correct SQL', async () => {
    const db = createMockDb();
    await provisionTenant(db, validInput);

    const txFn = (db.$transaction as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const mockTx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{
          id: 'tid', name: 'Test Ministry', slug: 'test-ministry',
          status: 'active', created_at: new Date(),
        }])
        .mockResolvedValueOnce([{ id: 'aid', name: 'Root', code: 'ROOT' }])
        .mockResolvedValueOnce([{
          id: 'uid', email: 'admin@test.org', first_name: 'A', last_name: 'U',
        }]),
    };

    await txFn(mockTx);

    // First call creates tenant
    const firstCall = mockTx.$queryRawUnsafe.mock.calls[0]!;
    expect(firstCall[0]).toContain('INSERT INTO tenants');
    expect(firstCall[1]).toBe('Test Ministry');
    expect(firstCall[2]).toBe('test-ministry');

    // Second call creates root area
    const secondCall = mockTx.$queryRawUnsafe.mock.calls[1]!;
    expect(secondCall[0]).toContain('INSERT INTO geographic_areas');
    expect(secondCall[2]).toBe('Test Ministry - Root Area');
    expect(secondCall[3]).toBe('ROOT');

    // Third call creates admin user
    const thirdCall = mockTx.$queryRawUnsafe.mock.calls[2]!;
    expect(thirdCall[0]).toContain('INSERT INTO users');
    expect(thirdCall[2]).toBe('admin@test-ministry.org');
  });

  it('binds control-plane scope before the tenants insert and the tenant id after (FORCE RLS)', async () => {
    const db = createMockDb();
    await provisionTenant(db, validInput);

    const txFn = (db.$transaction as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const mockTx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{
          id: 'tid', name: 'Test Ministry', slug: 'test-ministry',
          status: 'active', created_at: new Date(),
        }])
        .mockResolvedValueOnce([{ id: 'aid', name: 'Root', code: 'ROOT' }])
        .mockResolvedValueOnce([{
          id: 'uid', email: 'admin@test.org', first_name: 'A', last_name: 'U',
        }]),
    };
    await txFn(mockTx);

    const gucCalls = mockTx.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(gucCalls[0]).toContain("set_config('app.platform_admin', '1', true)");
    expect(gucCalls[1]).toContain("set_config('app.tenant_id', $1, true)");
    expect(mockTx.$executeRawUnsafe.mock.calls[1]![1]).toBe('tid');
    expect(gucCalls[2]).toContain("set_config('app.current_tenant_id', $1, true)");
    // platform scope is bound before the first INSERT, tenant scope before the second
    expect(mockTx.$executeRawUnsafe.mock.invocationCallOrder[0]!).toBeLessThan(
      mockTx.$queryRawUnsafe.mock.invocationCallOrder[0]!,
    );
    expect(mockTx.$executeRawUnsafe.mock.invocationCallOrder[1]!).toBeLessThan(
      mockTx.$queryRawUnsafe.mock.invocationCallOrder[1]!,
    );
  });

  it('should throw if tenant creation fails', async () => {
    const db = createMockDb({ tenantResult: [] });

    await expect(provisionTenant(db, validInput)).rejects.toThrow(
      'Failed to create tenant record',
    );
  });

  it('should throw if root area creation fails', async () => {
    const db = createMockDb({ areaResult: [] });

    await expect(provisionTenant(db, validInput)).rejects.toThrow(
      'Failed to create root area',
    );
  });

  it('should throw if admin user creation fails', async () => {
    const db = createMockDb({ adminResult: [] });

    await expect(provisionTenant(db, validInput)).rejects.toThrow(
      'Failed to create admin user',
    );
  });

  it('should use empty config when none provided', async () => {
    const db = createMockDb();
    const inputWithoutConfig = { ...validInput, config: undefined };

    await provisionTenant(db, inputWithoutConfig);

    const txFn = (db.$transaction as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const mockTx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{
          id: 'tid', name: 'Test Ministry', slug: 'test-ministry',
          status: 'active', created_at: new Date(),
        }])
        .mockResolvedValueOnce([{ id: 'aid', name: 'Root', code: 'ROOT' }])
        .mockResolvedValueOnce([{
          id: 'uid', email: 'admin@test.org', first_name: 'A', last_name: 'U',
        }]),
    };

    await txFn(mockTx);

    const firstCall = mockTx.$queryRawUnsafe.mock.calls[0]!;
    // Config should be serialized as empty object
    expect(firstCall[3]).toBe('{}');
  });
});
