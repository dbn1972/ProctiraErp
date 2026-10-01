/**
 * PRC-H099: createTenant must not discard the required admin user or mark a
 * tenant active before its admin exists.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import type { CreateTenantInput } from './schemas.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';

const input: CreateTenantInput = {
  name: 'District A',
  slug: 'district-a',
  admin: {
    firstName: 'Asha',
    lastName: 'Admin',
    email: 'admin@district-a.example',
    password: 'Correct-Horse-9',
  },
};

describe('createTenant admin provisioning (PRC-H099)', () => {
  it('hands the admin to the provisioner and activates only afterwards', async () => {
    const repository = new InMemoryTenantRepository();
    const provisioner = new RecordingAdminProvisioner();
    const service = new TenantService(repository, undefined, provisioner);

    const tenant = await service.createTenant(input);

    expect(tenant.status).toBe('active');
    expect(provisioner.requests).toEqual([
      { tenantId: tenant.id, slug: 'district-a', name: 'District A', admin: input.admin },
    ]);
  });

  it('refuses to create any record when no provisioner is configured', async () => {
    const repository = new InMemoryTenantRepository();
    const service = new TenantService(repository);

    await expect(service.createTenant(input)).rejects.toThrow(
      /admin provisioning is not configured/,
    );
    expect(await repository.findTenantBySlug('district-a')).toBeNull();
  });

  it('leaves no active (or any) tenant when admin provisioning fails', async () => {
    const repository = new InMemoryTenantRepository();
    const service = new TenantService(
      repository,
      undefined,
      new RecordingAdminProvisioner(new Error('keycloak unavailable')),
    );

    await expect(service.createTenant(input)).rejects.toThrow(/tenant was not activated/);
    expect(await repository.findTenantBySlug('district-a')).toBeNull();
    const all = await repository.listTenants({}, { page: 1, pageSize: 50 });
    expect(all.data.filter((t) => t.status === 'active')).toHaveLength(0);
  });

  it('allows a retry with the same slug after a failed provisioning', async () => {
    const repository = new InMemoryTenantRepository();
    await expect(
      new TenantService(
        repository,
        undefined,
        new RecordingAdminProvisioner(new Error('boom')),
      ).createTenant(input),
    ).rejects.toThrow();

    const tenant = await new TenantService(
      repository,
      undefined,
      new RecordingAdminProvisioner(),
    ).createTenant(input);
    expect(tenant.status).toBe('active');
  });

  it('POST /tenants returns 422 instead of a half tenant when provisioning is unconfigured', async () => {
    const repository = new InMemoryTenantRepository();
    const app = Fastify();
    await registerTenantRoutes(app, { tenantService: new TenantService(repository) });
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/tenants', payload: input });

    expect(response.statusCode).toBe(422);
    expect(await repository.findTenantBySlug('district-a')).toBeNull();
    await app.close();
  });
});
