/**
 * Live smoke for PgTenantRepository against DATABASE_URL (skipped otherwise) — G-704.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { PgTenantRepository } from './pg-tenant-repository.js';
import type { TenantConfig, ThemeTokens } from './schemas.js';

const pool = getSharedPgPool();

const config = {
  branding: {},
  locale: { defaultLocale: 'en', supportedLocales: ['en'], timezone: 'UTC' },
  features: {},
  security: {},
} as unknown as TenantConfig;

describe('PgTenantRepository (live)', () => {
  it.skipIf(!pool)('persists tenants, domains, usage, theme versions and drafts', async () => {
    const repo = new PgTenantRepository(pool!);
    const id = randomUUID();
    const slug = `t-${id.slice(0, 8)}`;

    const created = await repo.createTenant({
      id,
      name: 'Live Tenant',
      slug,
      status: 'active',
      plan: 'standard',
      region: 'ap-south-1',
      config,
      suspendedAt: null,
      suspendedReason: null,
      decommissionedAt: null,
      dataRetentionUntil: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect((await repo.findTenantBySlug(slug.toUpperCase()))?.id).toBe(id);

    const suspended = await repo.updateTenant(id, {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: 'billing',
    });
    expect(suspended?.status).toBe('suspended');
    expect(suspended?.suspendedAt).toBeInstanceOf(Date);

    const list = await repo.listTenants({ status: 'suspended', search: slug }, { page: 1, pageSize: 5 });
    expect(list.data.map((t) => t.id)).toContain(id);

    const domainId = randomUUID();
    await repo.addDomain({
      id: domainId,
      tenantId: id,
      domain: `${slug}.example.edu`,
      primary: true,
      verified: false,
      createdAt: new Date(),
    });
    expect((await repo.findDomainByName(`${slug}.EXAMPLE.edu`))?.id).toBe(domainId);
    expect(await repo.removeDomain(randomUUID(), domainId)).toBe(false);
    expect(await repo.removeDomain(id, domainId)).toBe(true);

    const usage = await repo.updateUsage(id, { activeUsers: 12 });
    expect(usage.activeUsers).toBe(12);
    expect((await repo.getOrCreateUsage(id)).activeUsers).toBe(12);

    const tokens = { colors: { primary: '#123456' } } as unknown as ThemeTokens;
    const v1 = await repo.insertThemeVersion({ tenantId: id, tokens, publishedBy: 'admin' });
    const v2 = await repo.insertThemeVersion({ tenantId: id, tokens, publishedBy: 'admin' });
    expect([v1.revision, v2.revision]).toEqual([1, 2]);
    expect((await repo.findLatestThemeVersion(id))?.revision).toBe(2);

    await repo.upsertBrandingDraft({ tenantId: id, tokens, savedBy: 'admin' });
    expect((await repo.findBrandingDraft(id))?.savedBy).toBe('admin');
    expect(await repo.deleteBrandingDraft(id)).toBe(true);

    expect(await repo.deleteTenant(id)).toBe(true);
    expect(await repo.findTenantById(id)).toBeNull();
  });
});
