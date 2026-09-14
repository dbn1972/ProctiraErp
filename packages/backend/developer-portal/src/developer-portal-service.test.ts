/**
 * Developer Portal Service Tests
 *
 * Tests for plugin submission workflow, marketplace, documentation,
 * and analytics functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { DeveloperPortalService, DEFAULT_CONFIG } from './developer-portal-service.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type { DeveloperAccountEntity } from './developer-portal-repository.js';

const TEST_TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('DeveloperPortalService', () => {
  let service: DeveloperPortalService;
  let repository: InMemoryDeveloperPortalRepository;
  let testAccount: DeveloperAccountEntity;

  beforeEach(async () => {
    repository = new InMemoryDeveloperPortalRepository();
    service = new DeveloperPortalService(repository, DEFAULT_CONFIG);

    // Create a test account
    testAccount = await service.createAccount({
      name: 'Test Developer',
      email: 'dev@example.com',
      organization: 'Test Org',
    });
  });

  // ─── Account Management ─────────────────────────────────────────────────

  describe('Account Management', () => {
    it('should create a developer account', async () => {
      const account = await service.createAccount({
        name: 'New Dev',
        email: 'new@example.com',
      });
      expect(account.name).toBe('New Dev');
      expect(account.email).toBe('new@example.com');
      expect(account.status).toBe('active');
    });

    it('should reject duplicate email', async () => {
      await expect(
        service.createAccount({ name: 'Dup', email: 'dev@example.com' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should suspend an account', async () => {
      const suspended = await service.suspendAccount(testAccount.id);
      expect(suspended.status).toBe('suspended');
    });
  });

  // ─── API Key Management ─────────────────────────────────────────────────

  describe('API Key Management', () => {
    it('should create an API key', async () => {
      const { entity, rawKey } = await service.createApiKey(testAccount.id, TEST_TENANT_ID, {
        name: 'Test Key',
        scopes: ['read:students', 'write:students'],
      });
      expect(entity.name).toBe('Test Key');
      expect(entity.scopes).toEqual(['read:students', 'write:students']);
      expect(rawKey).toMatch(/^oem_[0-9a-f]{32}$/);
    });

    it('should validate an API key', async () => {
      const { rawKey } = await service.createApiKey(testAccount.id, TEST_TENANT_ID, {
        name: 'Validate Key',
        scopes: ['read:all'],
      });
      const validated = await service.validateApiKey(rawKey);
      expect(validated).not.toBeNull();
      expect(validated!.accountId).toBe(testAccount.id);
    });

    it('should revoke an API key', async () => {
      const { entity } = await service.createApiKey(testAccount.id, TEST_TENANT_ID, {
        name: 'Revoke Key',
        scopes: ['read:all'],
      });
      const revoked = await service.revokeApiKey(testAccount.id, entity.id);
      expect(revoked.status).toBe('revoked');
    });

    it('should enforce max API keys per account', async () => {
      const config = { ...DEFAULT_CONFIG, maxApiKeysPerAccount: 2 };
      const limitedService = new DeveloperPortalService(repository, config);

      await limitedService.createApiKey(testAccount.id, TEST_TENANT_ID, {
        name: 'Key 1',
        scopes: ['read'],
      });
      await limitedService.createApiKey(testAccount.id, TEST_TENANT_ID, {
        name: 'Key 2',
        scopes: ['read'],
      });

      await expect(
        limitedService.createApiKey(testAccount.id, TEST_TENANT_ID, {
          name: 'Key 3',
          scopes: ['read'],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Plugin Submission Workflow ─────────────────────────────────────────

  describe('Plugin Submission Workflow', () => {
    it('should submit a plugin for review', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'my-plugin',
        version: '1.0.0',
        displayName: 'My Plugin',
        description: 'A test plugin for the marketplace',
        category: 'workflow',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: ['read:students'],
      });

      expect(submission.name).toBe('my-plugin');
      expect(submission.status).toBe('submitted');
      expect(submission.accountId).toBe(testAccount.id);
    });

    it('should reject submission from inactive account', async () => {
      await service.suspendAccount(testAccount.id);

      await expect(
        service.submitPlugin(testAccount.id, {
          name: 'bad-plugin',
          version: '1.0.0',
          displayName: 'Bad Plugin',
          description: 'Should not be submitted',
          category: 'workflow',
          supportedProductVersions: '>=1.0.0',
          requiredPermissions: [],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should approve a plugin submission', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'approve-plugin',
        version: '1.0.0',
        displayName: 'Approve Plugin',
        description: 'A plugin to be approved',
        category: 'notification',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: [],
      });

      const reviewed = await service.reviewPlugin(submission.id, 'reviewer-1', {
        decision: 'approved',
        reviewNotes: 'Looks good!',
      });

      expect(reviewed.status).toBe('approved');
      expect(reviewed.reviewNotes).toBe('Looks good!');
    });

    it('should reject a plugin submission', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'reject-plugin',
        version: '1.0.0',
        displayName: 'Reject Plugin',
        description: 'A plugin to be rejected',
        category: 'validation',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: [],
      });

      const reviewed = await service.reviewPlugin(submission.id, 'reviewer-1', {
        decision: 'rejected',
        reviewNotes: 'Security concerns',
      });

      expect(reviewed.status).toBe('rejected');
    });

    it('should not review already published submission', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'published-plugin',
        version: '1.0.0',
        displayName: 'Published Plugin',
        description: 'A plugin already published',
        category: 'workflow',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: [],
      });

      await service.reviewPlugin(submission.id, 'reviewer-1', { decision: 'approved' });
      await service.publishPlugin(submission.id);

      await expect(
        service.reviewPlugin(submission.id, 'reviewer-1', { decision: 'rejected' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should publish an approved plugin to marketplace', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'publish-plugin',
        version: '2.0.0',
        displayName: 'Publish Plugin',
        description: 'A plugin to be published to marketplace',
        category: 'integration-connector',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: ['read:institutions'],
        tags: ['integration', 'connector'],
      });

      await service.reviewPlugin(submission.id, 'reviewer-1', { decision: 'approved' });
      const listing = await service.publishPlugin(submission.id);

      expect(listing.name).toBe('publish-plugin');
      expect(listing.version).toBe('2.0.0');
      expect(listing.author).toBe('Test Developer');
      expect(listing.installs).toBe(0);
    });

    it('should not publish unapproved plugin', async () => {
      const submission = await service.submitPlugin(testAccount.id, {
        name: 'unapproved-plugin',
        version: '1.0.0',
        displayName: 'Unapproved Plugin',
        description: 'Should not be published',
        category: 'workflow',
        supportedProductVersions: '>=1.0.0',
        requiredPermissions: [],
      });

      await expect(service.publishPlugin(submission.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Marketplace ────────────────────────────────────────────────────────

  describe('Marketplace', () => {
    beforeEach(async () => {
      // Publish a few plugins
      const plugins = [
        {
          name: 'alpha-plugin',
          displayName: 'Alpha Plugin',
          category: 'workflow' as const,
          tags: ['automation'],
        },
        {
          name: 'beta-plugin',
          displayName: 'Beta Plugin',
          category: 'notification' as const,
          tags: ['alerts'],
        },
        {
          name: 'gamma-plugin',
          displayName: 'Gamma Plugin',
          category: 'workflow' as const,
          tags: ['automation', 'reports'],
        },
      ];
      for (const plugin of plugins) {
        const sub = await service.submitPlugin(testAccount.id, {
          name: plugin.name,
          displayName: plugin.displayName,
          category: plugin.category,
          tags: plugin.tags,
          version: '1.0.0',
          description: `Description for ${plugin.displayName}`,
          supportedProductVersions: '>=1.0.0',
          requiredPermissions: [],
        });
        await service.reviewPlugin(sub.id, 'reviewer', { decision: 'approved' });
        await service.publishPlugin(sub.id);
      }
    });

    it('should search marketplace by text', async () => {
      const result = await service.searchMarketplace(1, 20, 'alpha');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('alpha-plugin');
    });

    it('should filter marketplace by category', async () => {
      const result = await service.searchMarketplace(1, 20, undefined, 'workflow');
      expect(result.data).toHaveLength(2);
    });

    it('should get a specific marketplace listing', async () => {
      const listing = await service.getMarketplaceListing('beta-plugin');
      expect(listing.displayName).toBe('Beta Plugin');
      expect(listing.category).toBe('notification');
    });

    it('should throw NotFoundError for non-existent listing', async () => {
      await expect(service.getMarketplaceListing('nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should rate a plugin', async () => {
      const rating = await service.ratePlugin(testAccount.id, 'alpha-plugin', {
        rating: 4,
        review: 'Great plugin!',
      });
      expect(rating.rating).toBe(4);
      expect(rating.review).toBe('Great plugin!');

      // Verify listing stats updated
      const listing = await service.getMarketplaceListing('alpha-plugin');
      expect(listing.averageRating).toBe(4);
      expect(listing.ratingCount).toBe(1);
    });

    it('should update existing rating', async () => {
      await service.ratePlugin(testAccount.id, 'alpha-plugin', { rating: 3 });
      const updated = await service.ratePlugin(testAccount.id, 'alpha-plugin', { rating: 5 });
      expect(updated.rating).toBe(5);

      const listing = await service.getMarketplaceListing('alpha-plugin');
      expect(listing.averageRating).toBe(5);
    });
  });

  // ─── Documentation ──────────────────────────────────────────────────────

  describe('Documentation', () => {
    it('should create a documentation page', async () => {
      const page = await service.createDocPage({
        slug: 'getting-started/quickstart',
        title: 'Quick Start Guide',
        content: '# Quick Start\n\nWelcome to the developer portal.',
        category: 'getting-started',
        order: 1,
        published: true,
      });

      expect(page.slug).toBe('getting-started/quickstart');
      expect(page.title).toBe('Quick Start Guide');
      expect(page.published).toBe(true);
    });

    it('should reject duplicate slug', async () => {
      await service.createDocPage({
        slug: 'auth/overview',
        title: 'Auth Overview',
        content: 'Authentication guide content.',
        category: 'authentication',
      });

      await expect(
        service.createDocPage({
          slug: 'auth/overview',
          title: 'Duplicate',
          content: 'Duplicate content.',
          category: 'authentication',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('should list documentation pages by category', async () => {
      await service.createDocPage({
        slug: 'auth/jwt',
        title: 'JWT Guide',
        content: 'JWT content.',
        category: 'authentication',
        order: 1,
      });
      await service.createDocPage({
        slug: 'auth/oauth',
        title: 'OAuth Guide',
        content: 'OAuth content.',
        category: 'authentication',
        order: 2,
      });
      await service.createDocPage({
        slug: 'webhooks/intro',
        title: 'Webhooks Intro',
        content: 'Webhooks content.',
        category: 'webhooks',
        order: 1,
      });

      const authPages = await service.listDocPages('authentication');
      expect(authPages).toHaveLength(2);
      expect(authPages[0]!.slug).toBe('auth/jwt');
      expect(authPages[1]!.slug).toBe('auth/oauth');
    });

    it('should update a documentation page', async () => {
      await service.createDocPage({
        slug: 'errors/catalog',
        title: 'Error Catalog',
        content: 'Original content.',
        category: 'errors',
      });

      const updated = await service.updateDocPage('errors/catalog', {
        content: 'Updated error catalog content.',
        published: true,
      });

      expect(updated.content).toBe('Updated error catalog content.');
      expect(updated.published).toBe(true);
    });

    it('should delete a documentation page', async () => {
      await service.createDocPage({
        slug: 'temp/page',
        title: 'Temp Page',
        content: 'Temporary.',
        category: 'changelog',
      });

      await service.deleteDocPage('temp/page');
      await expect(service.getDocPage('temp/page')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Analytics ──────────────────────────────────────────────────────────

  describe('Analytics', () => {
    beforeEach(async () => {
      // Publish a plugin for analytics
      const sub = await service.submitPlugin(testAccount.id, {
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
    });

    it('should record analytics events', async () => {
      const event = await service.recordAnalyticsEvent({
        pluginName: 'analytics-plugin',
        eventType: 'install',
      });
      expect(event.pluginName).toBe('analytics-plugin');
      expect(event.eventType).toBe('install');
    });

    it('should get plugin analytics summary', async () => {
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'install' });
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'install' });
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'api_call' });
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'error' });

      const summary = await service.getPluginAnalytics('analytics-plugin');
      expect(summary.totalInstalls).toBe(2);
      expect(summary.activeInstalls).toBe(2);
      expect(summary.totalApiCalls).toBe(1);
      expect(summary.totalErrors).toBe(1);
    });

    it('should track uninstalls in active installs', async () => {
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'install' });
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'install' });
      await service.recordAnalyticsEvent({
        pluginName: 'analytics-plugin',
        eventType: 'uninstall',
      });

      const summary = await service.getPluginAnalytics('analytics-plugin');
      expect(summary.totalInstalls).toBe(2);
      expect(summary.activeInstalls).toBe(1);
    });

    it('should get analytics time series', async () => {
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'install' });
      await service.recordAnalyticsEvent({ pluginName: 'analytics-plugin', eventType: 'api_call' });

      const timeSeries = await service.getPluginAnalyticsTimeSeries('analytics-plugin');
      expect(timeSeries.length).toBeGreaterThan(0);
      expect(timeSeries[0]!.installs).toBe(1);
      expect(timeSeries[0]!.apiCalls).toBe(1);
    });
  });

  // ─── Webhooks ───────────────────────────────────────────────────────────

  describe('Webhooks', () => {
    const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    it('should create a webhook', async () => {
      const webhook = await service.createWebhook(testAccount.id, TEST_TENANT_ID, {
        url: 'https://example.com/webhook',
        events: ['student.created', 'student.updated'],
        description: 'Test webhook',
      });
      expect(webhook.url).toBe('https://example.com/webhook');
      expect(webhook.events).toEqual(['student.created', 'student.updated']);
      expect(webhook.active).toBe(true);
      expect(webhook.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should isolate webhooks by tenant for the same account', async () => {
      await service.createWebhook(testAccount.id, TENANT_A, {
        url: 'https://a.example.com/hook',
        events: ['*'],
        description: 'Tenant A',
      });
      await service.createWebhook(testAccount.id, TENANT_B, {
        url: 'https://b.example.com/hook',
        events: ['*'],
        description: 'Tenant B',
      });

      const listedA = await service.listWebhooks(testAccount.id, TENANT_A);
      expect(listedA.total).toBe(1);
      expect(listedA.data[0]!.tenantId).toBe(TENANT_A);
      expect(listedA.data[0]!.url).toBe('https://a.example.com/hook');

      const listedB = await service.listWebhooks(testAccount.id, TENANT_B);
      expect(listedB.total).toBe(1);
      expect(listedB.data[0]!.tenantId).toBe(TENANT_B);

      await expect(
        service.getWebhook(testAccount.id, TENANT_B, listedA.data[0]!.id),
      ).rejects.toThrow(NotFoundError);
    });

    it('should track webhook deliveries', async () => {
      const webhook = await service.createWebhook(testAccount.id, TEST_TENANT_ID, {
        url: 'https://example.com/hook',
        events: ['*'],
      });

      const delivery = await service.createDelivery(webhook.id, 'student.created', {
        studentId: '123',
      });
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(0);

      const success = await service.markDeliverySuccess(delivery.id, 200);
      expect(success.status).toBe('delivered');
      expect(success.httpStatus).toBe(200);
    });

    it('should retry failed deliveries with exponential backoff', async () => {
      const webhook = await service.createWebhook(testAccount.id, TEST_TENANT_ID, {
        url: 'https://example.com/hook',
        events: ['*'],
      });

      const delivery = await service.createDelivery(webhook.id, 'test.event', { data: 'test' });

      // First failure - should still be pending
      const failed1 = await service.markDeliveryFailed(delivery.id, 500);
      expect(failed1.status).toBe('pending');
      expect(failed1.attempts).toBe(1);
      expect(failed1.nextRetryAt).not.toBeNull();
    });
  });

  // ─── Sandboxes ─────────────────────────────────────────────────────────

  describe('Sandboxes', () => {
    it('should create a sandbox', async () => {
      const sandbox = await service.createSandbox(testAccount.id, {
        name: 'Test Sandbox',
        description: 'For integration testing',
      });
      expect(sandbox.name).toBe('Test Sandbox');
      expect(sandbox.status).toBe('active');
      expect(sandbox.apiEndpoint).toContain('sandbox.proctira.org');
    });

    it('should enforce max sandboxes per account', async () => {
      const config = { ...DEFAULT_CONFIG, maxSandboxesPerAccount: 1 };
      const limitedService = new DeveloperPortalService(repository, config);

      await limitedService.createSandbox(testAccount.id, { name: 'Sandbox 1' });
      await expect(
        limitedService.createSandbox(testAccount.id, { name: 'Sandbox 2' }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should destroy a sandbox', async () => {
      const sandbox = await service.createSandbox(testAccount.id, { name: 'Destroy Me' });
      const destroyed = await service.destroySandbox(testAccount.id, sandbox.id);
      expect(destroyed.status).toBe('destroyed');
    });
  });
});
