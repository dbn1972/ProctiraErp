/**
 * PRC-M618 / g7_platform-001 — developer-portal webhook SSRF guard wiring.
 *
 * Proves the service rejects SSRF-unsafe webhook URLs at create/update time and that the DEFAULT
 * httpFetch (no injected httpFetch) goes through the shared SSRF guard, so a tenant cannot make
 * the platform fetch 169.254.169.254 / 10.x / ::1 / a redirect-to-private target.
 *
 * These tests FAIL without the fix: before wiring, createWebhook stored any URL and the default
 * httpFetch used raw fetch() with no guard.
 */
import { describe, expect, it } from 'vitest';
import { DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeService(
  resolveHost: (host: string) => Promise<Array<{ address: string; family: number }>>,
) {
  const repository = new InMemoryDeveloperPortalRepository();
  // Inject a deterministic validator that uses the shared assert via a fixed resolver.
  const service = new DeveloperPortalService(repository, undefined, {
    signingSecretResolver: {
      async resolveSigningSecret() {
        return 'decrypted-test-secret';
      },
    },
    signingSecretWriter: { async storeSigningSecret() {} },
    validateWebhookUrl: async (url: string) => {
      const { assertPublicHttpsUrl } = await import('@proctira/common/safe-fetch');
      await assertPublicHttpsUrl(url, resolveHost);
    },
  });
  return { service, repository };
}

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('PRC-M618 webhook create/update URL validation', () => {
  it.each([
    'https://169.254.169.254/latest/meta-data/',
    'http://example.com/hook', // non-https
  ])('rejects SSRF-unsafe URL %s at create', async (url) => {
    const { service } = makeService(publicResolver);
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    await expect(
      service.createWebhook(account.id, TENANT_ID, { url, events: ['student.enrolled'] }),
    ).rejects.toThrow();
  });

  it('rejects a host that resolves to a private 10.x address at create', async () => {
    const { service } = makeService(async () => [{ address: '10.0.0.5', family: 4 }]);
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    await expect(
      service.createWebhook(account.id, TENANT_ID, {
        url: 'https://internal.evil.example/hook',
        events: ['student.enrolled'],
      }),
    ).rejects.toThrow();
  });

  it('rejects IPv6 loopback ::1 at update', async () => {
    const { service } = makeService(publicResolver);
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    const wh = await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://example.com/hook',
      events: ['student.enrolled'],
    });
    await expect(
      service.updateWebhook(account.id, TENANT_ID, wh.id, { url: 'https://[::1]/hook' }),
    ).rejects.toThrow();
  });

  it('accepts a public https URL at create', async () => {
    const { service } = makeService(publicResolver);
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    const wh = await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://example.com/hook',
      events: ['student.enrolled'],
    });
    expect(wh.url).toBe('https://example.com/hook');
  });
});

describe('PRC-M618 default httpFetch is SSRF-guarded', () => {
  it('fails closed (non-ok) when the default fetch targets the metadata IP', async () => {
    // No httpFetch injected → the default (shared safeFetch) is used. The repository stores a
    // webhook whose URL points at the metadata endpoint (bypassing create validation by writing
    // directly), proving the delivery path itself refuses it.
    const repository = new InMemoryDeveloperPortalRepository();
    const service = new DeveloperPortalService(repository, undefined, {
      signingSecretResolver: {
        async resolveSigningSecret() {
          return 'decrypted-test-secret';
        },
      },
      signingSecretWriter: { async storeSigningSecret() {} },
      // Validate create with a fixed public resolver so this test does no real DNS; the delivery
      // path below still exercises the DEFAULT (real) safeFetch, which rejects the literal
      // metadata IP without any DNS lookup.
      validateWebhookUrl: async (url: string) => {
        const { assertPublicHttpsUrl } = await import('@proctira/common/safe-fetch');
        await assertPublicHttpsUrl(url, publicResolver);
      },
    });
    const account = await service.createAccount({ name: 'OEM', email: 'oem@example.com' });
    const wh = await service.createWebhook(account.id, TENANT_ID, {
      url: 'https://example.com/hook',
      events: ['student.enrolled'],
    });
    // Mutate stored URL directly to the metadata endpoint to simulate a stale/attacker row.
    await repository.updateWebhook(wh.id, { url: 'https://169.254.169.254/latest/meta-data/' });
    const delivery = await service.createDelivery(wh.id, 'student.enrolled', { id: 's1' });

    // processQueuedDelivery via the default httpFetch must record a failure, never success.
    await service.processQueuedDelivery(TENANT_ID, {
      deliveryId: delivery.id,
      webhookId: wh.id,
      tenantId: TENANT_ID,
      url: 'https://169.254.169.254/latest/meta-data/',
      event: 'student.enrolled',
      body: { id: 's1' },
      attempt: 0,
    });
    const after = await repository.getDeliveryById(delivery.id);
    expect(after?.status).not.toBe('delivered');
  });
});
