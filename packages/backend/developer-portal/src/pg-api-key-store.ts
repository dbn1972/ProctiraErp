/**
 * Postgres-backed API key store (W1-ARCH-01 / C3).
 *
 * Persists developer-portal API keys via db/sql/055_developer_portal_api_keys_schema.sql.
 * Uses withPgTenant for tenant-scoped CRUD and withPlatformScope for hash lookup
 * (validate-key has no tenant context upfront).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, withPlatformScope, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import type { ApiKeyEntity, ApiKeyFilter } from './developer-portal-repository.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getSharedDeveloperPortalPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/055_developer_portal_api_keys_schema.sql'),
    join(process.cwd(), 'db/sql/055_developer_portal_api_keys_schema.sql'),
    join(process.cwd(), '../../db/sql/055_developer_portal_api_keys_schema.sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensureDeveloperPortalApiKeySchema(
  pool: PgPoolLike = getSharedDeveloperPortalPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for developer-portal API key schema');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return toDate(value);
}

function parseScopes(value: unknown): string[] {
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

function mapApiKey(row: Record<string, unknown>): ApiKeyEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    accountId: String(row.account_id),
    name: String(row.name),
    keyHash: String(row.key_hash),
    keyPrefix: String(row.key_prefix),
    scopes: parseScopes(row.scopes),
    status: String(row.status) as ApiKeyEntity['status'],
    expiresAt: toDateOrNull(row.expires_at),
    lastUsedAt: toDateOrNull(row.last_used_at),
    createdAt: toDate(row.created_at),
  };
}

export class PgApiKeyStore {
  constructor(private readonly pool: PgPoolLike) {}

  async createApiKey(key: ApiKeyEntity): Promise<ApiKeyEntity> {
    return withPgTenant(this.pool, key.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO developer_portal_api_keys (
           id, tenant_id, account_id, name, key_hash, key_prefix, scopes, status,
           expires_at, last_used_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         RETURNING *`,
        [
          key.id,
          key.tenantId,
          key.accountId,
          key.name,
          key.keyHash,
          key.keyPrefix,
          JSON.stringify(key.scopes),
          key.status,
          key.expiresAt,
          key.lastUsedAt,
          key.createdAt,
        ],
      );
      return mapApiKey(result.rows[0] as Record<string, unknown>);
    });
  }

  async getApiKeyById(id: string): Promise<ApiKeyEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(`SELECT * FROM developer_portal_api_keys WHERE id = $1`, [
        id,
      ]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapApiKey(row) : null;
    });
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    return withPlatformScope(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM developer_portal_api_keys WHERE key_hash = $1`,
        [keyHash],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapApiKey(row) : null;
    });
  }

  async listApiKeys(
    filter: ApiKeyFilter,
    page: number,
    pageSize: number,
  ): Promise<{ data: ApiKeyEntity[]; total: number }> {
    if (!filter.tenantId) {
      throw new Error('tenantId is required for Postgres API key listing');
    }
    return withPgTenant(this.pool, filter.tenantId, async (client) => {
      const conditions = ['account_id = $1'];
      const values: unknown[] = [filter.accountId];
      if (filter.status) {
        values.push(filter.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.join(' AND ');
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM developer_portal_api_keys WHERE ${where}`,
        values,
      );
      const total = Number((countResult.rows[0] as { total: number }).total);
      const offset = (page - 1) * pageSize;
      values.push(pageSize, offset);
      const listResult = await client.query(
        `SELECT * FROM developer_portal_api_keys
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        data: listResult.rows.map((row) => mapApiKey(row as Record<string, unknown>)),
        total,
      };
    });
  }

  async updateApiKeyStatus(
    id: string,
    status: ApiKeyEntity['status'],
    tenantId: string,
  ): Promise<ApiKeyEntity | null> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE developer_portal_api_keys SET status = $2 WHERE id = $1 RETURNING *`,
        [id, status],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapApiKey(row) : null;
    });
  }

  async updateApiKeyLastUsed(id: string, lastUsedAt: Date, tenantId: string): Promise<void> {
    await withPgTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `UPDATE developer_portal_api_keys SET last_used_at = $2 WHERE id = $1`,
        [id, lastUsedAt],
      );
    });
  }

  /** Test helper: read raw row without ORM mapping. */
  async readRawKeyHash(id: string): Promise<string | null> {
    return withPlatformScope(this.pool, async (client: PgQueryable) => {
      const result = await client.query(
        `SELECT key_hash FROM developer_portal_api_keys WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as { key_hash?: string } | undefined;
      return row?.key_hash ?? null;
    });
  }
}
