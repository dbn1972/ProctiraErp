/**
 * Search index factory — selects adapter implementation from config.
 */

import { isProductionNodeEnv } from '@proctira/common/node-env';

import { InMemorySearchIndex } from './adapters/in-memory-search-index.js';
import type { SearchIndexAdapter, SearchIndexConfig } from './types.js';

/**
 * Create a SearchIndexAdapter from configuration.
 * Wave 3 wires only the in-memory stub; postgres is reserved for a later slice.
 */
export function createSearchIndex(
  config: SearchIndexConfig = { adapter: 'memory' },
): SearchIndexAdapter {
  switch (config.adapter) {
    case 'memory':
      return new InMemorySearchIndex();
    case 'postgres':
      throw new Error(
        'Postgres search index adapter is not implemented yet — use adapter: "memory" or wire OpenSearch/pg tsvector in a follow-up slice.',
      );
    default: {
      const exhaustive: never = config;
      throw new Error(
        `Unsupported search index adapter: ${(exhaustive as SearchIndexConfig).adapter}`,
      );
    }
  }
}

/**
 * Environment-driven factory — defaults to in-memory for dev/test.
 * PRC-L494: refuses the in-memory stub when NODE_ENV=production (fail fast instead
 * of silently serving a per-process, non-durable index).
 */
export function createSearchIndexFromEnv(): SearchIndexAdapter {
  const adapter = process.env.SEARCH_INDEX_ADAPTER?.trim().toLowerCase();
  if (!adapter || adapter === 'memory') {
    if (isProductionNodeEnv(process.env.NODE_ENV)) {
      throw new Error(
        'In-memory search index is not allowed when NODE_ENV=production; configure a durable SEARCH_INDEX_ADAPTER',
      );
    }
    return createSearchIndex({ adapter: 'memory' });
  }
  if (adapter === 'postgres') {
    const connectionUrl = process.env.DATABASE_URL?.trim();
    if (!connectionUrl) {
      throw new Error('DATABASE_URL is required when SEARCH_INDEX_ADAPTER=postgres');
    }
    return createSearchIndex({ adapter: 'postgres', connectionUrl });
  }
  throw new Error(`Unknown SEARCH_INDEX_ADAPTER: ${adapter}`);
}
