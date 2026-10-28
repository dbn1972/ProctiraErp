/**
 * PRC-L372 — decommission honours `exportData` and its lifecycle promises.
 *
 * Base: `exportData` (schema default true) was accepted and ignored — no export ran, nothing
 * recorded it, and permanent deletion could destroy data whose export had been requested.
 * Custom domains also kept their verified state after decommission.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { createPublicTenantResolver } from './public-tenant-resolver.js';
import type { TenantEntity } from './tenant-repository.js';
import { TenantService, type TenantDataExporter } from './tenant-service.js';

const HOST = 'admissions.decom.example';

async function seed(repository: InMemoryTenantRepository): Promise<string> {
  const id = randomUUID();
  await repository.createTenant({
    id,
    name: 'Decom',
    slug: `decom-${id.slice(0, 6)}`,
    status: 'active',
    plan: null,
    region: null,
    config: {} as TenantEntity['config'],
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
  });
  return id;
}

async function expireRetention(repository: InMemoryTenantRepository, id: string) {
  await repository.updateTenant(id, { dataRetentionUntil: new Date(Date.now() - 86_400_000) });
}

describe('PRC-L372: decommission exportData', () => {
  let repository: InMemoryTenantRepository;
  beforeEach(() => {
    repository = new InMemoryTenantRepository();
  });

  it('runs the configured exporter before the status changes and records the export', async () => {
    const calls: string[] = [];
    const exporter: TenantDataExporter = {
      exportTenantData: async (tenantId) => {
        calls.push(tenantId);
        const current = await repository.findTenantById(tenantId);
        expect(current?.status).toBe('active'); // export happens before decommission
        return { exportId: 'exp-1', location: 's3://exports/exp-1' };
      },
    };
    const id = await seed(repository);
    const service = new TenantService(repository, undefined, undefined, undefined, {
      dataExporter: exporter,
    });
    const updated = await service.decommissionTenant(id, { reason: 'Contract ended' });
    expect(calls).toEqual([id]);
    expect(updated.status).toBe('decommissioned');
    expect(updated.dataExport).toMatchObject({ status: 'completed', exportId: 'exp-1' });
  });

  it('a failing export aborts the decommission (status unchanged)', async () => {
    const id = await seed(repository);
    const service = new TenantService(repository, undefined, undefined, undefined, {
      dataExporter: {
        exportTenantData: async () => {
          throw new Error('bucket unavailable');
        },
      },
    });
    await expect(service.decommissionTenant(id, { reason: 'x' })).rejects.toThrow(
      BusinessRuleError,
    );
    expect((await repository.findTenantById(id))?.status).toBe('active');
  });

  it('without an exporter the requested export stays pending and blocks permanent deletion', async () => {
    const id = await seed(repository);
    const service = new TenantService(repository);
    const updated = await service.decommissionTenant(id, { reason: 'x', retainDataDays: 0 });
    expect(updated.dataExport?.status).toBe('pending');
    await expireRetention(repository, id);
    await expect(service.deleteTenant(id)).rejects.toThrow(/data export has not completed/);
    expect(await repository.findTenantById(id)).not.toBeNull();
  });

  it('exportData: false records a waiver and deletion follows the normal retention rules', async () => {
    const id = await seed(repository);
    const service = new TenantService(repository);
    const updated = await service.decommissionTenant(id, {
      reason: 'x',
      retainDataDays: 0,
      exportData: false,
    });
    expect(updated.dataExport?.status).toBe('waived');
    await expireRetention(repository, id);
    await expect(service.deleteTenant(id)).resolves.toBeUndefined();
  });
});

describe('PRC-L372: decommission lifecycle effects', () => {
  it('custom domains are unverified and stop resolving at once (warm cache)', async () => {
    const repository = new InMemoryTenantRepository();
    const id = await seed(repository);
    await repository.addDomain({
      id: randomUUID(),
      tenantId: id,
      domain: HOST,
      primary: true,
      verified: true,
      verifiedAt: new Date(),
      verificationExpiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    const resolver = createPublicTenantResolver({ repository, baseDomain: 'apply.example.edu' });
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(id);
    const service = new TenantService(repository);
    await service.decommissionTenant(id, { reason: 'x', exportData: false });
    expect((await repository.findDomainsByTenant(id))[0]?.verified).toBe(false);
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();
  });

  it('notifies status listeners with the blocking status (gateway session revocation hook)', async () => {
    const repository = new InMemoryTenantRepository();
    const id = await seed(repository);
    const service = new TenantService(repository);
    const seen: Array<[string, string]> = [];
    service.onStatusChange((tenantId, status) => {
      seen.push([tenantId, status]);
    });
    await service.decommissionTenant(id, { reason: 'x', exportData: false });
    expect(seen).toEqual([[id, 'decommissioned']]);
  });
});
