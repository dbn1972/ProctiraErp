/**
 * Developer Portal Repository Interface
 *
 * Defines the data access contract for developer accounts, API keys,
 * webhooks, sandbox tenants, plugin submissions, marketplace listings,
 * documentation pages, and plugin analytics.
 */

// ─── Entity Types ─────────────────────────────────────────────────────────────

export interface DeveloperAccountEntity {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  website: string | null;
  status: 'active' | 'suspended' | 'deactivated';
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyEntity {
  id: string;
  accountId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface WebhookEntity {
  id: string;
  accountId: string;
  url: string;
  events: string[];
  secretHash: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryEntity {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  httpStatus: number | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
}

export interface SandboxEntity {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  tenantId: string;
  status: 'provisioning' | 'active' | 'expired' | 'destroyed';
  expiresAt: Date;
  apiEndpoint: string;
  createdAt: Date;
}

// ─── Filter Types ─────────────────────────────────────────────────────────────

export interface ApiKeyFilter {
  accountId: string;
  status?: 'active' | 'revoked' | 'expired';
}

export interface WebhookFilter {
  accountId: string;
  active?: boolean;
}

export interface WebhookDeliveryFilter {
  webhookId: string;
  status?: 'pending' | 'delivered' | 'failed';
}

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface DeveloperPortalRepository {
  // Developer Accounts
  createAccount(account: DeveloperAccountEntity): Promise<DeveloperAccountEntity>;
  getAccountById(id: string): Promise<DeveloperAccountEntity | null>;
  getAccountByEmail(email: string): Promise<DeveloperAccountEntity | null>;
  updateAccount(id: string, updates: Partial<Pick<DeveloperAccountEntity, 'name' | 'organization' | 'website' | 'status'>>): Promise<DeveloperAccountEntity | null>;

  // API Keys
  createApiKey(key: ApiKeyEntity): Promise<ApiKeyEntity>;
  getApiKeyById(id: string): Promise<ApiKeyEntity | null>;
  getApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null>;
  listApiKeys(filter: ApiKeyFilter, page: number, pageSize: number): Promise<{ data: ApiKeyEntity[]; total: number }>;
  updateApiKeyStatus(id: string, status: 'active' | 'revoked' | 'expired'): Promise<ApiKeyEntity | null>;
  updateApiKeyLastUsed(id: string, lastUsedAt: Date): Promise<void>;

  // Webhooks
  createWebhook(webhook: WebhookEntity): Promise<WebhookEntity>;
  getWebhookById(id: string): Promise<WebhookEntity | null>;
  listWebhooks(filter: WebhookFilter, page: number, pageSize: number): Promise<{ data: WebhookEntity[]; total: number }>;
  updateWebhook(id: string, updates: Partial<Pick<WebhookEntity, 'url' | 'events' | 'secretHash' | 'description' | 'active'>>): Promise<WebhookEntity | null>;
  deleteWebhook(id: string): Promise<boolean>;

  // Webhook Deliveries
  createDelivery(delivery: WebhookDeliveryEntity): Promise<WebhookDeliveryEntity>;
  getDeliveryById(id: string): Promise<WebhookDeliveryEntity | null>;
  listDeliveries(filter: WebhookDeliveryFilter, page: number, pageSize: number): Promise<{ data: WebhookDeliveryEntity[]; total: number }>;
  updateDelivery(id: string, updates: Partial<Pick<WebhookDeliveryEntity, 'status' | 'httpStatus' | 'attempts' | 'lastAttemptAt' | 'nextRetryAt'>>): Promise<WebhookDeliveryEntity | null>;

  // Sandboxes
  createSandbox(sandbox: SandboxEntity): Promise<SandboxEntity>;
  getSandboxById(id: string): Promise<SandboxEntity | null>;
  listSandboxes(accountId: string): Promise<SandboxEntity[]>;
  updateSandboxStatus(id: string, status: SandboxEntity['status']): Promise<SandboxEntity | null>;
}


// ─── Plugin Submission Entity Types ───────────────────────────────────────────

export interface PluginSubmissionEntity {
  id: string;
  accountId: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  category: string;
  supportedProductVersions: string;
  requiredPermissions: string[];
  sourceUrl: string | null;
  documentationUrl: string | null;
  iconUrl: string | null;
  screenshots: string[];
  tags: string[];
  license: string | null;
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'published';
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  submittedAt: Date;
  publishedAt: Date | null;
}

// ─── Marketplace Entity Types ─────────────────────────────────────────────────

export interface MarketplaceListingEntity {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version: string;
  author: string;
  accountId: string;
  iconUrl: string | null;
  screenshots: string[];
  tags: string[];
  license: string | null;
  installs: number;
  averageRating: number;
  ratingCount: number;
  publishedAt: Date;
  updatedAt: Date;
}

export interface PluginRatingEntity {
  id: string;
  pluginName: string;
  accountId: string;
  rating: number;
  review: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Documentation Entity Types ──────────────────────────────────────────────

export interface DocPageEntity {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: string;
  order: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Analytics Entity Types ──────────────────────────────────────────────────

export interface AnalyticsEventEntity {
  id: string;
  pluginName: string;
  eventType: 'install' | 'uninstall' | 'api_call' | 'error' | 'page_view';
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PluginAnalyticsSummary {
  pluginName: string;
  totalInstalls: number;
  activeInstalls: number;
  totalApiCalls: number;
  totalErrors: number;
  averageRating: number;
  ratingCount: number;
}

export interface AnalyticsTimeSeries {
  date: string;
  installs: number;
  uninstalls: number;
  apiCalls: number;
  errors: number;
}

// ─── Extended Filter Types ────────────────────────────────────────────────────

export interface PluginSubmissionFilter {
  accountId?: string;
  status?: PluginSubmissionEntity['status'];
}

export interface MarketplaceFilter {
  search?: string;
  category?: string;
  tags?: string[];
  sortBy?: 'name' | 'installs' | 'rating' | 'publishedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface DocPageFilter {
  category?: string;
  published?: boolean;
}

export interface AnalyticsFilter {
  pluginName: string;
  startDate?: Date;
  endDate?: Date;
}

// ─── Extended Repository Interface ────────────────────────────────────────────

export interface DeveloperPortalExtendedRepository extends DeveloperPortalRepository {
  // Plugin Submissions
  createSubmission(submission: PluginSubmissionEntity): Promise<PluginSubmissionEntity>;
  getSubmissionById(id: string): Promise<PluginSubmissionEntity | null>;
  listSubmissions(filter: PluginSubmissionFilter, page: number, pageSize: number): Promise<{ data: PluginSubmissionEntity[]; total: number }>;
  updateSubmissionStatus(id: string, status: PluginSubmissionEntity['status'], reviewNotes?: string | null, reviewedBy?: string | null): Promise<PluginSubmissionEntity | null>;

  // Marketplace Listings
  createListing(listing: MarketplaceListingEntity): Promise<MarketplaceListingEntity>;
  getListingByName(name: string): Promise<MarketplaceListingEntity | null>;
  searchListings(filter: MarketplaceFilter, page: number, pageSize: number): Promise<{ data: MarketplaceListingEntity[]; total: number }>;
  updateListingStats(name: string, updates: Partial<Pick<MarketplaceListingEntity, 'installs' | 'averageRating' | 'ratingCount'>>): Promise<MarketplaceListingEntity | null>;
  deleteListing(name: string): Promise<boolean>;

  // Plugin Ratings
  createRating(rating: PluginRatingEntity): Promise<PluginRatingEntity>;
  getRatingByAccountAndPlugin(accountId: string, pluginName: string): Promise<PluginRatingEntity | null>;
  updateRating(id: string, rating: number, review: string | null): Promise<PluginRatingEntity | null>;
  getAverageRating(pluginName: string): Promise<{ average: number; count: number }>;

  // Documentation Pages
  createDocPage(page: DocPageEntity): Promise<DocPageEntity>;
  getDocPageBySlug(slug: string): Promise<DocPageEntity | null>;
  listDocPages(filter: DocPageFilter): Promise<DocPageEntity[]>;
  updateDocPage(id: string, updates: Partial<Pick<DocPageEntity, 'title' | 'content' | 'category' | 'order' | 'published'>>): Promise<DocPageEntity | null>;
  deleteDocPage(id: string): Promise<boolean>;

  // Analytics
  recordAnalyticsEvent(event: AnalyticsEventEntity): Promise<AnalyticsEventEntity>;
  getPluginAnalyticsSummary(pluginName: string): Promise<PluginAnalyticsSummary>;
  getAnalyticsTimeSeries(filter: AnalyticsFilter, granularity: 'day' | 'week' | 'month'): Promise<AnalyticsTimeSeries[]>;
}
