/**
 * Core types for the tenant-scoped search index foundation (W3-D2).
 *
 * All adapters must enforce tenant isolation at query time — documents from
 * foreign tenants must never appear in search results.
 */

/** Input payload when indexing a searchable entity. */
export interface SearchDocumentInput {
  /** Domain entity kind (e.g. student, staff, invoice). */
  entityType: string;
  /** Stable entity identifier within the tenant. */
  entityId: string;
  /** Short display title surfaced in result lists. */
  title: string;
  /** Full-text body used for matching. */
  body: string;
  /** Optional facet metadata (board, campus, status, …). */
  metadata?: Record<string, string>;
}

/** Stored search document including tenant ownership. */
export interface SearchDocument {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  metadata: Record<string, string>;
  indexedAt: Date;
}

/** Single ranked search result. */
export interface SearchHit {
  document: SearchDocument;
  score: number;
}

/** Options passed to index(). */
export interface IndexOptions {
  tenantId: string;
}

/** Options passed to search() — tenantId is mandatory for isolation. */
export interface SearchOptions {
  tenantId: string;
  query: string;
  entityTypes?: string[];
  limit?: number;
}

/** Health probe result for monitoring adapters. */
export interface SearchIndexHealth {
  healthy: boolean;
  message: string;
  adapter: string;
  checkedAt: Date;
}

/**
 * Adapter contract for tenant-scoped search indexing.
 * Production backends (OpenSearch, Postgres tsvector, …) implement this;
 * the in-memory adapter is the Wave-3 foundation stub.
 */
export interface SearchIndexAdapter {
  index(document: SearchDocumentInput, options: IndexOptions): Promise<void>;
  remove(tenantId: string, entityType: string, entityId: string): Promise<void>;
  search(options: SearchOptions): Promise<SearchHit[]>;
  healthCheck(): Promise<SearchIndexHealth>;
}

/** Factory configuration — only in-memory is wired in Wave 3. */
export type SearchIndexConfig =
  | { adapter: 'memory' }
  | { adapter: 'postgres'; connectionUrl: string };

/** Legacy document shape used by tenant-isolation gate simulators. */
export interface LegacySearchDocument {
  id: string;
  tenantId: string;
  content: string;
}
