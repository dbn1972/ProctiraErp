/**
 * PRC-L559: plugin analytics metadata is stored redacted, and webhook delivery
 * listings do not echo personal data from the delivered payload.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { developerPortalPlugin } from './developer-portal-plugin.js';
import { DEFAULT_CONFIG, DeveloperPortalService } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import { REDACTED, redactPayload } from './payload-redaction.js';
import { recordingSandboxProvisioner } from './sandbox-provisioner.test-support.js';
import { createTestWebhookSigningSecrets } from './webhook-signing-secrets.test-support.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = randomUUID();

const personalPayload = {
  studentId: STUDENT_ID,
  status: 'enrolled',
  firstName: 'Asha',
  guardian: { phone: '+91 98000 00000', email: 'ravi@example.com' },
  note: 'call ravi@example.com or +91 98000 00000',
};

describe('PRC-L559 redactPayload', () => {
  it('masks personal keys and contact details in text, keeps ids and attributes', () => {
    expect(redactPayload(personalPayload)).toEqual({
      studentId: STUDENT_ID,
      status: 'enrolled',
      firstName: REDACTED,
      guardian: REDACTED,
      note: `call ${REDACTED} or ${REDACTED}`,
    });
  });
});

describe('PRC-L559 analytics metadata is stored redacted', () => {
  it('recordAnalyticsEvent persists no personal data', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const service = new DeveloperPortalService(repository, DEFAULT_CONFIG, {
      signingSecretResolver: createTestWebhookSigningSecrets().secrets,
      sandboxProvisioner: recordingSandboxProvisioner(),
    });
    const account = await service.createAccount({ name: 'Dev', email: 'dev@example.com' });
    const sub = await service.submitPlugin(account.id, {
      name: 'analytics-plugin',
      version: '1.0.0',
      displayName: 'Analytics Plugin',
      description: 'Plugin for analytics testing',
      category: 'reporting',
      supportedProductVersions: '>=1.0.0',
      requiredPermissions: [],
    });
    await service.reviewPlugin(sub.id, 'reviewer', { decision: 'approved' });
    await service.publishPlugin(sub.id);

    const event = await service.recordAnalyticsEvent({
      pluginName: 'analytics-plugin',
      eventType: 'page_view',
      metadata: personalPayload,
    });
    const serialized = JSON.stringify(event.metadata);
    expect(serialized).not.toContain('Asha');
    expect(serialized).not.toContain('ravi@example.com');
    expect(serialized).not.toContain('98000');
    expect(event.metadata).toMatchObject({ studentId: STUDENT_ID, status: 'enrolled' });
  });
});

describe('PRC-L559 delivery listing is redacted', () => {
  let app: FastifyInstance;
  let repository: InMemoryDeveloperPortalRepository;
  const ownerSub = 'owner-l559';

  beforeEach(async () => {
    repository = new InMemoryDeveloperPortalRepository();
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { sub: ownerSub };
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await app.register(developerPortalPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET deliveries does not echo names or contact details', async () => {
    const account = await app.developerPortalService.createAccount(
      { name: 'Dev', email: 'dev-l559@example.com' },
      ownerSub,
    );
    const webhookId = randomUUID();
    const now = new Date();
    await repository.createWebhook({
      id: webhookId,
      tenantId: TENANT,
      accountId: account.id,
      url: 'https://hooks.example.com/in',
      events: ['student.created'],
      secretHash: 'x',
      description: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createDelivery({
      id: randomUUID(),
      webhookId,
      event: 'student.created',
      payload: personalPayload,
      status: 'delivered',
      httpStatus: 200,
      attempts: 1,
      lastAttemptAt: now,
      nextRetryAt: null,
      createdAt: now,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/developer/accounts/${account.id}/webhooks/${webhookId}/deliveries`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).not.toContain('Asha');
    expect(body).not.toContain('ravi@example.com');
    expect(body).toContain(STUDENT_ID);
  });
});
