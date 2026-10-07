/**
 * Postgres-backed durable developer-portal state (W1-ARCH-01 COMPLETE).
 *
 * Persists accounts, webhooks (secret digests), and delivery rows via
 * db/sql/089_developer_portal_durable_state.sql. Composed with PgApiKeyStore
 * (055) inside HybridDeveloperPortalRepository.
 */
import {
  createDatabaseSchemaReadinessCheck,
  withPgTenant,
  withPlatformScope,
  type PgQueryable,
} from '@proctira/database';

import type {
  DeveloperAccountEntity,
  MarketplaceFilter,
  MarketplaceListingEntity,
  PluginSubmissionEntity,
  PluginSubmissionFilter,
  WebhookDeliveryEntity,
  WebhookDeliveryFilter,
  WebhookEntity,
  WebhookFilter,
} from './developer-portal-repository.js';
import type { PgPoolLike } from './pg-api-key-store.js';

const ensureDeveloperPortalDurableSchemaReady = createDatabaseSchemaReadinessCheck(
  'developer portal durable state',
  'developerPortalDurable',
);

export async function ensureDeveloperPortalDurableSchema(pool: PgPoolLike): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for developer-portal durable schema');
  await ensureDeveloperPortalDurableSchemaReady(pool);
}

/** Test helper — reset schema-readiness memo (vitest isolation). */
export function resetDeveloperPortalDurableSchemaMemoForTests(): void {
  ensureDeveloperPortalDurableSchemaReady.reset();
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function mapAccount(row: Record<string, unknown>): DeveloperAccountEntity {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    organization: row.organization == null ? null : String(row.organization),
    website: row.website == null ? null : String(row.website),
    status: String(row.status) as DeveloperAccountEntity['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapWebhook(row: Record<string, unknown>): WebhookEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    accountId: String(row.account_id),
    url: String(row.url),
    events: parseJsonArray(row.events),
    secretHash: String(row.secret_hash),
    description: row.description == null ? null : String(row.description),
    active: Boolean(row.active),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapDelivery(row: Record<string, unknown>): WebhookDeliveryEntity {
  return {
    id: String(row.id),
    webhookId: String(row.webhook_id),
    event: String(row.event),
    payload: parseJsonObject(row.payload),
    status: String(row.status) as WebhookDeliveryEntity['status'],
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    attempts: Number(row.attempts ?? 0),
    lastAttemptAt: toDateOrNull(row.last_attempt_at),
    nextRetryAt: toDateOrNull(row.next_retry_at),
    createdAt: toDate(row.created_at),
  };
}

/**
 * Durable store for accounts / webhooks / deliveries.
 * API keys remain in {@link PgApiKeyStore}.
 */
export class PgDeveloperPortalDurableStore {
  constructor(private readonly pool: PgPoolLike) {}

  // ─── Accounts (platform scope) ────────────────────────────────────────────

  async createAccount(account: DeveloperAccountEntity): Promise<DeveloperAccountEntity> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO developer_portal_accounts (
           id, name, email, organization, website, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          account.id,
          account.name,
          account.email,
          account.organization,
          account.website,
          account.status,
          account.createdAt,
          account.updatedAt,
        ],
      );
      return mapAccount(result.rows[0] as Record<string, unknown>);
    });
  }

  async getAccountById(id: string): Promise<DeveloperAccountEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(`SELECT * FROM developer_portal_accounts WHERE id = $1`, [
        id,
      ]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAccount(row) : null;
    });
  }

  async getAccountByEmail(email: string): Promise<DeveloperAccountEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_accounts WHERE lower(email) = lower($1)`,
        [email],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAccount(row) : null;
    });
  }

  async updateAccount(
    id: string,
    updates: Partial<Pick<DeveloperAccountEntity, 'name' | 'organization' | 'website' | 'status'>>,
  ): Promise<DeveloperAccountEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const existing = await client.query(`SELECT * FROM developer_portal_accounts WHERE id = $1`, [
        id,
      ]);
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      const next = {
        name: updates.name ?? String(row.name),
        organization:
          updates.organization !== undefined
            ? updates.organization
            : row.organization == null
              ? null
              : String(row.organization),
        website:
          updates.website !== undefined
            ? updates.website
            : row.website == null
              ? null
              : String(row.website),
        status: updates.status ?? String(row.status),
        updatedAt: new Date(),
      };
      const result = await client.query(
        `UPDATE developer_portal_accounts
         SET name = $2, organization = $3, website = $4, status = $5, updated_at = $6
         WHERE id = $1
         RETURNING *`,
        [id, next.name, next.organization, next.website, next.status, next.updatedAt],
      );
      return mapAccount(result.rows[0] as Record<string, unknown>);
    });
  }

  // ─── Webhooks (tenant scope) ──────────────────────────────────────────────

  async createWebhook(webhook: WebhookEntity): Promise<WebhookEntity> {
    return withPgTenant(this.pool, webhook.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO developer_portal_webhooks (
           id, tenant_id, account_id, url, events, secret_hash, description,
           active, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          webhook.id,
          webhook.tenantId,
          webhook.accountId,
          webhook.url,
          JSON.stringify(webhook.events),
          webhook.secretHash,
          webhook.description,
          webhook.active,
          webhook.createdAt,
          webhook.updatedAt,
        ],
      );
      return mapWebhook(result.rows[0] as Record<string, unknown>);
    });
  }

  async getWebhookById(id: string): Promise<WebhookEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(`SELECT * FROM developer_portal_webhooks WHERE id = $1`, [
        id,
      ]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapWebhook(row) : null;
    });
  }

  async listWebhooks(
    filter: WebhookFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookEntity[]; total: number }> {
    if (!filter.tenantId) {
      throw new Error('tenantId is required for Postgres webhook listing');
    }
    return withPgTenant(this.pool, filter.tenantId, async (client) => {
      const conditions = ['account_id = $1'];
      const values: unknown[] = [filter.accountId];
      if (filter.active !== undefined) {
        values.push(filter.active);
        conditions.push(`active = $${values.length}`);
      }
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM developer_portal_webhooks WHERE ${where}`,
        values,
      );
      const total = Number((countResult.rows[0] as { total: number }).total);
      const offset = (page - 1) * pageSize;
      values.push(pageSize, offset);
      const listResult = await client.query(
        `SELECT * FROM developer_portal_webhooks
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        data: listResult.rows.map((row) => mapWebhook(row as Record<string, unknown>)),
        total,
      };
    });
  }

  async listActiveWebhooksForTenant(tenantId: string): Promise<WebhookEntity[]> {
    // RLS-scoped via withPgTenant; tenant_id predicate kept as defence in depth.
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_webhooks
         WHERE tenant_id = $1 AND active = true
         ORDER BY created_at ASC`,
        [tenantId],
      );
      return result.rows.map((row) => mapWebhook(row as Record<string, unknown>));
    });
  }

  async updateWebhook(
    id: string,
    updates: Partial<
      Pick<WebhookEntity, 'url' | 'events' | 'secretHash' | 'description' | 'active'>
    >,
  ): Promise<WebhookEntity | null> {
    const existing = await this.getWebhookById(id);
    if (!existing) return null;
    return withPgTenant(this.pool, existing.tenantId, async (client) => {
      const next = {
        url: updates.url ?? existing.url,
        events: updates.events ?? existing.events,
        secretHash: updates.secretHash ?? existing.secretHash,
        description: updates.description !== undefined ? updates.description : existing.description,
        active: updates.active ?? existing.active,
        updatedAt: new Date(),
      };
      const result = await client.query(
        `UPDATE developer_portal_webhooks
         SET url = $2, events = $3::jsonb, secret_hash = $4, description = $5,
             active = $6, updated_at = $7
         WHERE id = $1
         RETURNING *`,
        [
          id,
          next.url,
          JSON.stringify(next.events),
          next.secretHash,
          next.description,
          next.active,
          next.updatedAt,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapWebhook(row) : null;
    });
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const existing = await this.getWebhookById(id);
    if (!existing) return false;
    return withPgTenant(this.pool, existing.tenantId, async (client) => {
      const result = await client.query(`DELETE FROM developer_portal_webhooks WHERE id = $1`, [
        id,
      ]);
      return Number(result.rowCount ?? 0) > 0;
    });
  }

  // ─── Deliveries (tenant via webhook) ──────────────────────────────────────

  async createDelivery(delivery: WebhookDeliveryEntity): Promise<WebhookDeliveryEntity> {
    const webhook = await this.getWebhookById(delivery.webhookId);
    if (!webhook) {
      throw new Error(`Webhook '${delivery.webhookId}' not found for delivery persistence`);
    }
    return withPgTenant(this.pool, webhook.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO developer_portal_webhook_deliveries (
           id, tenant_id, webhook_id, event, payload, status, http_status,
           attempts, last_attempt_at, next_retry_at, created_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          delivery.id,
          webhook.tenantId,
          delivery.webhookId,
          delivery.event,
          JSON.stringify(delivery.payload),
          delivery.status,
          delivery.httpStatus,
          delivery.attempts,
          delivery.lastAttemptAt,
          delivery.nextRetryAt,
          delivery.createdAt,
        ],
      );
      return mapDelivery(result.rows[0] as Record<string, unknown>);
    });
  }

  async getDeliveryById(id: string): Promise<WebhookDeliveryEntity | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_webhook_deliveries WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapDelivery(row) : null;
    });
  }

  async listDeliveries(
    filter: WebhookDeliveryFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: WebhookDeliveryEntity[]; total: number }> {
    const webhook = await this.getWebhookById(filter.webhookId);
    if (!webhook) {
      return { data: [], total: 0 };
    }
    return withPgTenant(this.pool, webhook.tenantId, async (client) => {
      const conditions = ['webhook_id = $1'];
      const values: unknown[] = [filter.webhookId];
      if (filter.status) {
        values.push(filter.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM developer_portal_webhook_deliveries WHERE ${where}`,
        values,
      );
      const total = Number((countResult.rows[0] as { total: number }).total);
      const offset = (page - 1) * pageSize;
      values.push(pageSize, offset);
      const listResult = await client.query(
        `SELECT * FROM developer_portal_webhook_deliveries
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        data: listResult.rows.map((row) => mapDelivery(row as Record<string, unknown>)),
        total,
      };
    });
  }

  async updateDelivery(
    id: string,
    updates: Partial<
      Pick<
        WebhookDeliveryEntity,
        'status' | 'httpStatus' | 'attempts' | 'lastAttemptAt' | 'nextRetryAt'
      >
    >,
  ): Promise<WebhookDeliveryEntity | null> {
    const existing = await this.getDeliveryById(id);
    if (!existing) return null;
    const webhook = await this.getWebhookById(existing.webhookId);
    if (!webhook) return null;
    return withPgTenant(this.pool, webhook.tenantId, async (client) => {
      const next = {
        status: updates.status ?? existing.status,
        httpStatus: updates.httpStatus !== undefined ? updates.httpStatus : existing.httpStatus,
        attempts: updates.attempts ?? existing.attempts,
        lastAttemptAt:
          updates.lastAttemptAt !== undefined ? updates.lastAttemptAt : existing.lastAttemptAt,
        nextRetryAt: updates.nextRetryAt !== undefined ? updates.nextRetryAt : existing.nextRetryAt,
      };
      const result = await client.query(
        `UPDATE developer_portal_webhook_deliveries
         SET status = $2, http_status = $3, attempts = $4,
             last_attempt_at = $5, next_retry_at = $6
         WHERE id = $1
         RETURNING *`,
        [id, next.status, next.httpStatus, next.attempts, next.lastAttemptAt, next.nextRetryAt],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapDelivery(row) : null;
    });
  }

  /** Test helper: read raw webhook secret_hash without ORM mapping. */
  async readRawWebhookSecretHash(id: string): Promise<string | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `SELECT secret_hash FROM developer_portal_webhooks WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as { secret_hash?: string } | undefined;
      return row?.secret_hash ?? null;
    });
  }

  // ─── Plugin submissions (platform scope — PRC-H049) ───────────────────────

  async createSubmission(submission: PluginSubmissionEntity): Promise<PluginSubmissionEntity> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `INSERT INTO developer_portal_submissions (
           id, account_id, name, version, display_name, description, category,
           supported_product_versions, required_permissions, source_url,
           documentation_url, icon_url, screenshots, tags, license, status,
           review_notes, reviewed_by, reviewed_at, submitted_at, published_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21
         ) RETURNING *`,
        [
          submission.id,
          submission.accountId,
          submission.name,
          submission.version,
          submission.displayName,
          submission.description,
          submission.category,
          submission.supportedProductVersions,
          JSON.stringify(submission.requiredPermissions ?? []),
          submission.sourceUrl,
          submission.documentationUrl,
          submission.iconUrl,
          JSON.stringify(submission.screenshots ?? []),
          JSON.stringify(submission.tags ?? []),
          submission.license,
          submission.status,
          submission.reviewNotes,
          submission.reviewedBy,
          submission.reviewedAt,
          submission.submittedAt,
          submission.publishedAt,
        ],
      );
      return mapSubmission(result.rows[0] as Record<string, unknown>);
    });
  }

  async getSubmissionById(id: string): Promise<PluginSubmissionEntity | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_submissions WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubmission(row) : null;
    });
  }

  async listSubmissions(
    filter: PluginSubmissionFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: PluginSubmissionEntity[]; total: number }> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.accountId) {
        params.push(filter.accountId);
        where.push(`account_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalRes = await client.query(
        `SELECT count(*)::int AS c FROM developer_portal_submissions ${whereSql}`,
        params,
      );
      const total = Number((totalRes.rows[0] as { c: number }).c);
      const limit = Math.max(1, pageSize);
      const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
      const dataRes = await client.query(
        `SELECT * FROM developer_portal_submissions ${whereSql}
          ORDER BY submitted_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return {
        data: (dataRes.rows as Record<string, unknown>[]).map(mapSubmission),
        total,
      };
    });
  }

  async updateSubmissionStatus(
    id: string,
    status: PluginSubmissionEntity['status'],
    reviewNotes?: string | null,
    reviewedBy?: string | null,
  ): Promise<PluginSubmissionEntity | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `UPDATE developer_portal_submissions SET
           status = $2,
           review_notes = COALESCE($3, review_notes),
           reviewed_by = COALESCE($4, reviewed_by),
           reviewed_at = CASE WHEN $4 IS NOT NULL THEN now() ELSE reviewed_at END,
           published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END
         WHERE id = $1
         RETURNING *`,
        [id, status, reviewNotes ?? null, reviewedBy ?? null],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapSubmission(row) : null;
    });
  }

  // ─── Marketplace listings (platform scope — PRC-H049) ─────────────────────

  async createListing(listing: MarketplaceListingEntity): Promise<MarketplaceListingEntity> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      // PRC-M219 defence-in-depth: do not overwrite a listing owned by another
      // account. Same-owner re-publish updates in place (preserves stats).
      const result = await client.query(
        `INSERT INTO developer_portal_listings (
           name, display_name, description, category, version, author, account_id,
           icon_url, screenshots, tags, license, installs, average_rating,
           rating_count, published_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16
         )
         ON CONFLICT (name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           version = EXCLUDED.version,
           author = EXCLUDED.author,
           icon_url = EXCLUDED.icon_url,
           screenshots = EXCLUDED.screenshots,
           tags = EXCLUDED.tags,
           license = EXCLUDED.license,
           updated_at = now()
         WHERE developer_portal_listings.account_id = EXCLUDED.account_id
         RETURNING *`,
        [
          listing.name,
          listing.displayName,
          listing.description,
          listing.category,
          listing.version,
          listing.author,
          listing.accountId,
          listing.iconUrl,
          JSON.stringify(listing.screenshots ?? []),
          JSON.stringify(listing.tags ?? []),
          listing.license,
          listing.installs,
          listing.averageRating,
          listing.ratingCount,
          listing.publishedAt,
          listing.updatedAt,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        // Conflict with a listing owned by a different account — name hijack blocked.
        throw new Error(`Listing '${listing.name}' is owned by another account`);
      }
      return mapListing(row);
    });
  }

  async getListingByName(name: string): Promise<MarketplaceListingEntity | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_listings WHERE name = $1`,
        [name],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapListing(row) : null;
    });
  }

  async searchListings(
    filter: MarketplaceFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: MarketplaceListingEntity[]; total: number }> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.category) {
        params.push(filter.category);
        where.push(`category = $${params.length}`);
      }
      if (filter.search) {
        params.push(`%${filter.search.toLowerCase()}%`);
        where.push(
          `(lower(name) LIKE $${params.length} OR lower(display_name) LIKE $${params.length} OR lower(description) LIKE $${params.length})`,
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const sortColumn =
        filter.sortBy === 'installs'
          ? 'installs'
          : filter.sortBy === 'rating'
            ? 'average_rating'
            : filter.sortBy === 'name'
              ? 'name'
              : 'published_at';
      const sortOrder = filter.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const totalRes = await client.query(
        `SELECT count(*)::int AS c FROM developer_portal_listings ${whereSql}`,
        params,
      );
      const total = Number((totalRes.rows[0] as { c: number }).c);
      const limit = Math.max(1, pageSize);
      const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
      const dataRes = await client.query(
        `SELECT * FROM developer_portal_listings ${whereSql}
          ORDER BY ${sortColumn} ${sortOrder}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return {
        data: (dataRes.rows as Record<string, unknown>[]).map(mapListing),
        total,
      };
    });
  }

  async updateListingStats(
    name: string,
    updates: Partial<Pick<MarketplaceListingEntity, 'installs' | 'averageRating' | 'ratingCount'>>,
  ): Promise<MarketplaceListingEntity | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `UPDATE developer_portal_listings SET
           installs = COALESCE($2, installs),
           average_rating = COALESCE($3, average_rating),
           rating_count = COALESCE($4, rating_count),
           updated_at = now()
         WHERE name = $1
         RETURNING *`,
        [
          name,
          updates.installs ?? null,
          updates.averageRating ?? null,
          updates.ratingCount ?? null,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapListing(row) : null;
    });
  }

  async deleteListing(name: string): Promise<boolean> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `DELETE FROM developer_portal_listings WHERE name = $1`,
        [name],
      );
      return ((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }
}

function mapSubmission(row: Record<string, unknown>): PluginSubmissionEntity {
  return {
    id: String(row['id']),
    accountId: String(row['account_id']),
    name: String(row['name']),
    version: String(row['version']),
    displayName: String(row['display_name']),
    description: String(row['description']),
    category: String(row['category']),
    supportedProductVersions: String(row['supported_product_versions']),
    requiredPermissions: parseJsonArray(row['required_permissions']),
    sourceUrl: row['source_url'] == null ? null : String(row['source_url']),
    documentationUrl: row['documentation_url'] == null ? null : String(row['documentation_url']),
    iconUrl: row['icon_url'] == null ? null : String(row['icon_url']),
    screenshots: parseJsonArray(row['screenshots']),
    tags: parseJsonArray(row['tags']),
    license: row['license'] == null ? null : String(row['license']),
    status: String(row['status']) as PluginSubmissionEntity['status'],
    reviewNotes: row['review_notes'] == null ? null : String(row['review_notes']),
    reviewedBy: row['reviewed_by'] == null ? null : String(row['reviewed_by']),
    reviewedAt: toDateOrNull(row['reviewed_at']),
    submittedAt: toDate(row['submitted_at']),
    publishedAt: toDateOrNull(row['published_at']),
  };
}

function mapListing(row: Record<string, unknown>): MarketplaceListingEntity {
  return {
    name: String(row['name']),
    displayName: String(row['display_name']),
    description: String(row['description']),
    category: String(row['category']),
    version: String(row['version']),
    author: String(row['author']),
    accountId: String(row['account_id']),
    iconUrl: row['icon_url'] == null ? null : String(row['icon_url']),
    screenshots: parseJsonArray(row['screenshots']),
    tags: parseJsonArray(row['tags']),
    license: row['license'] == null ? null : String(row['license']),
    installs: Number(row['installs'] ?? 0),
    averageRating: Number(row['average_rating'] ?? 0),
    ratingCount: Number(row['rating_count'] ?? 0),
    publishedAt: toDate(row['published_at']),
    updatedAt: toDate(row['updated_at']),
  };
}
