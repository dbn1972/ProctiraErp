/**
 * In-memory search index — Wave-3 foundation stub.
 *
 * Stores documents per tenant bucket and filters strictly by tenantId on
 * search. Substring matching stands in for full-text ranking until a real
 * backend adapter is wired.
 */

import type {
  IndexOptions,
  LegacySearchDocument,
  SearchDocument,
  SearchDocumentInput,
  SearchHit,
  SearchIndexAdapter,
  SearchIndexHealth,
  SearchOptions,
} from '../types.js';

function buildDocumentId(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function scoreMatch(body: string, title: string, query: string): number {
  const needle = query.toLowerCase();
  const bodyHit = body.toLowerCase().includes(needle);
  const titleHit = title.toLowerCase().includes(needle);
  if (!bodyHit && !titleHit) return 0;
  if (titleHit && bodyHit) return 1.0;
  return titleHit ? 0.9 : 0.75;
}

export class InMemorySearchIndex implements SearchIndexAdapter {
  private readonly docs = new Map<string, SearchDocument[]>();

  indexSync(document: SearchDocumentInput, options: IndexOptions): void {
    const bucket = this.docs.get(options.tenantId) ?? [];
    const id = buildDocumentId(document.entityType, document.entityId);
    const next: SearchDocument = {
      id,
      tenantId: options.tenantId,
      entityType: document.entityType,
      entityId: document.entityId,
      title: document.title,
      body: document.body,
      metadata: document.metadata ?? {},
      indexedAt: new Date(),
    };

    const existingIdx = bucket.findIndex((doc) => doc.id === id);
    if (existingIdx >= 0) {
      bucket[existingIdx] = next;
    } else {
      bucket.push(next);
    }
    this.docs.set(options.tenantId, bucket);
  }

  removeSync(tenantId: string, entityType: string, entityId: string): void {
    const bucket = this.docs.get(tenantId);
    if (!bucket) return;
    const id = buildDocumentId(entityType, entityId);
    this.docs.set(
      tenantId,
      bucket.filter((doc) => doc.id !== id),
    );
  }

  searchSync(options: SearchOptions): SearchHit[] {
    const bucket = this.docs.get(options.tenantId) ?? [];
    const allowedTypes = options.entityTypes ? new Set(options.entityTypes) : null;
    const limit = options.limit ?? 50;

    const hits: SearchHit[] = [];
    for (const document of bucket) {
      if (allowedTypes && !allowedTypes.has(document.entityType)) continue;
      const score = scoreMatch(document.body, document.title, options.query);
      if (score > 0) hits.push({ document, score });
    }

    hits.sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id));
    return hits.slice(0, limit);
  }

  /** Verification helper — exposes all tenants (test/diagnostic only). */
  allDocuments(): SearchDocument[] {
    return Array.from(this.docs.values()).flat();
  }

  clear(): void {
    this.docs.clear();
  }

  async index(document: SearchDocumentInput, options: IndexOptions): Promise<void> {
    this.indexSync(document, options);
  }

  async remove(tenantId: string, entityType: string, entityId: string): Promise<void> {
    this.removeSync(tenantId, entityType, entityId);
  }

  async search(options: SearchOptions): Promise<SearchHit[]> {
    return this.searchSync(options);
  }

  async healthCheck(): Promise<SearchIndexHealth> {
    return {
      healthy: true,
      message: 'In-memory search index ready',
      adapter: 'memory',
      checkedAt: new Date(),
    };
  }
}

/**
 * Sync legacy simulator used by tenant-isolation gate Category 5 tests.
 * Maps the simplified { id, tenantId, content } shape onto the foundation
 * document model without rewriting Wave-1 isolation tests.
 */
export class TenantScopedSearchIndex {
  private readonly inner = new InMemorySearchIndex();

  index(doc: LegacySearchDocument): void {
    this.inner.indexSync(
      {
        entityType: 'legacy',
        entityId: doc.id,
        title: doc.id,
        body: doc.content,
      },
      { tenantId: doc.tenantId },
    );
  }

  search(tenantId: string, query: string): LegacySearchDocument[] {
    return this.inner.searchSync({ tenantId, query }).map(({ document }) => ({
      id: document.entityId,
      tenantId: document.tenantId,
      content: document.body,
    }));
  }

  allDocs(): LegacySearchDocument[] {
    return this.inner.allDocuments().map((document) => ({
      id: document.entityId,
      tenantId: document.tenantId,
      content: document.body,
    }));
  }

  clear(): void {
    this.inner.clear();
  }
}
