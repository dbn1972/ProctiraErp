/**
 * PRC-M218 (developer-portal side) — sandbox creation is backed by a real tenant and destroy
 * tears it down; without a provisioner creation fails closed instead of minting a stub.
 *
 * Base: `createSandbox` invented a random tenant id, marked the sandbox active with an endpoint
 * that pointed nowhere, and `destroySandbox` only flipped a status flag.
 */
import { BusinessRuleError } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { developerPortalPlugin } from './developer-portal-plugin.js';
import type { DeveloperAccountEntity } from './developer-portal-repository.js';
import { DEFAULT_CONFIG, DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { recordingSandboxProvisioner } from './sandbox-provisioner.test-support.js';
import { createTestWebhookSigningSecrets } from './webhook-signing-secrets.test-support.js';

function serviceWith(
  repository: InMemoryDeveloperPortalRepository,
  provisioner?: ReturnType<typeof recordingSandboxProvisioner>,
  maxSandboxesPerAccount = DEFAULT_CONFIG.maxSandboxesPerAccount,
) {
  return new DeveloperPortalService(
    repository,
    { ...DEFAULT_CONFIG, maxSandboxesPerAccount },
    {
      signingSecretResolver: createTestWebhookSigningSecrets().secrets,
      sandboxProvisioner: provisioner,
    },
  );
}

describe('PRC-M218: developer sandboxes are real tenants', () => {
  let repository: InMemoryDeveloperPortalRepository;
  let account: DeveloperAccountEntity;

  beforeEach(async () => {
    repository = new InMemoryDeveloperPortalRepository();
    account = await serviceWith(repository).createAccount({
      name: 'Dev',
      email: 'dev@example.com',
      organization: 'Org',
    });
  });

  it('without a provisioner, creation fails closed and nothing is stored', async () => {
    const service = serviceWith(repository);
    await expect(service.createSandbox(account.id, { name: 'S' })).rejects.toThrow(
      BusinessRuleError,
    );
    expect(await service.listSandboxes(account.id)).toHaveLength(0);
  });

  it('a created sandbox points at the provisioned tenant', async () => {
    const provisioner = recordingSandboxProvisioner();
    const sandbox = await serviceWith(repository, provisioner).createSandbox(account.id, {
      name: 'S',
    });
    expect(provisioner.provisioned).toEqual([sandbox.tenantId]);
    expect(sandbox.status).toBe('active');
    expect(sandbox.apiEndpoint).toContain(sandbox.tenantId);
  });

  it('destroy tears the tenant down before marking the sandbox destroyed', async () => {
    const provisioner = recordingSandboxProvisioner();
    const service = serviceWith(repository, provisioner);
    const sandbox = await service.createSandbox(account.id, { name: 'S' });
    const destroyed = await service.destroySandbox(account.id, sandbox.id);
    expect(provisioner.tornDown).toEqual([sandbox.tenantId]);
    expect(destroyed.status).toBe('destroyed');
  });

  it('a failed teardown leaves the sandbox active', async () => {
    const provisioner = recordingSandboxProvisioner({
      teardownSandboxTenant: async () => {
        throw new BusinessRuleError('legal hold');
      },
    });
    const service = serviceWith(repository, provisioner);
    const sandbox = await service.createSandbox(account.id, { name: 'S' });
    await expect(service.destroySandbox(account.id, sandbox.id)).rejects.toThrow(/legal hold/);
    expect((await service.getSandbox(account.id, sandbox.id)).status).toBe('active');
  });

  it('losing the limit race tears the just-provisioned tenant down (no orphan)', async () => {
    const provisioner = recordingSandboxProvisioner();
    const service = serviceWith(repository, provisioner, 1);
    const results = await Promise.allSettled([
      service.createSandbox(account.id, { name: 'a' }),
      service.createSandbox(account.id, { name: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(provisioner.provisioned).toHaveLength(2);
    expect(provisioner.tornDown).toHaveLength(1);
    const kept = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        tenantId: string;
      }>
    ).value.tenantId;
    expect(provisioner.tornDown).not.toContain(kept);
  });

  it('the plugin adapts the root tenantService decorator (gateway wiring)', async () => {
    const created: string[] = [];
    const removed: string[] = [];
    const app = Fastify();
    app.decorate('tenantService', {
      provisionSandboxTenant: async ({ ownerRef }: { name: string; ownerRef: string }) => {
        const id = `00000000-0000-4000-8000-00000000000${created.length}`;
        created.push(`${id}|${ownerRef}`);
        return { id };
      },
      teardownSandboxTenant: async (tenantId: string) => {
        removed.push(tenantId);
      },
    });
    await app.register(developerPortalPlugin, { repository });
    await app.ready();
    const sandbox = await app.developerPortalService.createSandbox(account.id, { name: 'S' });
    expect(created).toHaveLength(1);
    expect(created[0]).toContain(`developer-account:${account.id}`);
    expect(sandbox.tenantId).toBe(created[0]!.split('|')[0]);
    await app.developerPortalService.destroySandbox(account.id, sandbox.id);
    expect(removed).toEqual([sandbox.tenantId]);
    await app.close();
  });
});
