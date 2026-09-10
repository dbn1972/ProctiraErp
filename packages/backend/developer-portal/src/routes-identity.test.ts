import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { developerPortalPlugin } from './developer-portal-plugin.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';

/**
 * G-719: developer-portal identity must come from the authenticated principal
 * (`request.user.sub`), never from a caller-supplied `x-account-id` header.
 */
describe('developer-portal routes — identity source (G-719)', () => {
  let app: FastifyInstance;
  let accountId: string;

  async function seedListing(pluginName: string): Promise<void> {
    const service = app.developerPortalService;
    const account = await service.createAccount({
      email: `${pluginName}@example.com`,
      name: 'Dev',
      organization: 'Org',
    });
    accountId = account.id;
    const sub = await service.submitPlugin(account.id, {
      name: pluginName,
      displayName: 'Plugin',
      category: 'workflow',
      tags: [],
      version: '1.0.0',
      description: 'desc',
      supportedProductVersions: '>=1.0.0',
      requiredPermissions: [],
    });
    await service.reviewPlugin(sub.id, 'reviewer', { decision: 'approved' });
    await service.publishPlugin(sub.id);
  }

  beforeEach(async () => {
    app = Fastify({ logger: false });
    // Simulate the gateway auth plugin: a trusted header (never exposed to
    // clients in production) populates request.user for these tests only.
    app.addHook('onRequest', async (request) => {
      const sub = request.headers['x-test-authenticated-sub'];
      if (typeof sub === 'string' && sub) {
        (request as unknown as { user: { sub: string } }).user = { sub };
      }
    });
    await app.register(developerPortalPlugin, {
      repository: new InMemoryDeveloperPortalRepository(),
    });
    await app.ready();
    await seedListing('alpha-plugin');
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects anonymous ratings with 401 even when x-account-id is supplied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/developer/marketplace/alpha-plugin/ratings',
      headers: { 'x-account-id': accountId },
      payload: { rating: 5 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('attributes the rating to request.user.sub and ignores x-account-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/developer/marketplace/alpha-plugin/ratings',
      headers: {
        'x-test-authenticated-sub': 'user-real',
        'x-account-id': 'user-forged',
      },
      payload: { rating: 4, review: 'ok' },
    });
    expect(res.statusCode).toBe(201);

    const service = app.developerPortalService;
    const repo = (service as unknown as { repository: InMemoryDeveloperPortalRepository })
      .repository;
    expect(await repo.getRatingByAccountAndPlugin('user-real', 'alpha-plugin')).not.toBeNull();
    expect(await repo.getRatingByAccountAndPlugin('user-forged', 'alpha-plugin')).toBeNull();
  });

  it('requires an authenticated reviewer for submission review', async () => {
    const service = app.developerPortalService;
    const sub = await service.submitPlugin(accountId, {
      name: 'beta-plugin',
      displayName: 'Beta',
      category: 'workflow',
      tags: [],
      version: '1.0.0',
      description: 'desc',
      supportedProductVersions: '>=1.0.0',
      requiredPermissions: [],
    });

    const anon = await app.inject({
      method: 'POST',
      url: `/developer/submissions/${sub.id}/review`,
      payload: { decision: 'approved' },
    });
    expect(anon.statusCode).toBe(401);

    const authed = await app.inject({
      method: 'POST',
      url: `/developer/submissions/${sub.id}/review`,
      headers: { 'x-test-authenticated-sub': 'reviewer-1' },
      payload: { decision: 'approved' },
    });
    expect(authed.statusCode).toBe(200);
    const stored = await service.getSubmission(sub.id);
    expect(stored.reviewedBy).toBe('reviewer-1');
  });
});
