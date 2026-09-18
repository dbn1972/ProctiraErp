/**
 * Hybrid developer-portal repository:
 * - Postgres: API keys (055) + accounts/webhooks/deliveries (089) when configured
 * - In-memory: marketplace/docs/analytics/sandboxes/submissions/ratings (residual)
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
import { PgApiKeyStore } from './pg-api-key-store.js';
import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';

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

  // ─── Sandboxes (in-memory residual) ───────────────────────────────────────

  createSandbox(sandbox: SandboxEntity): Promise<SandboxEntity> {
    return this.memory.createSandbox(sandbox);
  }

  getSandboxById(id: string): Promise<SandboxEntity | null> {
    return this.memory.getSandboxById(id);
  }

  listSandboxes(accountId: string): Promise<SandboxEntity[]> {
    return this.memory.listSandboxes(accountId);
  }

  updateSandboxStatus(id: string, status: SandboxEntity['status']): Promise<SandboxEntity | null> {
    return this.memory.updateSandboxStatus(id, status);
  }

  // ─── Plugin Submissions (in-memory residual) ──────────────────────────────

  createSubmission(submission: PluginSubmissionEntity): Promise<PluginSubmissionEntity> {
    return this.memory.createSubmission(submission);
  }

  getSubmissionById(id: string): Promise<PluginSubmissionEntity | null> {
    return this.memory.getSubmissionById(id);
  }

  listSubmissions(
    filter: PluginSubmissionFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    return this.memory.listSubmissions(filter, page, pageSize);
  }

  updateSubmissionStatus(
    id: string,
    status: PluginSubmissionEntity['status'],
    reviewNotes?: string | null,
    reviewedBy?: string | null,
  ): Promise<PluginSubmissionEntity | null> {
    return this.memory.updateSubmissionStatus(id, status, reviewNotes, reviewedBy);
  }

  // ─── Marketplace (in-memory residual) ─────────────────────────────────────

  createListing(listing: MarketplaceListingEntity): Promise<MarketplaceListingEntity> {
    return this.memory.createListing(listing);
  }

  getListingByName(name: string): Promise<MarketplaceListingEntity | null> {
    return this.memory.getListingByName(name);
  }

  searchListings(
    filter: MarketplaceFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: MarketplaceListingEntity[]; total: number }> {
    return this.memory.searchListings(filter, page, pageSize);
  }

  updateListingStats(
    name: string,
    updates: Partial<Pick<MarketplaceListingEntity, 'installs' | 'averageRating' | 'ratingCount'>>,
  ): Promise<MarketplaceListingEntity | null> {
    return this.memory.updateListingStats(name, updates);
  }

  deleteListing(name: string): Promise<boolean> {
    return this.memory.deleteListing(name);
  }

  // ─── Plugin Ratings (in-memory residual) ──────────────────────────────────

  createRating(rating: PluginRatingEntity): Promise<PluginRatingEntity> {
    return this.memory.createRating(rating);
  }

  getRatingByAccountAndPlugin(
    accountId: string,
    pluginName: string,
  ): Promise<PluginRatingEntity | null> {
    return this.memory.getRatingByAccountAndPlugin(accountId, pluginName);
  }

  updateRating(
    id: string,
    rating: number,
    review: string | null,
  ): Promise<PluginRatingEntity | null> {
    return this.memory.updateRating(id, rating, review);
  }

  getAverageRating(pluginName: string): Promise<{ average: number; count: number }> {
    return this.memory.getAverageRating(pluginName);
  }

  // ─── Documentation (in-memory residual) ───────────────────────────────────

  createDocPage(page: DocPageEntity): Promise<DocPageEntity> {
    return this.memory.createDocPage(page);
  }

  getDocPageBySlug(slug: string): Promise<DocPageEntity | null> {
    return this.memory.getDocPageBySlug(slug);
  }

  listDocPages(filter: DocPageFilter): Promise<DocPageEntity[]> {
    return this.memory.listDocPages(filter);
  }

  updateDocPage(
    id: string,
    updates: Partial<Pick<DocPageEntity, 'title' | 'content' | 'category' | 'order' | 'published'>>,
  ): Promise<DocPageEntity | null> {
    return this.memory.updateDocPage(id, updates);
  }

  deleteDocPage(id: string): Promise<boolean> {
    return this.memory.deleteDocPage(id);
  }

  // ─── Analytics (in-memory residual) ───────────────────────────────────────

  recordAnalyticsEvent(event: AnalyticsEventEntity): Promise<AnalyticsEventEntity> {
    return this.memory.recordAnalyticsEvent(event);
  }

  getPluginAnalyticsSummary(pluginName: string): Promise<PluginAnalyticsSummary> {
    return this.memory.getPluginAnalyticsSummary(pluginName);
  }

  getAnalyticsTimeSeries(
    filter: AnalyticsFilter,
    granularity: 'day' | 'week' | 'month',
  ): Promise<AnalyticsTimeSeries[]> {
    return this.memory.getAnalyticsTimeSeries(filter, granularity);
  }
}
