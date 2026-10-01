/**
 * PRC-L494: search index fails closed — no blank tenant scope, no match-all empty
 * query, and no silent in-memory stub in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemorySearchIndex } from '../adapters/in-memory-search-index.js';
import { createSearchIndexFromEnv } from '../factory.js';

const doc = { entityType: 'student', entityId: 's1', title: 'Riverside', body: 'grade 5' };

describe('search-index fail-closed (PRC-L494)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('empty or whitespace query returns []', async () => {
    const index = new InMemorySearchIndex();
    await index.index(doc, { tenantId: 'tenant-a' });
    await expect(index.search({ tenantId: 'tenant-a', query: '' })).resolves.toEqual([]);
    await expect(index.search({ tenantId: 'tenant-a', query: '   ' })).resolves.toEqual([]);
  });

  it('rejects an empty tenantId on search, index and remove', async () => {
    const index = new InMemorySearchIndex();
    await expect(index.search({ tenantId: '', query: 'riverside' })).rejects.toThrow(
      /tenantId is required/,
    );
    await expect(index.index(doc, { tenantId: ' ' })).rejects.toThrow(/tenantId is required/);
    await expect(index.remove('', 'student', 's1')).rejects.toThrow(/tenantId is required/);
  });

  it('tenant A cannot see tenant B documents', async () => {
    const index = new InMemorySearchIndex();
    await index.index(doc, { tenantId: 'tenant-b' });
    await expect(index.search({ tenantId: 'tenant-a', query: 'riverside' })).resolves.toEqual([]);
  });

  it('refuses the in-memory adapter in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEARCH_INDEX_ADAPTER', '');
    expect(() => createSearchIndexFromEnv()).toThrow(/not allowed when NODE_ENV=production/);
    vi.stubEnv('SEARCH_INDEX_ADAPTER', 'memory');
    expect(() => createSearchIndexFromEnv()).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('still defaults to memory outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SEARCH_INDEX_ADAPTER', '');
    expect(createSearchIndexFromEnv()).toBeInstanceOf(InMemorySearchIndex);
  });
});
