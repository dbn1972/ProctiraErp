/**
 * Tenant Branding Service Unit Tests (Task 58.2)
 *
 * Service-level coverage for the publish / rollback flow:
 *
 *   - Append-only invariants on the in-memory repository surface.
 *   - Append-only invariants are also enforced at the SQL level by the
 *     migration (`tenant_theme_versions_no_update` + `_no_delete` triggers
 *     and the privilege REVOKE block); those are exercised by the live
 *     PostgreSQL integration suite — this file pins down the in-process
 *     behavior the service relies on.
 *   - Tenant-scope and decommissioned-tenant guards.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError } from '@proctira/common';

import { TenantService } from './tenant-service.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { CreateTenantInput, ThemeTokens } from './schemas.js';

describe('TenantService — branding versioning (Task 58.2)', () => {
  let service: TenantService;
  let repository: InMemoryTenantRepository;
  let tenantId: string;

  const PUBLISHER_ALICE = '11111111-1111-4111-8111-111111111111';
  const PUBLISHER_BOB = '22222222-2222-4222-8222-222222222222';

  const createInput: CreateTenantInput = {
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

  const tokensV1: ThemeTokens = { '--tenant-primary': 'hsl(222, 47%, 31%)' };
  const tokensV2: ThemeTokens = { '--tenant-primary': 'hsl(0, 80%, 45%)' };
  const tokensV3: ThemeTokens = { '--tenant-primary': 'hsl(258, 70%, 50%)' };

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    service = new TenantService(repository);
    const tenant = await service.createTenant(createInput);
    tenantId = tenant.id;
  });

  describe('publishBranding', () => {
    it('inserts an initial revision with revision = 1', async () => {
      const v1 = await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });

      expect(v1.revision).toBe(1);
      expect(v1.tokens).toEqual(tokensV1);
      expect(v1.publishedBy).toBe(PUBLISHER_ALICE);
      expect(v1.publishedAt).toBeInstanceOf(Date);
    });

    it('mirrors the published tokens onto tenant.config.theme', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });

      const tenant = await service.getTenantById(tenantId);
      expect(tenant.config.theme).toEqual(tokensV1);
    });

    it('throws NotFoundError for an unknown tenant', async () => {
      await expect(
        service.publishBranding('00000000-0000-4000-8000-000000000000', {
          tokens: tokensV1,
          publishedBy: PUBLISHER_ALICE,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws BusinessRuleError when the tenant is decommissioned', async () => {
      await service.decommissionTenant(tenantId, {
        reason: 'Test',
        retainDataDays: 0,
      });

      await expect(
        service.publishBranding(tenantId, {
          tokens: tokensV1,
          publishedBy: PUBLISHER_ALICE,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('rollbackBranding', () => {
    it('appends a new audit row carrying the restored tokens', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });

      const audit = await service.rollbackBranding(tenantId, {
        revision: 1,
        publishedBy: PUBLISHER_BOB,
      });

      expect(audit.revision).toBe(3);
      expect(audit.tokens).toEqual(tokensV1);
      expect(audit.publishedBy).toBe(PUBLISHER_BOB);
    });

    it('updates the active theme on tenant.config.theme', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.rollbackBranding(tenantId, {
        revision: 1,
        publishedBy: PUBLISHER_BOB,
      });

      const tenant = await service.getTenantById(tenantId);
      expect(tenant.config.theme).toEqual(tokensV1);
    });

    it('does NOT mutate the original revision row', async () => {
      const v1 = await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.rollbackBranding(tenantId, {
        revision: 1,
        publishedBy: PUBLISHER_BOB,
      });

      // Re-read v1 directly from the repository — the row must be byte-for-byte
      // identical to the one we initially persisted.
      const v1AfterRollback = await repository.findThemeVersion(tenantId, 1);
      expect(v1AfterRollback).not.toBeNull();
      expect(v1AfterRollback!.id).toBe(v1.id);
      expect(v1AfterRollback!.tokens).toEqual(tokensV1);
      expect(v1AfterRollback!.publishedBy).toBe(PUBLISHER_ALICE);
      expect(v1AfterRollback!.publishedAt.toISOString()).toBe(v1.publishedAt.toISOString());
    });

    it('throws NotFoundError when rolling back to a non-existent revision', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });

      await expect(
        service.rollbackBranding(tenantId, {
          revision: 99,
          publishedBy: PUBLISHER_BOB,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws BusinessRuleError for a decommissioned tenant', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.decommissionTenant(tenantId, {
        reason: 'Test',
        retainDataDays: 0,
      });

      await expect(
        service.rollbackBranding(tenantId, {
          revision: 1,
          publishedBy: PUBLISHER_BOB,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('rolls back to the latest revision (no-op tokens, new audit row)', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });

      // Roll back to v2 — same tokens, but the audit row is still appended
      // so the high-risk event (Requirement 33 AC 4) is captured.
      const audit = await service.rollbackBranding(tenantId, {
        revision: 2,
        publishedBy: PUBLISHER_BOB,
      });

      expect(audit.revision).toBe(3);
      expect(audit.tokens).toEqual(tokensV2);

      const versions = await service.listBrandingVersions(tenantId);
      expect(versions).toHaveLength(3);
    });
  });

  describe('listBrandingVersions', () => {
    it('returns versions in chronological revision order', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV3,
        publishedBy: PUBLISHER_ALICE,
      });

      const versions = await service.listBrandingVersions(tenantId);
      expect(versions.map((v) => v.revision)).toEqual([1, 2, 3]);
      expect(versions.map((v) => v.tokens)).toEqual([tokensV1, tokensV2, tokensV3]);
    });

    it('returns an empty array for tenants with no revisions', async () => {
      const versions = await service.listBrandingVersions(tenantId);
      expect(versions).toEqual([]);
    });

    it('throws NotFoundError for an unknown tenant', async () => {
      await expect(
        service.listBrandingVersions('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getActiveBranding', () => {
    it('returns null tokens and revision when nothing has been published', async () => {
      const active = await service.getActiveBranding(tenantId);
      expect(active.tokens).toBeNull();
      expect(active.revision).toBeNull();
    });

    it('returns the most recent published revision after a rollback', async () => {
      await service.publishBranding(tenantId, {
        tokens: tokensV1,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.publishBranding(tenantId, {
        tokens: tokensV2,
        publishedBy: PUBLISHER_ALICE,
      });
      await service.rollbackBranding(tenantId, {
        revision: 1,
        publishedBy: PUBLISHER_BOB,
      });

      const active = await service.getActiveBranding(tenantId);
      expect(active.tokens).toEqual(tokensV1);
      expect(active.revision).toBe(3);
    });
  });
});
