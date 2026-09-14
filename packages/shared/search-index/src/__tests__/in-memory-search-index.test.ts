import { describe, expect, it, beforeEach } from 'vitest';

import { InMemorySearchIndex } from '../adapters/in-memory-search-index.js';
import { createSearchIndex } from '../factory.js';

describe('InMemorySearchIndex', () => {
  let index: InMemorySearchIndex;

  beforeEach(() => {
    index = new InMemorySearchIndex();
  });

  it('indexes and finds documents within the same tenant', async () => {
    await index.index(
      {
        entityType: 'student',
        entityId: 's-1',
        title: 'Ada Lovelace',
        body: 'Grade 10 student at Riverside school',
      },
      { tenantId: 'tenant-a' },
    );

    const hits = await index.search({ tenantId: 'tenant-a', query: 'riverside' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.document.entityId).toBe('s-1');
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('never returns documents from a foreign tenant', async () => {
    await index.index(
      {
        entityType: 'student',
        entityId: 's-secret',
        title: 'Hidden pupil',
        body: 'unique-token-xyz',
      },
      { tenantId: 'tenant-b' },
    );

    const hits = await index.search({ tenantId: 'tenant-a', query: 'unique-token-xyz' });
    expect(hits).toEqual([]);
  });

  it('replaces documents on re-index with the same entity key', async () => {
    await index.index(
      {
        entityType: 'staff',
        entityId: 't-1',
        title: 'Mr Smith',
        body: 'Math teacher',
      },
      { tenantId: 'tenant-a' },
    );
    await index.index(
      {
        entityType: 'staff',
        entityId: 't-1',
        title: 'Mr Smith',
        body: 'Science teacher',
      },
      { tenantId: 'tenant-a' },
    );

    const mathHits = await index.search({ tenantId: 'tenant-a', query: 'math' });
    expect(mathHits).toHaveLength(0);

    const scienceHits = await index.search({ tenantId: 'tenant-a', query: 'science' });
    expect(scienceHits).toHaveLength(1);
  });

  it('filters by entity type when requested', async () => {
    await index.index(
      { entityType: 'student', entityId: '1', title: 'A', body: 'alpha term' },
      { tenantId: 'tenant-a' },
    );
    await index.index(
      { entityType: 'staff', entityId: '2', title: 'B', body: 'alpha term' },
      { tenantId: 'tenant-a' },
    );

    const hits = await index.search({
      tenantId: 'tenant-a',
      query: 'alpha',
      entityTypes: ['student'],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.document.entityType).toBe('student');
  });

  it('remove drops the document from future searches', async () => {
    await index.index(
      { entityType: 'invoice', entityId: 'inv-1', title: 'Fee', body: 'overdue invoice' },
      { tenantId: 'tenant-a' },
    );
    await index.remove('tenant-a', 'invoice', 'inv-1');

    const hits = await index.search({ tenantId: 'tenant-a', query: 'overdue' });
    expect(hits).toEqual([]);
  });
});

describe('createSearchIndex', () => {
  it('returns a healthy in-memory adapter by default', async () => {
    const index = createSearchIndex();
    const health = await index.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.adapter).toBe('memory');
  });
});
