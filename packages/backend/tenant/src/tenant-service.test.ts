/**
 * Tenant Service Unit Tests
 *
 * Tests the business logic for tenant lifecycle management including:
 * - Tenant creation and provisioning
 * - Tenant updates
 * - Lifecycle transitions (suspend, reactivate, decommission, delete)
 * - Configuration management
 * - Domain management
 * - Usage dashboard
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { TenantService } from './tenant-service.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { CreateTenantInput } from './schemas.js';

describe('TenantService', () => {
  let service: TenantService;
  let repository: InMemoryTenantRepository;

  const validCreateInput: CreateTenantInput = {
    name: 'Ministry of Education',
    slug: 'ministry-edu',
    plan: 'professional',
    region: 'us-east-1',
    admin: {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@ministry-edu.org',
      password: 'SecureP@ss123',
    },
  };

  beforeEach(() => {
    repository = new InMemoryTenantRepository();
    service = new TenantService(repository);
  });

  // ─── Tenant Creation ─────────────────────────────────────────────────────

  describe('createTenant', () => {
    it('should create a tenant with active status after provisioning', async () => {
      const tenant = await service.createTenant(validCreateInput);

      expect(tenant.id).toBeDefined();
      expect(tenant.name).toBe('Ministry of Education');
      expect(tenant.slug).toBe('ministry-edu');
      expect(tenant.status).toBe('active');
      expect(tenant.plan).toBe('professional');
      expect(tenant.region).toBe('us-east-1');
    });

    it('should apply default configuration when none provided', async () => {
      const input: CreateTenantInput = {
        name: 'Test Org',
        slug: 'test-org',
        admin: {
          firstName: 'Admin',
          lastName: 'User',
          email: 'admin@test.org',
          password: 'SecureP@ss123',
        },
      };

      const tenant = await service.createTenant(input);

      expect(tenant.config.locale?.defaultLocale).toBe('en');
      expect(tenant.config.locale?.timezone).toBe('UTC');
      expect(tenant.config.features?.customFields).toBe(true);
      expect(tenant.config.security?.passwordMinLength).toBe(12);
    });

    it('should merge user config with defaults', async () => {
      const input: CreateTenantInput = {
        ...validCreateInput,
        config: {
          locale: {
            defaultLocale: 'ar',
            supportedLocales: ['ar', 'en'],
            timezone: 'Asia/Riyadh',
          },
        },
      };

      const tenant = await service.createTenant(input);

      expect(tenant.config.locale?.defaultLocale).toBe('ar');
      expect(tenant.config.locale?.timezone).toBe('Asia/Riyadh');
      // Defaults should still be applied for other sections
      expect(tenant.config.security?.passwordMinLength).toBe(12);
    });

    it('should throw ConflictError if slug already exists', async () => {
      await service.createTenant(validCreateInput);

      await expect(
        service.createTenant({ ...validCreateInput, name: 'Different Name' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  // ─── Tenant Update ───────────────────────────────────────────────────────

  describe('updateTenant', () => {
    it('should update tenant name', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const updated = await service.updateTenant(tenant.id, { name: 'Updated Ministry' });

      expect(updated.name).toBe('Updated Ministry');
      expect(updated.slug).toBe('ministry-edu'); // Slug is immutable
    });

    it('should throw NotFoundError for non-existent tenant', async () => {
      await expect(
        service.updateTenant('00000000-0000-4000-8000-000000000000', { name: 'Test' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError for decommissioned tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });

      await expect(service.updateTenant(tenant.id, { name: 'Updated' })).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  // ─── Tenant Retrieval ────────────────────────────────────────────────────

  describe('getTenantById', () => {
    it('should return tenant by ID', async () => {
      const created = await service.createTenant(validCreateInput);
      const tenant = await service.getTenantById(created.id);

      expect(tenant.id).toBe(created.id);
      expect(tenant.name).toBe('Ministry of Education');
    });

    it('should throw NotFoundError for non-existent tenant', async () => {
      await expect(service.getTenantById('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ─── Tenant Listing ──────────────────────────────────────────────────────

  describe('listTenants', () => {
    it('should list tenants with pagination', async () => {
      await service.createTenant(validCreateInput);
      await service.createTenant({
        ...validCreateInput,
        name: 'Second Org',
        slug: 'second-org',
      });

      const result = await service.listTenants({}, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('should filter by status', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.createTenant({
        ...validCreateInput,
        name: 'Second Org',
        slug: 'second-org',
      });
      await service.suspendTenant(tenant.id, { reason: 'Test' });

      const result = await service.listTenants({ status: 'suspended' }, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.status).toBe('suspended');
    });

    it('should filter by search term', async () => {
      await service.createTenant(validCreateInput);
      await service.createTenant({
        ...validCreateInput,
        name: 'School District',
        slug: 'school-district',
      });

      const result = await service.listTenants({ search: 'ministry' }, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('Ministry of Education');
    });
  });

  // ─── Lifecycle: Suspend ──────────────────────────────────────────────────

  describe('suspendTenant', () => {
    it('should suspend an active tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const suspended = await service.suspendTenant(tenant.id, { reason: 'Non-payment' });

      expect(suspended.status).toBe('suspended');
      expect(suspended.suspendedAt).toBeDefined();
      expect(suspended.suspendedReason).toBe('Non-payment');
    });

    it('should throw BusinessRuleError if tenant is not active', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.suspendTenant(tenant.id, { reason: 'Test' });

      await expect(service.suspendTenant(tenant.id, { reason: 'Again' })).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should throw NotFoundError for non-existent tenant', async () => {
      await expect(
        service.suspendTenant('00000000-0000-4000-8000-000000000000', { reason: 'Test' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Lifecycle: Reactivate ───────────────────────────────────────────────

  describe('reactivateTenant', () => {
    it('should reactivate a suspended tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.suspendTenant(tenant.id, { reason: 'Test' });
      const reactivated = await service.reactivateTenant(tenant.id);

      expect(reactivated.status).toBe('active');
      expect(reactivated.suspendedAt).toBeNull();
      expect(reactivated.suspendedReason).toBeNull();
    });

    it('should throw BusinessRuleError if tenant is not suspended', async () => {
      const tenant = await service.createTenant(validCreateInput);

      await expect(service.reactivateTenant(tenant.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Lifecycle: Decommission ─────────────────────────────────────────────

  describe('decommissionTenant', () => {
    it('should decommission a tenant with retention period', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const decommissioned = await service.decommissionTenant(tenant.id, {
        reason: 'Contract ended',
        retainDataDays: 60,
      });

      expect(decommissioned.status).toBe('decommissioned');
      expect(decommissioned.decommissionedAt).toBeDefined();
      expect(decommissioned.dataRetentionUntil).toBeDefined();
    });

    it('should throw BusinessRuleError if already decommissioned', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });

      await expect(
        service.decommissionTenant(tenant.id, { reason: 'Again', retainDataDays: 0 }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should allow decommissioning a suspended tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.suspendTenant(tenant.id, { reason: 'Test' });
      const decommissioned = await service.decommissionTenant(tenant.id, {
        reason: 'Final',
        retainDataDays: 30,
      });

      expect(decommissioned.status).toBe('decommissioned');
    });
  });

  // ─── Lifecycle: Delete ───────────────────────────────────────────────────

  describe('deleteTenant', () => {
    it('should delete a decommissioned tenant past retention', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });

      // Manually set retention to past date for testing
      await repository.updateTenant(tenant.id, {
        dataRetentionUntil: new Date(Date.now() - 86400000), // Yesterday
      });

      await expect(service.deleteTenant(tenant.id)).resolves.toBeUndefined();

      await expect(service.getTenantById(tenant.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if not decommissioned', async () => {
      const tenant = await service.createTenant(validCreateInput);

      await expect(service.deleteTenant(tenant.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError if retention period has not passed', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 30 });

      await expect(service.deleteTenant(tenant.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when legal hold is active (W1-SEC-06)', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });
      await repository.updateTenant(tenant.id, {
        dataRetentionUntil: new Date(Date.now() - 86400000),
      });
      await service.setLegalHold(tenant.id, true);
      await expect(service.deleteTenant(tenant.id)).rejects.toThrow(/legal hold/i);
    });

    it('should consult destructiveDeleteGuard when wired (W1-SEC-06)', async () => {
      const guard = {
        assertDestructiveDeleteAllowed: async () => {
          throw new BusinessRuleError('Destructive delete blocked: privacy legal hold');
        },
      };
      const guarded = new TenantService(repository, guard);
      const tenant = await guarded.createTenant({
        ...validCreateInput,
        slug: `hold-${Date.now().toString(36)}`,
      });
      await guarded.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });
      await repository.updateTenant(tenant.id, {
        dataRetentionUntil: new Date(Date.now() - 86400000),
      });
      await expect(guarded.deleteTenant(tenant.id)).rejects.toThrow(/legal hold/i);
    });
  });

  // ─── Configuration Management ────────────────────────────────────────────

  describe('updateConfig', () => {
    it('should update branding configuration', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const updated = await service.updateConfig(tenant.id, {
        branding: {
          primaryColor: '#003366',
          logoUrl: 'https://example.com/logo.png',
        },
      });

      expect(updated.config.branding?.primaryColor).toBe('#003366');
      expect(updated.config.branding?.logoUrl).toBe('https://example.com/logo.png');
      // Other config sections should be preserved
      expect(updated.config.locale?.defaultLocale).toBe('en');
    });

    it('should update locale configuration', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const updated = await service.updateConfig(tenant.id, {
        locale: {
          defaultLocale: 'fr',
          supportedLocales: ['fr', 'en'],
          timezone: 'Europe/Paris',
        },
      });

      expect(updated.config.locale?.defaultLocale).toBe('fr');
      expect(updated.config.locale?.timezone).toBe('Europe/Paris');
    });

    it('should throw BusinessRuleError for decommissioned tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });

      await expect(
        service.updateConfig(tenant.id, { branding: { primaryColor: '#000000' } }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('getConfig', () => {
    it('should return tenant configuration', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const config = await service.getConfig(tenant.id);

      expect(config.locale?.defaultLocale).toBe('en');
      expect(config.features?.customFields).toBe(true);
    });

    it('should throw NotFoundError for non-existent tenant', async () => {
      await expect(service.getConfig('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ─── Domain Management ───────────────────────────────────────────────────

  describe('addDomain', () => {
    it('should add a domain to a tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const domain = await service.addDomain(tenant.id, {
        domain: 'edu.ministry.gov',
        primary: true,
      });

      expect(domain.domain).toBe('edu.ministry.gov');
      expect(domain.primary).toBe(true);
      expect(domain.verified).toBe(false);
      expect(domain.tenantId).toBe(tenant.id);
    });

    it('should throw ConflictError if domain already exists', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.addDomain(tenant.id, { domain: 'edu.ministry.gov' });

      await expect(service.addDomain(tenant.id, { domain: 'edu.ministry.gov' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('should throw BusinessRuleError for decommissioned tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.decommissionTenant(tenant.id, { reason: 'Test', retainDataDays: 0 });

      await expect(service.addDomain(tenant.id, { domain: 'test.com' })).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('removeDomain', () => {
    it('should remove a domain from a tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const domain = await service.addDomain(tenant.id, { domain: 'edu.ministry.gov' });

      await expect(service.removeDomain(tenant.id, domain.id)).resolves.toBeUndefined();

      const domains = await service.listDomains(tenant.id);
      expect(domains).toHaveLength(0);
    });

    it('should throw NotFoundError for non-existent domain', async () => {
      const tenant = await service.createTenant(validCreateInput);

      await expect(
        service.removeDomain(tenant.id, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listDomains', () => {
    it('should list all domains for a tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      await service.addDomain(tenant.id, { domain: 'edu.ministry.gov' });
      await service.addDomain(tenant.id, { domain: 'schools.ministry.gov' });

      const domains = await service.listDomains(tenant.id);
      expect(domains).toHaveLength(2);
    });
  });

  // ─── Usage Dashboard ─────────────────────────────────────────────────────

  describe('getUsage', () => {
    it('should return usage metrics for a tenant', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const usage = await service.getUsage(tenant.id);

      expect(usage.tenantId).toBe(tenant.id);
      expect(usage.storage.usedBytes).toBe(0);
      expect(usage.users.active).toBe(0);
      expect(usage.apiCalls.current).toBe(0);
      expect(usage.lastUpdated).toBeDefined();
    });

    it('should throw NotFoundError for non-existent tenant', async () => {
      await expect(service.getUsage('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ─── Response Formatting ─────────────────────────────────────────────────

  describe('formatTenantResponse', () => {
    it('should format tenant entity to response shape', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const response = service.formatTenantResponse(tenant);

      expect(response.id).toBe(tenant.id);
      expect(response.name).toBe('Ministry of Education');
      expect(response.slug).toBe('ministry-edu');
      expect(response.status).toBe('active');
      expect(response.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.suspendedAt).toBeNull();
      expect(response.decommissionedAt).toBeNull();
    });
  });

  // ─── Read/write agreement ────────────────────────────────────────────────
  describe('a repository whose write finds less than its read', () => {
    /**
     * Every mutator here does "find, gate, update, return". The update used to be
     * returned through a `!` assertion, so a repository that resolves a tenant on read
     * and then declines the write handed the route layer a null to dereference: a
     * TypeError, not an AppError, so Fastify answered 500. `PgTenantRepository` could
     * do exactly that once `findTenantById` consulted the `tenants` table while
     * `updateTenant` consulted only control-plane documents.
     */
    function repositoryThatCannotWrite(base: InMemoryTenantRepository): InMemoryTenantRepository {
      const proxy = Object.create(base) as InMemoryTenantRepository;
      proxy.updateTenant = () => Promise.resolve(null);
      return proxy;
    }

    it('reports a 404, not a dereferenced null, when the write resolves nothing', async () => {
      const tenant = await service.createTenant(validCreateInput);
      const brokenService = new TenantService(repositoryThatCannotWrite(repository));

      // Each of these gates passes, so each reaches the write.
      await expect(
        brokenService.updateConfig(tenant.id, { branding: { primaryColor: '#123456' } }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(brokenService.setLegalHold(tenant.id, true)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        brokenService.suspendTenant(tenant.id, { reason: 'unpaid' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        brokenService.decommissionTenant(tenant.id, { reason: 'contract ended' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
