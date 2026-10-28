/**
 * PRC-M218 (tenant side) — sandbox tenants are real, isolated tenants with real teardown.
 */
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { TenantDefaultsSeeder } from './tenant-provisioner.js';
import { TenantService } from './tenant-service.js';

class RecordingSeeder implements TenantDefaultsSeeder {
  seeded: string[] = [];
  removed: string[] = [];
  async seedTenantDefaults(tenant: { id: string }): Promise<void> {
    this.seeded.push(tenant.id);
  }
  async removeTenantDefaults(tenantId: string): Promise<void> {
    this.removed.push(tenantId);
  }
}

describe('PRC-M218: sandbox tenant provisioning and teardown', () => {
  let repository: InMemoryTenantRepository;
  let seeder: RecordingSeeder;
  let service: TenantService;

  beforeEach(() => {
    repository = new InMemoryTenantRepository();
    seeder = new RecordingSeeder();
    service = new TenantService(repository, undefined, undefined, seeder);
  });

  it('provisions a distinct, active, seeded tenant flagged as a sandbox', async () => {
    const a = await service.provisionSandboxTenant({ name: 'Sandbox A', ownerRef: 'acct-1' });
    const b = await service.provisionSandboxTenant({ name: 'Sandbox B', ownerRef: 'acct-1' });
    expect(a.id).not.toBe(b.id);
    for (const t of [a, b]) {
      const stored = await repository.findTenantById(t.id);
      expect(stored).toMatchObject({ status: 'active', sandbox: true, plan: 'sandbox' });
      expect(stored?.slug).toMatch(/^sbx-[0-9a-f]{12}$/);
    }
    expect(seeder.seeded).toEqual([a.id, b.id]);
  });

  it('the sandbox flag survives later updates', async () => {
    const t = await service.provisionSandboxTenant({ name: 'Sandbox', ownerRef: 'acct-1' });
    await service.updateTenant(t.id, { name: 'Renamed' });
    expect((await repository.findTenantById(t.id))?.sandbox).toBe(true);
  });

  it('teardown decommissions and permanently deletes the tenant and its defaults', async () => {
    const t = await service.provisionSandboxTenant({ name: 'Sandbox', ownerRef: 'acct-1' });
    await service.teardownSandboxTenant(t.id);
    expect(await repository.findTenantById(t.id)).toBeNull();
    expect(seeder.removed).toEqual([t.id]);
  });

  it('teardown refuses a tenant that is not a sandbox', async () => {
    const real = await repository.createTenant({
      id: '5f0b3a2e-9a43-4c1e-8d5b-1f4c3c2b1a00',
      name: 'Real school',
      slug: 'real-school',
      status: 'active',
      plan: null,
      region: null,
      config: {} as never,
      suspendedAt: null,
      suspendedReason: null,
      decommissionedAt: null,
      dataRetentionUntil: null,
      legalHold: false,
    });
    await expect(service.teardownSandboxTenant(real.id)).rejects.toThrow(BusinessRuleError);
    expect((await repository.findTenantById(real.id))?.status).toBe('active');
  });

  it('teardown still honours legal hold', async () => {
    const t = await service.provisionSandboxTenant({ name: 'Sandbox', ownerRef: 'acct-1' });
    await service.setLegalHold(t.id, true);
    await expect(service.teardownSandboxTenant(t.id)).rejects.toThrow(/legal hold/i);
    expect(await repository.findTenantById(t.id)).not.toBeNull();
  });

  it('a failed seed removes the never-active sandbox tenant', async () => {
    const failing = new TenantService(repository, undefined, undefined, {
      seedTenantDefaults: async () => {
        throw new Error('seed failed');
      },
    });
    await expect(
      failing.provisionSandboxTenant({ name: 'Broken', ownerRef: 'acct-1' }),
    ).rejects.toThrow(BusinessRuleError);
    const all = await repository.listTenants({}, { page: 1, pageSize: 50 });
    expect(all.data).toHaveLength(0);
  });
});
