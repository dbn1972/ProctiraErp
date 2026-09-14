/**
 * @proctira/search-index - Tenant-scoped search index foundation (W3-D2)
 *
 * Provides:
 * - SearchIndexAdapter interface for pluggable backends
 * - InMemorySearchIndex stub for dev/test and isolation gate simulators
 * - Factory for configuration-driven adapter selection
 * - PG schema in db/sql/065_search_index_schema.sql for durable indexing
 */

export type {
  SearchDocumentInput,
  SearchDocument,
  SearchHit,
  SearchOptions,
  IndexOptions,
  SearchIndexAdapter,
  SearchIndexConfig,
  SearchIndexHealth,
  LegacySearchDocument,
} from './types.js';

export { InMemorySearchIndex, TenantScopedSearchIndex } from './adapters/in-memory-search-index.js';
export { createSearchIndex, createSearchIndexFromEnv } from './factory.js';
