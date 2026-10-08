/**
 * Hybrid developer-portal repository:
 * - Postgres: API keys (055) + accounts/webhooks/deliveries (089) +
 *   submissions/listings (132) + sandboxes/ratings/docs/analytics (134) when configured
 * - In-memory: only when no durable store is configured (dev/tests; prod fails closed)
 */
import type {
  DeveloperPortalExtendedRepository,
  DeveloperAccountEntity,
  ApiKeyEntity,
  ApiKeyFilter,
  WebhookEntity,
  WebhookFilter,
  WebhookDeliveryEntity,
  WebhookDeliveryFilter,
  SandboxEntity,
  PluginSubmissionEntity,
  PluginSubmissionFilter,
  MarketplaceListingEntity,
  MarketplaceFilter,
  PluginRatingEntity,
  DocPageEntity,
  DocPageFilter,
  AnalyticsEventEntity,
  PluginAnalyticsSummary,
  AnalyticsTimeSeries,
  AnalyticsFilter,
} from './developer-portal-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type { PgApiKeyStore } from './pg-api-key-store.js';
import type { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

export class HybridDeveloperPortalRepository implements DeveloperPortalExtendedRepository {
  private readonly memory = new InMemoryDeveloperPortalRepository();

  constructor(
    private readonly apiKeys: PgApiKeyStore | null,
    private readonly durable: PgDeveloperPortalDurableStore | null = null,
  ) {}

  // ─── API Keys (Postgres when configured) ──────────────────────────────────

  async createApiKey(key: ApiKeyEntity): Promise<ApiKeyEntity> {
    if (this.apiKeys) return this.apiKeys.createApiKey(key);
    return this.memory.createApiKey(key);
  }

  async getApiKeyById(id: string, tenantId: string): Promise<ApiKeyEntity | null> {
    if (this.apiKeys) return this.apiKeys.getApiKeyById(id, tenantId);
    return this.memory.getApiKeyById(id, tenantId);
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    if (this.apiKeys) return this.apiKeys.getApiKeyByHash(keyHash);
    return this.memory.getApiKeyByHash(keyHash);
  }

  async listApiKeys(
    filter: ApiKeyFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: ApiKeyEntity[]; total: number }> {
    if (this.apiKeys) return this.apiKeys.listApiKeys(filter, page, pageSize);
    return this.memory.listApiKeys(filter, page, pageSize);
  }

  async updateApiKeyStatus(
    id: string,
    status: ApiKeyEntity['status'],
    tenantId: string,
  ): Promise<ApiKeyEntity | null> {
    if (this.apiKeys) {
      return this.apiKeys.updateApiKeyStatus(id, status, tenantId);
    }
    return this.memory.updateApiKeyStatus(id, status, tenantId);
  }

  async updateApiKeyLastUsed(id: string, lastUsedAt: Date, tenantId: string): Promise<void> {
    if (this.apiKeys) {
      await this.apiKeys.updateApiKeyLastUsed(id, lastUsedAt, tenantId);
      return;
    }
    await this.memory.updateApiKeyLastUsed(id, lastUsedAt, tenantId);
  }

  // ─── Developer Accounts (Postgres when durable store configured) ──────────

  createAccount(account: DeveloperAccountEntity): Promise<DeveloperAccountEntity> {
    if (this.durable) return this.durable.createAccount(account);
    return this.memory.createAccount(account);
  }

  getAccountById(id: string): Promise<DeveloperAccountEntity | null> {
    if (this.durable) return this.durable.getAccountById(id);
    return this.memory.getAccountById(id);
  }

  getAccountByEmail(email: string): Promise<DeveloperAccountEntity | null> {
    if (this.durable) return this.durable.getAccountByEmail(email);
    return this.memory.getAccountByEmail(email);
  }

  updateAccount(
    id: string,
    updates: Partial<Pick<DeveloperAccountEntity, 'name' | 'organization' | 'website' | 'status'>>,
  ): Promise<DeveloperAccountEntity | null> {
    if (this.durable) return this.durable.updateAccount(id, updates);
    return this.memory.updateAccount(id, updates);
  }

  // ─── Webhooks (Postgres when durable store configured) ────────────────────

  createWebhook(webhook: WebhookEntity): Promise<WebhookEntity> {
    if (this.durable) return this.durable.createWebhook(webhook);
    return this.memory.createWebhook(webhook);
  }

  getWebhookById(id: string): Promise<WebhookEntity | null> {
    if (this.durable) return this.durable.getWebhookById(id);
    return this.memory.getWebhookById(id);
  }

  listWebhooks(
    filter: WebhookFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookEntity[]; total: number }> {
    if (this.durable) return this.durable.listWebhooks(filter, page, pageSize);
    return this.memory.listWebhooks(filter, page, pageSize);
  }

  listActiveWebhooksForTenant(tenantId: string): Promise<WebhookEntity[]> {
    if (this.durable) return this.durable.listActiveWebhooksForTenant(tenantId);
    return this.memory.listActiveWebhooksForTenant(tenantId);
  }

  updateWebhook(
    id: string,
    updates: Partial<
      Pick<WebhookEntity, 'url' | 'events' | 'secretHash' | 'description' | 'active'>
    >,
  ): Promise<WebhookEntity | null> {
    if (this.durable) return this.durable.updateWebhook(id, updates);
    return this.memory.updateWebhook(id, updates);
  }

  deleteWebhook(id: string): Promise<boolean> {
    if (this.durable) return this.durable.deleteWebhook(id);
    return this.memory.deleteWebhook(id);
  }

  // ─── Webhook Deliveries (Postgres when durable store configured) ──────────

  createDelivery(delivery: WebhookDeliveryEntity): Promise<WebhookDeliveryEntity> {
    if (this.durable) return this.durable.createDelivery(delivery);
    return this.memory.createDelivery(delivery);
  }

  getDeliveryById(id: string): Promise<WebhookDeliveryEntity | null> {
    if (this.durable) return this.durable.getDeliveryById(id);
    return this.memory.getDeliveryById(id);
  }

  listDeliveries(
    filter: WebhookDeliveryFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookDeliveryEntity[]; total: number }> {
    if (this.durable) return this.durable.listDeliveries(filter, page, pageSize);
    return this.memory.listDeliveries(filter, page, pageSize);
  }

  updateDelivery(
    id: string,
    updates: Partial<
      Pick<
        WebhookDeliveryEntity,
        'status' | 'httpStatus' | 'attempts' | 'lastAttemptAt' | 'nextRetryAt'
      >
    >,
  ): Promise<WebhookDeliveryEntity | null> {
    if (this.durable) return this.durable.updateDelivery(id, updates);
    return this.memory.updateDelivery(id, updates);
  }

  // ─── Sandboxes (Postgres when durable store configured — PRC-H049) ────────

  createSandbox(sandbox: SandboxEntity): Promise<SandboxEntity> {
    if (this.durable) return this.durable.createSandbox(sandbox);
    return this.memory.createSandbox(sandbox);
  }

  getSandboxById(id: string): Promise<SandboxEntity | null> {
    if (this.durable) return this.durable.getSandboxById(id);
    return this.memory.getSandboxById(id);
  }

  listSandboxes(accountId: string): Promise<SandboxEntity[]> {
    if (this.durable) return this.durable.listSandboxes(accountId);
    return this.memory.listSandboxes(accountId);
  }

  updateSandboxStatus(id: string, status: SandboxEntity['status']): Promise<SandboxEntity | null> {
    if (this.durable) return this.durable.updateSandboxStatus(id, status);
    return this.memory.updateSandboxStatus(id, status);
  }

  // ─── Plugin Submissions (in-memory residual) ──────────────────────────────

  createSubmission(submission: PluginSubmissionEntity): Promise<PluginSubmissionEntity> {
    if (this.durable) return this.durable.createSubmission(submission);
    return this.memory.createSubmission(submission);
  }

  getSubmissionById(id: string): Promise<PluginSubmissionEntity | null> {
    if (this.durable) return this.durable.getSubmissionById(id);
    return this.memory.getSubmissionById(id);
  }

  listSubmissions(
    filter: PluginSubmissionFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    if (this.durable) return this.durable.listSubmissions(filter, page, pageSize);
    return this.memory.listSubmissions(filter, page, pageSize);
  }

  updateSubmissionStatus(
    id: string,
    status: PluginSubmissionEntity['status'],
    reviewNotes?: string | null,
    reviewedBy?: string | null,
  ): Promise<PluginSubmissionEntity | null> {
    if (this.durable)
      return this.durable.updateSubmissionStatus(id, status, reviewNotes, reviewedBy);
    return this.memory.updateSubmissionStatus(id, status, reviewNotes, reviewedBy);
  }

  // ─── Marketplace (Postgres when durable store configured — PRC-H049) ──────

  createListing(listing: MarketplaceListingEntity): Promise<MarketplaceListingEntity> {
    if (this.durable) return this.durable.createListing(listing);
    return this.memory.createListing(listing);
  }

  getListingByName(name: string): Promise<MarketplaceListingEntity | null> {
    if (this.durable) return this.durable.getListingByName(name);
    return this.memory.getListingByName(name);
  }

  searchListings(
    filter: MarketplaceFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: MarketplaceListingEntity[]; total: number }> {
    if (this.durable) return this.durable.searchListings(filter, page, pageSize);
    return this.memory.searchListings(filter, page, pageSize);
  }

  updateListingStats(
    name: string,
    updates: Partial<Pick<MarketplaceListingEntity, 'installs' | 'averageRating' | 'ratingCount'>>,
  ): Promise<MarketplaceListingEntity | null> {
    if (this.durable) return this.durable.updateListingStats(name, updates);
    return this.memory.updateListingStats(name, updates);
  }

  deleteListing(name: string): Promise<boolean> {
    if (this.durable) return this.durable.deleteListing(name);
    return this.memory.deleteListing(name);
  }

  // ─── Plugin Ratings (Postgres when durable store configured — PRC-H049) ───

  createRating(rating: PluginRatingEntity): Promise<PluginRatingEntity> {
    if (this.durable) return this.durable.createRating(rating);
    return this.memory.createRating(rating);
  }

  getRatingByAccountAndPlugin(
    accountId: string,
    pluginName: string,
  ): Promise<PluginRatingEntity | null> {
    if (this.durable) return this.durable.getRatingByAccountAndPlugin(accountId, pluginName);
    return this.memory.getRatingByAccountAndPlugin(accountId, pluginName);
  }

  updateRating(
    id: string,
    rating: number,
    review: string | null,
  ): Promise<PluginRatingEntity | null> {
    if (this.durable) return this.durable.updateRating(id, rating, review);
    return this.memory.updateRating(id, rating, review);
  }

  getAverageRating(pluginName: string): Promise<{ average: number; count: number }> {
    if (this.durable) return this.durable.getAverageRating(pluginName);
    return this.memory.getAverageRating(pluginName);
  }

  // ─── Documentation (Postgres when durable store configured — PRC-H049) ────

  createDocPage(page: DocPageEntity): Promise<DocPageEntity> {
    if (this.durable) return this.durable.createDocPage(page);
    return this.memory.createDocPage(page);
  }

  getDocPageBySlug(slug: string): Promise<DocPageEntity | null> {
    if (this.durable) return this.durable.getDocPageBySlug(slug);
    return this.memory.getDocPageBySlug(slug);
  }

  listDocPages(filter: DocPageFilter): Promise<DocPageEntity[]> {
    if (this.durable) return this.durable.listDocPages(filter);
    return this.memory.listDocPages(filter);
  }

  updateDocPage(
    id: string,
    updates: Partial<Pick<DocPageEntity, 'title' | 'content' | 'category' | 'order' | 'published'>>,
  ): Promise<DocPageEntity | null> {
    if (this.durable) return this.durable.updateDocPage(id, updates);
    return this.memory.updateDocPage(id, updates);
  }

  deleteDocPage(id: string): Promise<boolean> {
    if (this.durable) return this.durable.deleteDocPage(id);
    return this.memory.deleteDocPage(id);
  }

  // ─── Analytics (Postgres when durable store configured — PRC-H049) ────────

  recordAnalyticsEvent(event: AnalyticsEventEntity): Promise<AnalyticsEventEntity> {
    if (this.durable) return this.durable.recordAnalyticsEvent(event);
    return this.memory.recordAnalyticsEvent(event);
  }

  getPluginAnalyticsSummary(pluginName: string): Promise<PluginAnalyticsSummary> {
    if (this.durable) return this.durable.getPluginAnalyticsSummary(pluginName);
    return this.memory.getPluginAnalyticsSummary(pluginName);
  }

  getAnalyticsTimeSeries(
    filter: AnalyticsFilter,
    granularity: 'day' | 'week' | 'month',
  ): Promise<AnalyticsTimeSeries[]> {
    if (this.durable) return this.durable.getAnalyticsTimeSeries(filter, granularity);
    return this.memory.getAnalyticsTimeSeries(filter, granularity);
  }
}
