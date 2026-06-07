/**
 * Developer Portal Service
 *
 * Business logic for developer accounts, API key management,
 * webhook registration with HMAC verification, sandbox provisioning,
 * plugin submission/review workflow, marketplace, documentation, and analytics.
 */
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  DeveloperPortalRepository,
  DeveloperPortalExtendedRepository,
  DeveloperAccountEntity,
  ApiKeyEntity,
  WebhookEntity,
  WebhookDeliveryEntity,
  SandboxEntity,
  PluginSubmissionEntity,
  MarketplaceListingEntity,
  PluginRatingEntity,
  DocPageEntity,
  AnalyticsEventEntity,
  PluginAnalyticsSummary,
  AnalyticsTimeSeries,
} from './developer-portal-repository.js';
import type {
  CreateDeveloperAccountInput,
  UpdateDeveloperAccountInput,
  CreateApiKeyInput,
  CreateWebhookInput,
  UpdateWebhookInput,
  CreateSandboxInput,
  SubmitPluginInput,
  ReviewPluginInput,
  PluginRatingInput,
  CreateDocPageInput,
  UpdateDocPageInput,
  RecordAnalyticsEventInput,
} from './schemas.js';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface DeveloperPortalServiceConfig {
  /** Maximum API keys per account (default: 10) */
  maxApiKeysPerAccount: number;
  /** Maximum webhooks per account (default: 20) */
  maxWebhooksPerAccount: number;
  /** Maximum sandboxes per account (default: 3) */
  maxSandboxesPerAccount: number;
  /** Sandbox expiry in days (default: 30) */
  sandboxExpiryDays: number;
  /** Base URL for sandbox API endpoints */
  sandboxBaseUrl: string;
  /** Maximum webhook delivery retries (default: 5) */
  maxWebhookRetries: number;
}

export const DEFAULT_CONFIG: DeveloperPortalServiceConfig = {
  maxApiKeysPerAccount: 10,
  maxWebhooksPerAccount: 20,
  maxSandboxesPerAccount: 3,
  sandboxExpiryDays: 30,
  sandboxBaseUrl: 'https://sandbox.proctira.org',
  maxWebhookRetries: 5,
};

// ─── Crypto Utilities ─────────────────────────────────────────────────────────

/**
 * Generate a random API key string.
 * Format: oem_{32 random hex chars}
 */
export function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'oem_';
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Hash an API key for storage (simple SHA-256 simulation for in-memory use).
 * In production, use crypto.createHash('sha256').
 */
export function hashApiKey(key: string): string {
  // Simple hash for testing - in production use crypto.createHash('sha256')
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `sha256:${Math.abs(hash).toString(16).padStart(16, '0')}`;
}

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  // Simple HMAC simulation for testing
  // In production: crypto.createHmac('sha256', secret).update(payload).digest('hex')
  let hash = 0;
  const combined = secret + payload;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `sha256=${Math.abs(hash).toString(16).padStart(64, '0')}`;
}

/**
 * Verify a webhook signature against expected.
 */
export function verifyWebhookSignature(
  payload: string,
  secret: string,
  signature: string,
): boolean {
  const expected = generateWebhookSignature(payload, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DeveloperPortalService {
  constructor(
    private readonly repository: DeveloperPortalExtendedRepository,
    private readonly config: DeveloperPortalServiceConfig = DEFAULT_CONFIG,
  ) {}

  // ─── Developer Accounts ─────────────────────────────────────────────────

  async createAccount(input: CreateDeveloperAccountInput): Promise<DeveloperAccountEntity> {
    // Check for duplicate email
    const existing = await this.repository.getAccountByEmail(input.email);
    if (existing) {
      throw new ConflictError(`Developer account with email '${input.email}' already exists`);
    }

    const now = new Date();
    const account: DeveloperAccountEntity = {
      id: uuidv4(),
      name: input.name,
      email: input.email,
      organization: input.organization ?? null,
      website: input.website ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.createAccount(account);
  }

  async getAccount(accountId: string): Promise<DeveloperAccountEntity> {
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    return account;
  }

  async updateAccount(
    accountId: string,
    input: UpdateDeveloperAccountInput,
  ): Promise<DeveloperAccountEntity> {
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }

    const updates: Partial<Pick<DeveloperAccountEntity, 'name' | 'organization' | 'website'>> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.organization !== undefined) updates.organization = input.organization;
    if (input.website !== undefined) updates.website = input.website;

    const updated = await this.repository.updateAccount(accountId, updates);
    return updated!;
  }

  async suspendAccount(accountId: string): Promise<DeveloperAccountEntity> {
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    if (account.status === 'suspended') {
      throw new BusinessRuleError('Account is already suspended');
    }

    const updated = await this.repository.updateAccount(accountId, { status: 'suspended' });
    return updated!;
  }

  // ─── API Keys ───────────────────────────────────────────────────────────

  async createApiKey(
    accountId: string,
    input: CreateApiKeyInput,
  ): Promise<{ entity: ApiKeyEntity; rawKey: string }> {
    // Verify account exists and is active
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    if (account.status !== 'active') {
      throw new BusinessRuleError('Cannot create API key for inactive account');
    }

    // Check key limit
    const existing = await this.repository.listApiKeys({ accountId, status: 'active' }, 1, 1);
    if (existing.total >= this.config.maxApiKeysPerAccount) {
      throw new BusinessRuleError(
        `Maximum of ${this.config.maxApiKeysPerAccount} active API keys per account`,
      );
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const entity: ApiKeyEntity = {
      id: uuidv4(),
      accountId,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes,
      status: 'active',
      expiresAt,
      lastUsedAt: null,
      createdAt: new Date(),
    };

    const created = await this.repository.createApiKey(entity);
    return { entity: created, rawKey };
  }

  async listApiKeys(
    accountId: string,
    page: number = 1,
    pageSize: number = 20,
    status?: 'active' | 'revoked' | 'expired',
  ): Promise<{ data: ApiKeyEntity[]; total: number }> {
    return this.repository.listApiKeys({ accountId, status }, page, pageSize);
  }

  async revokeApiKey(accountId: string, keyId: string): Promise<ApiKeyEntity> {
    const key = await this.repository.getApiKeyById(keyId);
    if (!key) {
      throw new NotFoundError(`API key '${keyId}' not found`);
    }
    if (key.accountId !== accountId) {
      throw new NotFoundError(`API key '${keyId}' not found`);
    }
    if (key.status === 'revoked') {
      throw new BusinessRuleError('API key is already revoked');
    }

    const updated = await this.repository.updateApiKeyStatus(keyId, 'revoked');
    return updated!;
  }

  async validateApiKey(rawKey: string): Promise<ApiKeyEntity | null> {
    const keyHash = hashApiKey(rawKey);
    const key = await this.repository.getApiKeyByHash(keyHash);
    if (!key) return null;

    // Check if expired
    if (key.expiresAt && key.expiresAt < new Date()) {
      await this.repository.updateApiKeyStatus(key.id, 'expired');
      return null;
    }

    // Check if revoked
    if (key.status !== 'active') return null;

    // Update last used
    await this.repository.updateApiKeyLastUsed(key.id, new Date());
    return key;
  }

  // ─── Webhooks ───────────────────────────────────────────────────────────

  async createWebhook(
    accountId: string,
    input: CreateWebhookInput,
  ): Promise<WebhookEntity> {
    // Verify account exists and is active
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    if (account.status !== 'active') {
      throw new BusinessRuleError('Cannot create webhook for inactive account');
    }

    // Check webhook limit
    const existing = await this.repository.listWebhooks({ accountId }, 1, 1);
    if (existing.total >= this.config.maxWebhooksPerAccount) {
      throw new BusinessRuleError(
        `Maximum of ${this.config.maxWebhooksPerAccount} webhooks per account`,
      );
    }

    // Generate secret if not provided
    const secret = input.secret ?? generateApiKey();
    const secretHash = hashApiKey(secret);

    const now = new Date();
    const webhook: WebhookEntity = {
      id: uuidv4(),
      accountId,
      url: input.url,
      events: input.events,
      secretHash,
      description: input.description ?? null,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.createWebhook(webhook);
  }

  async getWebhook(accountId: string, webhookId: string): Promise<WebhookEntity> {
    const webhook = await this.repository.getWebhookById(webhookId);
    if (!webhook || webhook.accountId !== accountId) {
      throw new NotFoundError(`Webhook '${webhookId}' not found`);
    }
    return webhook;
  }

  async listWebhooks(
    accountId: string,
    page: number = 1,
    pageSize: number = 20,
    active?: boolean,
  ): Promise<{ data: WebhookEntity[]; total: number }> {
    return this.repository.listWebhooks({ accountId, active }, page, pageSize);
  }

  async updateWebhook(
    accountId: string,
    webhookId: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookEntity> {
    const webhook = await this.repository.getWebhookById(webhookId);
    if (!webhook || webhook.accountId !== accountId) {
      throw new NotFoundError(`Webhook '${webhookId}' not found`);
    }

    const updates: Partial<Pick<WebhookEntity, 'url' | 'events' | 'secretHash' | 'description' | 'active'>> = {};
    if (input.url !== undefined) updates.url = input.url;
    if (input.events !== undefined) updates.events = input.events;
    if (input.secret !== undefined) updates.secretHash = hashApiKey(input.secret);
    if (input.description !== undefined) updates.description = input.description;
    if (input.active !== undefined) updates.active = input.active;

    const updated = await this.repository.updateWebhook(webhookId, updates);
    return updated!;
  }

  async deleteWebhook(accountId: string, webhookId: string): Promise<void> {
    const webhook = await this.repository.getWebhookById(webhookId);
    if (!webhook || webhook.accountId !== accountId) {
      throw new NotFoundError(`Webhook '${webhookId}' not found`);
    }
    await this.repository.deleteWebhook(webhookId);
  }

  // ─── Webhook Deliveries ─────────────────────────────────────────────────

  async createDelivery(
    webhookId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDeliveryEntity> {
    const webhook = await this.repository.getWebhookById(webhookId);
    if (!webhook) {
      throw new NotFoundError(`Webhook '${webhookId}' not found`);
    }
    if (!webhook.active) {
      throw new BusinessRuleError('Cannot deliver to inactive webhook');
    }
    if (!webhook.events.includes(event) && !webhook.events.includes('*')) {
      throw new BusinessRuleError(`Webhook is not subscribed to event '${event}'`);
    }

    const delivery: WebhookDeliveryEntity = {
      id: uuidv4(),
      webhookId,
      event,
      payload,
      status: 'pending',
      httpStatus: null,
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: new Date(),
      createdAt: new Date(),
    };

    return this.repository.createDelivery(delivery);
  }

  async listDeliveries(
    webhookId: string,
    page: number = 1,
    pageSize: number = 20,
    status?: 'pending' | 'delivered' | 'failed',
  ): Promise<{ data: WebhookDeliveryEntity[]; total: number }> {
    return this.repository.listDeliveries({ webhookId, status }, page, pageSize);
  }

  async markDeliverySuccess(
    deliveryId: string,
    httpStatus: number,
  ): Promise<WebhookDeliveryEntity> {
    const delivery = await this.repository.getDeliveryById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    const updated = await this.repository.updateDelivery(deliveryId, {
      status: 'delivered',
      httpStatus,
      attempts: delivery.attempts + 1,
      lastAttemptAt: new Date(),
      nextRetryAt: null,
    });
    return updated!;
  }

  async markDeliveryFailed(
    deliveryId: string,
    httpStatus: number | null,
  ): Promise<WebhookDeliveryEntity> {
    const delivery = await this.repository.getDeliveryById(deliveryId);
    if (!delivery) {
      throw new NotFoundError(`Delivery '${deliveryId}' not found`);
    }

    const newAttempts = delivery.attempts + 1;
    const isFinalFailure = newAttempts >= this.config.maxWebhookRetries;

    // Exponential backoff: 2^attempts * 30 seconds
    const nextRetryAt = isFinalFailure
      ? null
      : new Date(Date.now() + Math.pow(2, newAttempts) * 30000);

    const updated = await this.repository.updateDelivery(deliveryId, {
      status: isFinalFailure ? 'failed' : 'pending',
      httpStatus,
      attempts: newAttempts,
      lastAttemptAt: new Date(),
      nextRetryAt,
    });
    return updated!;
  }

  // ─── Sandboxes ─────────────────────────────────────────────────────────

  async createSandbox(
    accountId: string,
    input: CreateSandboxInput,
  ): Promise<SandboxEntity> {
    // Verify account exists and is active
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    if (account.status !== 'active') {
      throw new BusinessRuleError('Cannot create sandbox for inactive account');
    }

    // Check sandbox limit
    const existing = await this.repository.listSandboxes(accountId);
    const activeSandboxes = existing.filter(
      (s) => s.status === 'active' || s.status === 'provisioning',
    );
    if (activeSandboxes.length >= this.config.maxSandboxesPerAccount) {
      throw new BusinessRuleError(
        `Maximum of ${this.config.maxSandboxesPerAccount} active sandboxes per account`,
      );
    }

    const tenantId = uuidv4();
    const sandboxId = uuidv4();
    const expiresAt = new Date(Date.now() + this.config.sandboxExpiryDays * 24 * 60 * 60 * 1000);

    const sandbox: SandboxEntity = {
      id: sandboxId,
      accountId,
      name: input.name,
      description: input.description ?? null,
      tenantId,
      status: 'active',
      expiresAt,
      apiEndpoint: `${this.config.sandboxBaseUrl}/tenants/${tenantId}`,
      createdAt: new Date(),
    };

    return this.repository.createSandbox(sandbox);
  }

  async getSandbox(accountId: string, sandboxId: string): Promise<SandboxEntity> {
    const sandbox = await this.repository.getSandboxById(sandboxId);
    if (!sandbox || sandbox.accountId !== accountId) {
      throw new NotFoundError(`Sandbox '${sandboxId}' not found`);
    }
    return sandbox;
  }

  async listSandboxes(accountId: string): Promise<SandboxEntity[]> {
    return this.repository.listSandboxes(accountId);
  }

  async destroySandbox(accountId: string, sandboxId: string): Promise<SandboxEntity> {
    const sandbox = await this.repository.getSandboxById(sandboxId);
    if (!sandbox || sandbox.accountId !== accountId) {
      throw new NotFoundError(`Sandbox '${sandboxId}' not found`);
    }
    if (sandbox.status === 'destroyed') {
      throw new BusinessRuleError('Sandbox is already destroyed');
    }

    const updated = await this.repository.updateSandboxStatus(sandboxId, 'destroyed');
    return updated!;
  }

  // ─── Plugin Submissions ─────────────────────────────────────────────────

  async submitPlugin(
    accountId: string,
    input: SubmitPluginInput,
  ): Promise<PluginSubmissionEntity> {
    // Verify account exists and is active
    const account = await this.repository.getAccountById(accountId);
    if (!account) {
      throw new NotFoundError(`Developer account '${accountId}' not found`);
    }
    if (account.status !== 'active') {
      throw new BusinessRuleError('Cannot submit plugin from inactive account');
    }

    const submission: PluginSubmissionEntity = {
      id: uuidv4(),
      accountId,
      name: input.name,
      version: input.version,
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      supportedProductVersions: input.supportedProductVersions,
      requiredPermissions: input.requiredPermissions,
      sourceUrl: input.sourceUrl ?? null,
      documentationUrl: input.documentationUrl ?? null,
      iconUrl: input.iconUrl ?? null,
      screenshots: input.screenshots ?? [],
      tags: input.tags ?? [],
      license: input.license ?? null,
      status: 'submitted',
      reviewNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      submittedAt: new Date(),
      publishedAt: null,
    };

    return this.repository.createSubmission(submission);
  }

  async getSubmission(submissionId: string): Promise<PluginSubmissionEntity> {
    const submission = await this.repository.getSubmissionById(submissionId);
    if (!submission) {
      throw new NotFoundError(`Plugin submission '${submissionId}' not found`);
    }
    return submission;
  }

  async listSubmissions(
    accountId: string,
    page: number = 1,
    pageSize: number = 20,
    status?: PluginSubmissionEntity['status'],
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    return this.repository.listSubmissions({ accountId, status }, page, pageSize);
  }

  async listAllSubmissions(
    page: number = 1,
    pageSize: number = 20,
    status?: PluginSubmissionEntity['status'],
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    return this.repository.listSubmissions({ status }, page, pageSize);
  }

  async reviewPlugin(
    submissionId: string,
    reviewerId: string,
    input: ReviewPluginInput,
  ): Promise<PluginSubmissionEntity> {
    const submission = await this.repository.getSubmissionById(submissionId);
    if (!submission) {
      throw new NotFoundError(`Plugin submission '${submissionId}' not found`);
    }
    if (submission.status !== 'submitted' && submission.status !== 'in_review') {
      throw new BusinessRuleError(
        `Cannot review submission in '${submission.status}' status. Must be 'submitted' or 'in_review'.`,
      );
    }

    const newStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    const updated = await this.repository.updateSubmissionStatus(
      submissionId,
      newStatus,
      input.reviewNotes ?? null,
      reviewerId,
    );
    return updated!;
  }

  async publishPlugin(submissionId: string): Promise<MarketplaceListingEntity> {
    const submission = await this.repository.getSubmissionById(submissionId);
    if (!submission) {
      throw new NotFoundError(`Plugin submission '${submissionId}' not found`);
    }
    if (submission.status !== 'approved') {
      throw new BusinessRuleError('Only approved plugins can be published');
    }

    // Get account for author name
    const account = await this.repository.getAccountById(submission.accountId);
    const authorName = account?.name ?? 'Unknown';

    // Create marketplace listing
    const now = new Date();
    const listing: MarketplaceListingEntity = {
      name: submission.name,
      displayName: submission.displayName,
      description: submission.description,
      category: submission.category,
      version: submission.version,
      author: authorName,
      accountId: submission.accountId,
      iconUrl: submission.iconUrl,
      screenshots: submission.screenshots,
      tags: submission.tags,
      license: submission.license,
      installs: 0,
      averageRating: 0,
      ratingCount: 0,
      publishedAt: now,
      updatedAt: now,
    };

    await this.repository.createListing(listing);
    await this.repository.updateSubmissionStatus(submissionId, 'published');

    return listing;
  }

  // ─── Marketplace ────────────────────────────────────────────────────────

  async searchMarketplace(
    page: number = 1,
    pageSize: number = 20,
    search?: string,
    category?: string,
    sortBy?: 'name' | 'installs' | 'rating' | 'publishedAt',
    sortOrder?: 'asc' | 'desc',
    tags?: string[],
  ): Promise<{ data: MarketplaceListingEntity[]; total: number }> {
    return this.repository.searchListings(
      { search, category, tags, sortBy, sortOrder },
      page,
      pageSize,
    );
  }

  async getMarketplaceListing(pluginName: string): Promise<MarketplaceListingEntity> {
    const listing = await this.repository.getListingByName(pluginName);
    if (!listing) {
      throw new NotFoundError(`Plugin '${pluginName}' not found in marketplace`);
    }
    return listing;
  }

  async ratePlugin(
    accountId: string,
    pluginName: string,
    input: PluginRatingInput,
  ): Promise<PluginRatingEntity> {
    // Verify listing exists
    const listing = await this.repository.getListingByName(pluginName);
    if (!listing) {
      throw new NotFoundError(`Plugin '${pluginName}' not found in marketplace`);
    }

    // Check if user already rated
    const existingRating = await this.repository.getRatingByAccountAndPlugin(accountId, pluginName);
    if (existingRating) {
      // Update existing rating
      const updated = await this.repository.updateRating(
        existingRating.id,
        input.rating,
        input.review ?? null,
      );

      // Recalculate average
      const { average, count } = await this.repository.getAverageRating(pluginName);
      await this.repository.updateListingStats(pluginName, {
        averageRating: average,
        ratingCount: count,
      });

      return updated!;
    }

    // Create new rating
    const rating: PluginRatingEntity = {
      id: uuidv4(),
      pluginName,
      accountId,
      rating: input.rating,
      review: input.review ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const created = await this.repository.createRating(rating);

    // Update listing stats
    const { average, count } = await this.repository.getAverageRating(pluginName);
    await this.repository.updateListingStats(pluginName, {
      averageRating: average,
      ratingCount: count,
    });

    return created;
  }

  // ─── Documentation ──────────────────────────────────────────────────────

  async createDocPage(input: CreateDocPageInput): Promise<DocPageEntity> {
    // Check for duplicate slug
    const existing = await this.repository.getDocPageBySlug(input.slug);
    if (existing) {
      throw new ConflictError(`Documentation page with slug '${input.slug}' already exists`);
    }

    const now = new Date();
    const page: DocPageEntity = {
      id: uuidv4(),
      slug: input.slug,
      title: input.title,
      content: input.content,
      category: input.category,
      order: input.order ?? 0,
      published: input.published ?? false,
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.createDocPage(page);
  }

  async getDocPage(slug: string): Promise<DocPageEntity> {
    const page = await this.repository.getDocPageBySlug(slug);
    if (!page) {
      throw new NotFoundError(`Documentation page '${slug}' not found`);
    }
    return page;
  }

  async listDocPages(category?: string, published?: boolean): Promise<DocPageEntity[]> {
    return this.repository.listDocPages({ category, published });
  }

  async updateDocPage(slug: string, input: UpdateDocPageInput): Promise<DocPageEntity> {
    const page = await this.repository.getDocPageBySlug(slug);
    if (!page) {
      throw new NotFoundError(`Documentation page '${slug}' not found`);
    }

    const updates: Partial<Pick<DocPageEntity, 'title' | 'content' | 'category' | 'order' | 'published'>> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.content !== undefined) updates.content = input.content;
    if (input.category !== undefined) updates.category = input.category;
    if (input.order !== undefined) updates.order = input.order;
    if (input.published !== undefined) updates.published = input.published;

    const updated = await this.repository.updateDocPage(page.id, updates);
    return updated!;
  }

  async deleteDocPage(slug: string): Promise<void> {
    const page = await this.repository.getDocPageBySlug(slug);
    if (!page) {
      throw new NotFoundError(`Documentation page '${slug}' not found`);
    }
    await this.repository.deleteDocPage(page.id);
  }

  // ─── Analytics ──────────────────────────────────────────────────────────

  async recordAnalyticsEvent(input: RecordAnalyticsEventInput): Promise<AnalyticsEventEntity> {
    const event: AnalyticsEventEntity = {
      id: uuidv4(),
      pluginName: input.pluginName,
      eventType: input.eventType,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    };

    const created = await this.repository.recordAnalyticsEvent(event);

    // Update install count on marketplace listing if applicable
    if (input.eventType === 'install' || input.eventType === 'uninstall') {
      const summary = await this.repository.getPluginAnalyticsSummary(input.pluginName);
      await this.repository.updateListingStats(input.pluginName, {
        installs: summary.activeInstalls,
      });
    }

    return created;
  }

  async getPluginAnalytics(pluginName: string): Promise<PluginAnalyticsSummary> {
    return this.repository.getPluginAnalyticsSummary(pluginName);
  }

  async getPluginAnalyticsTimeSeries(
    pluginName: string,
    startDate?: Date,
    endDate?: Date,
    granularity: 'day' | 'week' | 'month' = 'day',
  ): Promise<AnalyticsTimeSeries[]> {
    return this.repository.getAnalyticsTimeSeries(
      { pluginName, startDate, endDate },
      granularity,
    );
  }
}
