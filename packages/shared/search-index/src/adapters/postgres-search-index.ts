/**
 * PRC-L494: Postgres full-text search adapter on `search_index_documents`
 * (db/sql/065_search_index_schema.sql: generated weighted tsvector + GIN,
 * FORCE RLS on `app.tenant_id`).
 *
 * Every operation runs in its own transaction with `app.tenant_id` bound
 * transaction-locally, and every statement also filters `tenant_id = $1`, so
 * isolation holds even for a role that bypasses RLS. The pool is injected
 * (e.g. the gateway's shared pg pool) — this package takes no pg dependency.
 */
import type {
  IndexOptions,
  SearchDocument,
  SearchDocumentInput,
  SearchHit,
  SearchIndexAdapter,
  SearchIndexHealth,
  SearchOptions,
} from '../types.js';

export interface SearchPgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

export interface SearchPgPool {
  connect(): Promise<SearchPgClient>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 256;

function assertTenant(tenantId: string): void {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('search index: tenantId must be a UUID');
  }
}

type Row = Record<string, unknown>;

function toDocument(row: Row): SearchDocument {
  const metadata = row['metadata'];
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    entityType: String(row['entity_type']),
    entityId: String(row['entity_id']),
    title: String(row['title']),
    body: String(row['body']),
    metadata: metadata && typeof metadata === 'object' ? (metadata as Record<string, string>) : {},
    indexedAt:
      row['indexed_at'] instanceof Date ? row['indexed_at'] : new Date(String(row['indexed_at'])),
  };
}

export class PostgresSearchIndex implements SearchIndexAdapter {
  constructor(private readonly pool: SearchPgPool) {}

  private async withTenant<T>(
    tenantId: string,
    fn: (client: SearchPgClient) => Promise<T>,
  ): Promise<T> {
    assertTenant(tenantId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async index(document: SearchDocumentInput, options: IndexOptions): Promise<void> {
    await this.withTenant(options.tenantId, (c) =>
      c.query(
        `INSERT INTO search_index_documents
           (tenant_id, entity_type, entity_id, title, body, metadata, indexed_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, now())
         ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
           SET title = EXCLUDED.title, body = EXCLUDED.body,
               metadata = EXCLUDED.metadata, indexed_at = now()`,
        [
          options.tenantId,
          document.entityType,
          document.entityId,
          document.title,
          document.body,
          JSON.stringify(document.metadata ?? {}),
        ],
      ),
    );
  }

  async remove(tenantId: string, entityType: string, entityId: string): Promise<void> {
    await this.withTenant(tenantId, (c) =>
      c.query(
        `DELETE FROM search_index_documents
          WHERE tenant_id = $1::uuid AND entity_type = $2 AND entity_id = $3`,
        [tenantId, entityType, entityId],
      ),
    );
  }

  async search(options: SearchOptions): Promise<SearchHit[]> {
    const query = options.query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 20, MAX_LIMIT));
    const types = options.entityTypes?.length ? options.entityTypes : null;
    return this.withTenant(options.tenantId, async (c) => {
      const res = await c.query(
        `SELECT id, tenant_id, entity_type, entity_id, title, body, metadata, indexed_at,
                ts_rank(search_vector, q) AS score
           FROM search_index_documents, websearch_to_tsquery('simple', $2) AS q
          WHERE tenant_id = $1::uuid
            AND search_vector @@ q
            AND ($3::text[] IS NULL OR entity_type = ANY($3::text[]))
          ORDER BY score DESC, indexed_at DESC
          LIMIT $4`,
        [options.tenantId, query, types, limit],
      );
      return (res.rows as Row[]).map((row) => ({
        document: toDocument(row),
        score: Number(row['score'] ?? 0),
      }));
    });
  }

  async healthCheck(): Promise<SearchIndexHealth> {
    const checkedAt = new Date();
    try {
      const client = await this.pool.connect();
      let present = false;
      try {
        const res = await client.query(
          `SELECT to_regclass('public.search_index_documents') IS NOT NULL AS present`,
        );
        present = Boolean((res.rows[0] as Row | undefined)?.['present']);
      } finally {
        client.release();
      }
      if (!present) {
        return {
          healthy: false,
          message: 'search_index_documents table missing (apply db/sql/065)',
          adapter: 'postgres',
          checkedAt,
        };
      }
      return {
        healthy: true,
        message: 'postgres search index reachable',
        adapter: 'postgres',
        checkedAt,
      };
    } catch (err) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
        adapter: 'postgres',
        checkedAt,
      };
    }
  }
}
