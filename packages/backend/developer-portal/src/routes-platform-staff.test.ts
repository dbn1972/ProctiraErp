import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeveloperPortalService } from './developer-portal-service.js';
import { developerPortalPlugin } from './developer-portal-plugin.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { isPlatformStaff, roleIdsOf } from './platform-staff.js';

/**
 * PRC-H048: marketplace review/publish and developer-docs mutations require a
 * platform-staff role ID; self-review is rejected; analytics ingest for an
 * unknown plugin is rejected and non-staff ingest is bound to the plugin's own
 * developer API key in the caller's tenant.
 */

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440000';

interface TestPrincipal {
  sub: string;
  email?: string;
  tenantId?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

const TENANT_ADMIN: TestPrincipal = {
  sub: 'tenant-admin-1',
  email: 'admin@school-a.example',
  tenantId: TENANT_A,
  roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'root' }],
};

const PLATFORM_REVIEWER: TestPrincipal = {
  sub: 'platform-reviewer-1',
  email: 'reviewer@proctira.example',
  tenantId: TENANT_B,
  roles: [{ roleId: 'platform_admin', roleName: 'Platform admin', areaId: null }],
};

const SUPER_ADMIN: TestPrincipal = {
  sub: 'super-1',
  email: 'super@proctira.example',
  roles: [{ roleId: 'super-admin', roleName: 'Super admin', areaId: null }],
};

/** roleName claims platform_admin, roleId does not — must not be trusted. */
const ROLE_NAME_SPOOF: TestPrincipal = {
  sub: 'spoof-1',
  tenantId: TENANT_A,
  roles: [{ roleId: 'admin', roleName: 'platform_admin', areaId: 'root' }],
};

const principals = new Map<string, TestPrincipal>();

function as(principal: TestPrincipal): Record<string, string> {
  principals.set(principal.sub, principal);
  return { 'x-test-principal': principal.sub };
}

const submissionInput = (name: string) => ({
  name,
  displayName: 'Plugin',
  category: 'workflow' as const,
  tags: [],
  version: '1.0.0',
  description: 'desc',
  supportedProductVersions: '>=1.0.0',
  requiredPermissions: [],
});

describe('developer-portal routes — platform staff (PRC-H048)', () => {
  let app: FastifyInstance;
  let service: DeveloperPortalService;
  let accountId: string;

  beforeEach(async () => {
    principals.clear();
    app = Fastify({ logger: false });
    // Simulates the gateway auth + tenant plugins for these tests only.
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-principal'];
      const principal = typeof id === 'string' ? principals.get(id) : undefined;
      if (principal) {
        (request as unknown as { user: TestPrincipal }).user = principal;
        if (principal.tenantId) {
          (request as unknown as { tenantId: string }).tenantId = principal.tenantId;
        }
      }
    });
    await app.register(developerPortalPlugin, {
      repository: new InMemoryDeveloperPortalRepository(),
    });
    await app.ready();
    service = app.developerPortalService;
    const account = await service.createAccount({
      email: 'dev@vendor.example',
      name: 'Vendor Dev',
      organization: 'Vendor',
    });
    accountId = account.id;
  });

  afterEach(async () => {
    await app.close();
  });

  async function submit(name: string): Promise<string> {
    const sub = await service.submitPlugin(accountId, submissionInput(name));
    return sub.id;
  }

  async function publishListing(name: string): Promise<void> {
    const id = await submit(name);
    await service.reviewPlugin(id, PLATFORM_REVIEWER.sub, { decision: 'approved' });
    await service.publishPlugin(id);
  }

  describe('role helper', () => {
    it('matches roleId only, never roleName', () => {
      expect(roleIdsOf(ROLE_NAME_SPOOF.roles)).toEqual(['admin']);
      const req = { user: ROLE_NAME_SPOOF } as unknown as Parameters<typeof isPlatformStaff>[0];
      expect(isPlatformStaff(req)).toBe(false);
      const ok = { user: { roles: ['super-admin'] } } as unknown as Parameters<
        typeof isPlatformStaff
      >[0];
      expect(isPlatformStaff(ok)).toBe(true);
    });
  });

  describe('review', () => {
    it('tenant admin → 403', async () => {
      const id = await submit('tenant-review');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as(TENANT_ADMIN),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(403);
      expect((await service.getSubmission(id)).status).toBe('submitted');
    });

    it('roleName spoof → 403', async () => {
      const id = await submit('spoof-review');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as(ROLE_NAME_SPOOF),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('platform reviewer succeeds and is recorded as reviewer', async () => {
      const id = await submit('staff-review');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as(PLATFORM_REVIEWER),
        payload: { decision: 'approved', reviewNotes: 'ok' },
      });
      expect(res.statusCode).toBe(200);
      const stored = await service.getSubmission(id);
      expect(stored.status).toBe('approved');
      expect(stored.reviewedBy).toBe(PLATFORM_REVIEWER.sub);
    });

    it('self-review rejected: reviewer email matches submitting account', async () => {
      const id = await submit('self-email');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as({ ...PLATFORM_REVIEWER, sub: 'staff-dev', email: 'DEV@vendor.example' }),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/self-review/i);
      expect((await service.getSubmission(id)).status).toBe('submitted');
    });

    it('self-review rejected: reviewer subject is the submitting account', async () => {
      const id = await submit('self-sub');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as({ ...PLATFORM_REVIEWER, sub: accountId }),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(403);
    });

    it("self-review rejected: submitting account operates in reviewer's tenant", async () => {
      await service.createApiKey(accountId, TENANT_B, { name: 'k', scopes: ['read'] });
      const id = await submit('self-tenant');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        headers: as(PLATFORM_REVIEWER),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/self-review/i);
    });

    it('anonymous → 401', async () => {
      const id = await submit('anon-review');
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/review`,
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('publish', () => {
    it('tenant admin → 403 even for an approved submission', async () => {
      const id = await submit('tenant-publish');
      await service.reviewPlugin(id, PLATFORM_REVIEWER.sub, { decision: 'approved' });
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/publish`,
        headers: as(TENANT_ADMIN),
      });
      expect(res.statusCode).toBe(403);
      await expect(service.getMarketplaceListing('tenant-publish')).rejects.toThrow();
    });

    it('platform staff publishes an approved submission', async () => {
      const id = await submit('staff-publish');
      await service.reviewPlugin(id, PLATFORM_REVIEWER.sub, { decision: 'approved' });
      const res = await app.inject({
        method: 'POST',
        url: `/developer/submissions/${id}/publish`,
        headers: as(SUPER_ADMIN),
      });
      expect(res.statusCode).toBe(201);
      expect((await service.getMarketplaceListing('staff-publish')).accountId).toBe(accountId);
    });
  });

  describe('docs mutations', () => {
    const docBody = {
      slug: 'getting-started',
      title: 'Getting started',
      content: 'Hello',
      category: 'getting-started',
    };

    async function seedDoc(): Promise<void> {
      await service.createDocPage(
        docBody as Parameters<DeveloperPortalService['createDocPage']>[0],
      );
    }

    it('tenant admin → 403 on POST/PATCH/DELETE', async () => {
      const post = await app.inject({
        method: 'POST',
        url: '/developer/docs',
        headers: as(TENANT_ADMIN),
        payload: docBody,
      });
      expect(post.statusCode).toBe(403);

      await seedDoc();
      const patch = await app.inject({
        method: 'PATCH',
        url: '/developer/docs/getting-started',
        headers: as(TENANT_ADMIN),
        payload: { title: 'Defaced' },
      });
      expect(patch.statusCode).toBe(403);

      const del = await app.inject({
        method: 'DELETE',
        url: '/developer/docs/getting-started',
        headers: as(TENANT_ADMIN),
      });
      expect(del.statusCode).toBe(403);
      expect((await service.getDocPage('getting-started')).title).toBe('Getting started');
    });

    it('platform staff can create, update and delete docs', async () => {
      const post = await app.inject({
        method: 'POST',
        url: '/developer/docs',
        headers: as(PLATFORM_REVIEWER),
        payload: docBody,
      });
      expect(post.statusCode).toBe(201);
      const patch = await app.inject({
        method: 'PATCH',
        url: '/developer/docs/getting-started',
        headers: as(PLATFORM_REVIEWER),
        payload: { title: 'Updated' },
      });
      expect(patch.statusCode).toBe(200);
      const del = await app.inject({
        method: 'DELETE',
        url: '/developer/docs/getting-started',
        headers: as(PLATFORM_REVIEWER),
      });
      expect(del.statusCode).toBe(204);
    });

    it('docs reads stay open to tenant users', async () => {
      await seedDoc();
      const res = await app.inject({
        method: 'GET',
        url: '/developer/docs/getting-started',
        headers: as(TENANT_ADMIN),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('analytics ingest', () => {
    it('unknown plugin → 404 even for platform staff', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: as(PLATFORM_REVIEWER),
        payload: { pluginName: 'ghost-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('unknown plugin → 404 for tenant callers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: as(TENANT_ADMIN),
        payload: { pluginName: 'ghost-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('tenant admin without the plugin key → 403 and install count unchanged', async () => {
      await publishListing('counted-plugin');
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: as(TENANT_ADMIN),
        payload: { pluginName: 'counted-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(403);
      expect((await service.getMarketplaceListing('counted-plugin')).installs).toBe(0);
    });

    it("plugin developer key in the caller's tenant is accepted", async () => {
      await publishListing('keyed-plugin');
      const { rawKey } = await service.createApiKey(accountId, TENANT_A, {
        name: 'ingest',
        scopes: ['analytics'],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: { ...as(TENANT_ADMIN), 'x-developer-api-key': rawKey },
        payload: { pluginName: 'keyed-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(201);
      expect((await service.getMarketplaceListing('keyed-plugin')).installs).toBe(1);
    });

    it('plugin key issued in another tenant → 403', async () => {
      await publishListing('cross-tenant-plugin');
      const { rawKey } = await service.createApiKey(accountId, TENANT_B, {
        name: 'ingest',
        scopes: ['analytics'],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: { ...as(TENANT_ADMIN), 'x-developer-api-key': rawKey },
        payload: { pluginName: 'cross-tenant-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(403);
    });

    it("another developer's key cannot ingest for this plugin → 403", async () => {
      await publishListing('owned-plugin');
      const other = await service.createAccount({
        email: 'other@vendor2.example',
        name: 'Other',
        organization: 'Vendor2',
      });
      const { rawKey } = await service.createApiKey(other.id, TENANT_A, {
        name: 'ingest',
        scopes: ['analytics'],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/developer/analytics/events',
        headers: { ...as(TENANT_ADMIN), 'x-developer-api-key': rawKey },
        payload: { pluginName: 'owned-plugin', eventType: 'install' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
