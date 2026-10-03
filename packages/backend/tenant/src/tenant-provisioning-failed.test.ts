/**
 * PRC-H099: when the rollback cannot remove the never-active tenant row, it is marked
 * 'provisioning_failed' (tenants_status_check, db/sql/114) so it is never left looking
 * in-flight and can never be activated by the provisioning path.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { CreateTenantInput } from './schemas.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';

const input: CreateTenantInput = {
  name: 'District B',
  slug: 'district-b',
  admin: {
    firstName: 'Ravi',
    lastName: 'Admin',
    email: 'admin@district-b.example',
    password: 'Correct-Horse-9',
  },
};

class UndeletableRepository extends InMemoryTenantRepository {
  override async discardProvisioningTenant(): Promise<boolean> {
    throw new Error('delete blocked');
  }
}

describe('createTenant provisioning_failed fallback (PRC-H099)', () => {
  it('marks the tenant provisioning_failed when the rollback delete fails', async () => {
    const repository = new UndeletableRepository();
    const service = new TenantService(
      repository,
      undefined,
      new RecordingAdminProvisioner(new Error('keycloak unavailable')),
    );
    await expect(service.createTenant(input)).rejects.toThrow(/tenant was not activated/);
    const row = await repository.findTenantBySlug('district-b');
    expect(row?.status).toBe('provisioning_failed');
  });
});
