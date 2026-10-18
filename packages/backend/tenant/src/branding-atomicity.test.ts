/**
 * PRC-L168 — publish/rollback branding must not clobber a concurrent config
 * change.
 *
 * FAILING-FIRST: `publishBranding` reads the tenant, inserts a theme version,
 * then mirrors the theme onto `tenant.config` with `updateTenant`. The
 * unmodified code builds that mirror write from the STALE `tenant.config`
 * captured before the insert, so a concurrent `updateConfig` that lands
 * between the read and the mirror write is overwritten. The wrapper below
 * injects exactly that interleaving (it fires a concurrent `updateConfig`
 * while `insertThemeVersion` is in flight) and asserts the concurrent change
 * SURVIVES. On current code it is clobbered → the test fails. After the fix
 * re-reads the config immediately before the mirror write, only `theme` is
 * overwritten and the concurrent change is preserved.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { TenantThemeVersionEntity } from './tenant-repository.js';
import { TenantService } from './tenant-service.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';

const PUBLISHER = '11111111-1111-4111-8111-111111111111';

/**
 * Wraps the in-memory repo so a single `insertThemeVersion` call runs an
 * injected side effect (a concurrent config mutation) before it returns,
 * reproducing a write that lands between the service's read and mirror write.
 */
class InterleavingRepo extends InMemoryTenantRepository {
  public onInsert: (() => Promise<void>) | null = null;

  override async insertThemeVersion(
    data: Parameters<InMemoryTenantRepository['insertThemeVersion']>[0],
  ): Promise<TenantThemeVersionEntity> {
    const version = await super.insertThemeVersion(data);
    if (this.onInsert) {
      const fn = this.onInsert;
      this.onInsert = null;
      await fn();
    }
    return version;
  }
}

async function activeTenant(repo: InterleavingRepo) {
  const service = new TenantService(repo, undefined, new RecordingAdminProvisioner());
  const tenant = await service.createTenant({
    name: 'Acme',
    slug: 'acme',
    admin: {
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@acme.test',
      password: 'password123',
    },
  });
  return { service, tenant };
}

describe('publish/rollback branding atomicity (PRC-L168)', () => {
  it('publishBranding preserves a concurrent non-theme config change', async () => {
    const repo = new InterleavingRepo();
    const { service, tenant } = await activeTenant(repo);

    // A concurrent admin flips a non-theme flag while the publish is mid-flight.
    repo.onInsert = async () => {
      await service.updateConfig(tenant.id, { features: { modules: {}, webhooks: true } });
    };

    await service.publishBranding(tenant.id, {
      tokens: { primaryColor: '#123456' },
      publishedBy: PUBLISHER,
    });

    const config = await service.getConfig(tenant.id);
    // The concurrent change must survive…
    expect(config.features?.webhooks).toBe(true);
    // …and the published theme must be applied.
    expect(config.theme).toMatchObject({ primaryColor: '#123456' });
  });

  it('rollbackBranding preserves a concurrent non-theme config change', async () => {
    const repo = new InterleavingRepo();
    const { service, tenant } = await activeTenant(repo);

    // Seed two revisions so there is a prior revision to roll back to.
    await service.publishBranding(tenant.id, {
      tokens: { primaryColor: '#aaaaaa' },
      publishedBy: PUBLISHER,
    });
    await service.publishBranding(tenant.id, {
      tokens: { primaryColor: '#bbbbbb' },
      publishedBy: PUBLISHER,
    });

    repo.onInsert = async () => {
      await service.updateConfig(tenant.id, { features: { modules: {}, webhooks: true } });
    };

    await service.rollbackBranding(tenant.id, { revision: 1, publishedBy: PUBLISHER });

    const config = await service.getConfig(tenant.id);
    expect(config.features?.webhooks).toBe(true);
    expect(config.theme).toMatchObject({ primaryColor: '#aaaaaa' });
  });
});
