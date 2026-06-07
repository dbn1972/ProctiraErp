/**
 * In-Memory Developer Portal Repository
 *
 * Used for unit testing without database dependencies.
 */
import type {
  DeveloperPortalRepository,
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

export class InMemoryDeveloperPortalRepository implements DeveloperPortalExtendedRepository {
  private accounts: Map<string, DeveloperAccountEntity> = new Map();
  private apiKeys: Map<string, ApiKeyEntity> = new Map();
  private webhooks: Map<string, WebhookEntity> = new Map();
  private deliveries: Map<string, WebhookDeliveryEntity> = new Map();
  private sandboxes: Map<string, SandboxEntity> = new Map();
  private submissions: Map<string, PluginSubmissionEntity> = new Map();
  private listings: Map<string, MarketplaceListingEntity> = new Map();
  private ratings: Map<string, PluginRatingEntity> = new Map();
  private docPages: Map<string, DocPageEntity> = new Map();
  private analyticsEvents: AnalyticsEventEntity[] = [];

  // ─── Developer Accounts ───────────────────────────────────────────────────

  async createAccount(account: DeveloperAccountEntity): Promise<DeveloperAccountEntity> {
    this.accounts.set(account.id, { ...account });
    return { ...account };
  }

  async getAccountById(id: string): Promise<DeveloperAccountEntity | null> {
    const account = this.accounts.get(id);
    return account ? { ...account } : null;
  }

  async getAccountByEmail(email: string): Promise<DeveloperAccountEntity | null> {
    for (const account of this.accounts.values()) {
      if (account.email === email) {
        return { ...account };
      }
    }
    return null;
  }

  async updateAccount(
    id: string,
    updates: Partial<Pick<DeveloperAccountEntity, 'name' | 'organization' | 'website' | 'status'>>,
  ): Promise<DeveloperAccountEntity | null> {
    const account = this.accounts.get(id);
    if (!account) return null;
    const updated = { ...account, ...updates, updatedAt: new Date() };
    this.accounts.set(id, updated);
    return { ...updated };
  }

  // ─── API Keys ─────────────────────────────────────────────────────────────

  async createApiKey(key: ApiKeyEntity): Promise<ApiKeyEntity> {
    this.apiKeys.set(key.id, { ...key });
    return { ...key };
  }

  async getApiKeyById(id: string): Promise<ApiKeyEntity | null> {
    const key = this.apiKeys.get(id);
    return key ? { ...key } : null;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    for (const key of this.apiKeys.values()) {
      if (key.keyHash === keyHash) {
        return { ...key };
      }
    }
    return null;
  }

  async listApiKeys(
    filter: ApiKeyFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: ApiKeyEntity[]; total: number }> {
    let keys = Array.from(this.apiKeys.values()).filter(
      (k) => k.accountId === filter.accountId,
    );
    if (filter.status) {
      keys = keys.filter((k) => k.status === filter.status);
    }
    const total = keys.length;
    const start = (page - 1) * pageSize;
    const data = keys.slice(start, start + pageSize).map((k) => ({ ...k }));
    return { data, total };
  }

  async updateApiKeyStatus(
    id: string,
    status: 'active' | 'revoked' | 'expired',
  ): Promise<ApiKeyEntity | null> {
    const key = this.apiKeys.get(id);
    if (!key) return null;
    const updated = { ...key, status };
    this.apiKeys.set(id, updated);
    return { ...updated };
  }

  async updateApiKeyLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    const key = this.apiKeys.get(id);
    if (key) {
      this.apiKeys.set(id, { ...key, lastUsedAt });
    }
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  async createWebhook(webhook: WebhookEntity): Promise<WebhookEntity> {
    this.webhooks.set(webhook.id, { ...webhook });
    return { ...webhook };
  }

  async getWebhookById(id: string): Promise<WebhookEntity | null> {
    const webhook = this.webhooks.get(id);
    return webhook ? { ...webhook } : null;
  }

  async listWebhooks(
    filter: WebhookFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookEntity[]; total: number }> {
    let webhooks = Array.from(this.webhooks.values()).filter(
      (w) => w.accountId === filter.accountId,
    );
    if (filter.active !== undefined) {
      webhooks = webhooks.filter((w) => w.active === filter.active);
    }
    const total = webhooks.length;
    const start = (page - 1) * pageSize;
    const data = webhooks.slice(start, start + pageSize).map((w) => ({ ...w }));
    return { data, total };
  }

  async updateWebhook(
    id: string,
    updates: Partial<Pick<WebhookEntity, 'url' | 'events' | 'secretHash' | 'description' | 'active'>>,
  ): Promise<WebhookEntity | null> {
    const webhook = this.webhooks.get(id);
    if (!webhook) return null;
    const updated = { ...webhook, ...updates, updatedAt: new Date() };
    this.webhooks.set(id, updated);
    return { ...updated };
  }

  async deleteWebhook(id: string): Promise<boolean> {
    return this.webhooks.delete(id);
  }

  // ─── Webhook Deliveries ───────────────────────────────────────────────────

  async createDelivery(delivery: WebhookDeliveryEntity): Promise<WebhookDeliveryEntity> {
    this.deliveries.set(delivery.id, { ...delivery });
    return { ...delivery };
  }

  async getDeliveryById(id: string): Promise<WebhookDeliveryEntity | null> {
    const delivery = this.deliveries.get(id);
    return delivery ? { ...delivery } : null;
  }

  async listDeliveries(
    filter: WebhookDeliveryFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookDeliveryEntity[]; total: number }> {
    let deliveries = Array.from(this.deliveries.values()).filter(
      (d) => d.webhookId === filter.webhookId,
    );
    if (filter.status) {
      deliveries = deliveries.filter((d) => d.status === filter.status);
    }
    const total = deliveries.length;
    const start = (page - 1) * pageSize;
    const data = deliveries.slice(start, start + pageSize).map((d) => ({ ...d }));
    return { data, total };
  }

  async updateDelivery(
    id: string,
    updates: Partial<Pick<WebhookDeliveryEntity, 'status' | 'httpStatus' | 'attempts' | 'lastAttemptAt' | 'nextRetryAt'>>,
  ): Promise<WebhookDeliveryEntity | null> {
    const delivery = this.deliveries.get(id);
    if (!delivery) return null;
    const updated = { ...delivery, ...updates };
    this.deliveries.set(id, updated);
    return { ...updated };
  }

  // ─── Sandboxes ────────────────────────────────────────────────────────────

  async createSandbox(sandbox: SandboxEntity): Promise<SandboxEntity> {
    this.sandboxes.set(sandbox.id, { ...sandbox });
    return { ...sandbox };
  }

  async getSandboxById(id: string): Promise<SandboxEntity | null> {
    const sandbox = this.sandboxes.get(id);
    return sandbox ? { ...sandbox } : null;
  }

  async listSandboxes(accountId: string): Promise<SandboxEntity[]> {
    return Array.from(this.sandboxes.values())
      .filter((s) => s.accountId === accountId)
      .map((s) => ({ ...s }));
  }

  async updateSandboxStatus(
    id: string,
    status: SandboxEntity['status'],
  ): Promise<SandboxEntity | null> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return null;
    const updated = { ...sandbox, status };
    this.sandboxes.set(id, updated);
    return { ...updated };
  }

  // ─── Plugin Submissions ─────────────────────────────────────────────────────

  async createSubmission(submission: PluginSubmissionEntity): Promise<PluginSubmissionEntity> {
    this.submissions.set(submission.id, { ...submission });
    return { ...submission };
  }

  async getSubmissionById(id: string): Promise<PluginSubmissionEntity | null> {
    const submission = this.submissions.get(id);
    return submission ? { ...submission } : null;
  }

  async listSubmissions(
    filter: PluginSubmissionFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    let submissions = Array.from(this.submissions.values());
    if (filter.accountId) {
      submissions = submissions.filter((s) => s.accountId === filter.accountId);
    }
    if (filter.status) {
      submissions = submissions.filter((s) => s.status === filter.status);
    }
    const total = submissions.length;
    const start = (page - 1) * pageSize;
    const data = submissions.slice(start, start + pageSize).map((s) => ({ ...s }));
    return { data, total };
  }

  async updateSubmissionStatus(
    id: string,
    status: PluginSubmissionEntity['status'],
    reviewNotes?: string | null,
    reviewedBy?: string | null,
  ): Promise<PluginSubmissionEntity | null> {
    const submission = this.submissions.get(id);
    if (!submission) return null;
    const updated: PluginSubmissionEntity = {
      ...submission,
      status,
      reviewNotes: reviewNotes ?? submission.reviewNotes,
      reviewedBy: reviewedBy ?? submission.reviewedBy,
      reviewedAt: status === 'approved' || status === 'rejected' ? new Date() : submission.reviewedAt,
      publishedAt: status === 'published' ? new Date() : submission.publishedAt,
    };
    this.submissions.set(id, updated);
    return { ...updated };
  }

  // ─── Marketplace Listings ───────────────────────────────────────────────────

  async createListing(listing: MarketplaceListingEntity): Promise<MarketplaceListingEntity> {
    this.listings.set(listing.name, { ...listing });
    return { ...listing };
  }

  async getListingByName(name: string): Promise<MarketplaceListingEntity | null> {
    const listing = this.listings.get(name);
    return listing ? { ...listing } : null;
  }

  async searchListings(
    filter: MarketplaceFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: MarketplaceListingEntity[]; total: number }> {
    let listings = Array.from(this.listings.values());

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      listings = listings.filter(
        (l) =>
          l.name.toLowerCase().includes(searchLower) ||
          l.displayName.toLowerCase().includes(searchLower) ||
          l.description.toLowerCase().includes(searchLower) ||
          l.tags.some((t) => t.toLowerCase().includes(searchLower)),
      );
    }
    if (filter.category) {
      listings = listings.filter((l) => l.category === filter.category);
    }
    if (filter.tags && filter.tags.length > 0) {
      listings = listings.filter((l) =>
        filter.tags!.some((t) => l.tags.includes(t)),
      );
    }

    // Sort
    const sortBy = filter.sortBy || 'publishedAt';
    const sortOrder = filter.sortOrder || 'desc';
    listings.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'installs':
          cmp = a.installs - b.installs;
          break;
        case 'rating':
          cmp = a.averageRating - b.averageRating;
          break;
        case 'publishedAt':
          cmp = a.publishedAt.getTime() - b.publishedAt.getTime();
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    const total = listings.length;
    const start = (page - 1) * pageSize;
    const data = listings.slice(start, start + pageSize).map((l) => ({ ...l }));
    return { data, total };
  }

  async updateListingStats(
    name: string,
    updates: Partial<Pick<MarketplaceListingEntity, 'installs' | 'averageRating' | 'ratingCount'>>,
  ): Promise<MarketplaceListingEntity | null> {
    const listing = this.listings.get(name);
    if (!listing) return null;
    const updated = { ...listing, ...updates, updatedAt: new Date() };
    this.listings.set(name, updated);
    return { ...updated };
  }

  async deleteListing(name: string): Promise<boolean> {
    return this.listings.delete(name);
  }

  // ─── Plugin Ratings ─────────────────────────────────────────────────────────

  async createRating(rating: PluginRatingEntity): Promise<PluginRatingEntity> {
    this.ratings.set(rating.id, { ...rating });
    return { ...rating };
  }

  async getRatingByAccountAndPlugin(
    accountId: string,
    pluginName: string,
  ): Promise<PluginRatingEntity | null> {
    for (const rating of this.ratings.values()) {
      if (rating.accountId === accountId && rating.pluginName === pluginName) {
        return { ...rating };
      }
    }
    return null;
  }

  async updateRating(
    id: string,
    rating: number,
    review: string | null,
  ): Promise<PluginRatingEntity | null> {
    const existing = this.ratings.get(id);
    if (!existing) return null;
    const updated = { ...existing, rating, review, updatedAt: new Date() };
    this.ratings.set(id, updated);
    return { ...updated };
  }

  async getAverageRating(pluginName: string): Promise<{ average: number; count: number }> {
    const ratings = Array.from(this.ratings.values()).filter(
      (r) => r.pluginName === pluginName,
    );
    if (ratings.length === 0) return { average: 0, count: 0 };
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    return { average: Math.round((sum / ratings.length) * 100) / 100, count: ratings.length };
  }

  // ─── Documentation Pages ────────────────────────────────────────────────────

  async createDocPage(page: DocPageEntity): Promise<DocPageEntity> {
    this.docPages.set(page.id, { ...page });
    return { ...page };
  }

  async getDocPageBySlug(slug: string): Promise<DocPageEntity | null> {
    for (const page of this.docPages.values()) {
      if (page.slug === slug) {
        return { ...page };
      }
    }
    return null;
  }

  async listDocPages(filter: DocPageFilter): Promise<DocPageEntity[]> {
    let pages = Array.from(this.docPages.values());
    if (filter.category) {
      pages = pages.filter((p) => p.category === filter.category);
    }
    if (filter.published !== undefined) {
      pages = pages.filter((p) => p.published === filter.published);
    }
    pages.sort((a, b) => a.order - b.order);
    return pages.map((p) => ({ ...p }));
  }

  async updateDocPage(
    id: string,
    updates: Partial<Pick<DocPageEntity, 'title' | 'content' | 'category' | 'order' | 'published'>>,
  ): Promise<DocPageEntity | null> {
    const page = this.docPages.get(id);
    if (!page) return null;
    const updated = { ...page, ...updates, updatedAt: new Date() };
    this.docPages.set(id, updated);
    return { ...updated };
  }

  async deleteDocPage(id: string): Promise<boolean> {
    return this.docPages.delete(id);
  }

  // ─── Analytics ──────────────────────────────────────────────────────────────

  async recordAnalyticsEvent(event: AnalyticsEventEntity): Promise<AnalyticsEventEntity> {
    this.analyticsEvents.push({ ...event });
    return { ...event };
  }

  async getPluginAnalyticsSummary(pluginName: string): Promise<PluginAnalyticsSummary> {
    const events = this.analyticsEvents.filter((e) => e.pluginName === pluginName);
    const installs = events.filter((e) => e.eventType === 'install').length;
    const uninstalls = events.filter((e) => e.eventType === 'uninstall').length;
    const apiCalls = events.filter((e) => e.eventType === 'api_call').length;
    const errors = events.filter((e) => e.eventType === 'error').length;

    const { average, count } = await this.getAverageRating(pluginName);

    return {
      pluginName,
      totalInstalls: installs,
      activeInstalls: installs - uninstalls,
      totalApiCalls: apiCalls,
      totalErrors: errors,
      averageRating: average,
      ratingCount: count,
    };
  }

  async getAnalyticsTimeSeries(
    filter: AnalyticsFilter,
    granularity: 'day' | 'week' | 'month',
  ): Promise<AnalyticsTimeSeries[]> {
    let events = this.analyticsEvents.filter((e) => e.pluginName === filter.pluginName);

    if (filter.startDate) {
      events = events.filter((e) => e.createdAt >= filter.startDate!);
    }
    if (filter.endDate) {
      events = events.filter((e) => e.createdAt <= filter.endDate!);
    }

    // Group by date bucket
    const buckets = new Map<string, AnalyticsTimeSeries>();

    for (const event of events) {
      const dateKey = this.getDateBucket(event.createdAt, granularity);
      if (!buckets.has(dateKey)) {
        buckets.set(dateKey, { date: dateKey, installs: 0, uninstalls: 0, apiCalls: 0, errors: 0 });
      }
      const bucket = buckets.get(dateKey)!;
      switch (event.eventType) {
        case 'install':
          bucket.installs++;
          break;
        case 'uninstall':
          bucket.uninstalls++;
          break;
        case 'api_call':
          bucket.apiCalls++;
          break;
        case 'error':
          bucket.errors++;
          break;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private getDateBucket(date: Date, granularity: 'day' | 'week' | 'month'): string {
    const d = new Date(date);
    switch (granularity) {
      case 'day':
        return d.toISOString().slice(0, 10);
      case 'week': {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        return d.toISOString().slice(0, 10);
      }
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
  }
}
