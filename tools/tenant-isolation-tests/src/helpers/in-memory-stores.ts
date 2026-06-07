/**
 * In-memory simulators for the isolation gate.
 *
 * Each simulator models the contract that a real subsystem must enforce
 * (RLS-scoped DB, tenant-namespaced cache, tenant-routed search index,
 * tenant-prefixed report storage). They deliberately do *not* short-circuit
 * tenant filtering: a bug in any of these classes would surface as a real
 * test failure, which mirrors what happens in production.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */

import type { IsolationRecord } from './arbitraries.js';

// ---------------------------------------------------------------------------
// Tenant-scoped query layer (mimics PostgreSQL RLS)
// ---------------------------------------------------------------------------

/**
 * Mirrors the semantics of `app.current_tenant_id` + RLS policies. Every
 * read/write uses the session tenant. Cross-tenant inserts throw, just like
 * a `WITH CHECK` policy violation would on real Postgres.
 */
export class TenantScopedQueryLayer<T extends { id: string; tenantId: string }> {
  private readonly data = new Map<string, T[]>();
  private currentTenantId: string | null = null;

  setCurrentTenant(tenantId: string): void {
    this.currentTenantId = tenantId;
  }

  clearTenant(): void {
    this.currentTenantId = null;
  }

  insert(record: T): void {
    if (!this.currentTenantId) {
      throw new Error('RLS violation: no tenant context set');
    }
    if (record.tenantId !== this.currentTenantId) {
      throw new Error(
        `RLS violation: cannot insert tenantId=${record.tenantId} ` +
          `while session tenant is ${this.currentTenantId}`,
      );
    }
    const bucket = this.data.get(record.tenantId) ?? [];
    bucket.push(record);
    this.data.set(record.tenantId, bucket);
  }

  findAll(): T[] {
    if (!this.currentTenantId) return [];
    return [...(this.data.get(this.currentTenantId) ?? [])];
  }

  findById(id: string): T | null {
    if (!this.currentTenantId) return null;
    return (this.data.get(this.currentTenantId) ?? []).find((r) => r.id === id) ?? null;
  }

  count(): number {
    if (!this.currentTenantId) return 0;
    return (this.data.get(this.currentTenantId) ?? []).length;
  }

  update(id: string, updates: Partial<Omit<T, 'id' | 'tenantId'>>): boolean {
    if (!this.currentTenantId) return false;
    const bucket = this.data.get(this.currentTenantId) ?? [];
    const target = bucket.find((r) => r.id === id);
    if (!target) return false;
    Object.assign(target, updates);
    return true;
  }

  delete(id: string): boolean {
    if (!this.currentTenantId) return false;
    const bucket = this.data.get(this.currentTenantId) ?? [];
    const idx = bucket.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    bucket.splice(idx, 1);
    return true;
  }

  /** Test-only helper: total rows across all tenants (verification side). */
  totalAcrossTenants(): number {
    let total = 0;
    for (const bucket of this.data.values()) total += bucket.length;
    return total;
  }

  clear(): void {
    this.data.clear();
    this.currentTenantId = null;
  }
}

// ---------------------------------------------------------------------------
// Tenant-scoped search index
// ---------------------------------------------------------------------------

export interface SearchDocument {
  id: string;
  tenantId: string;
  content: string;
}

export class TenantScopedSearchIndex {
  private readonly docs = new Map<string, SearchDocument[]>();

  index(doc: SearchDocument): void {
    const bucket = this.docs.get(doc.tenantId) ?? [];
    bucket.push(doc);
    this.docs.set(doc.tenantId, bucket);
  }

  /** Returns docs that contain the query term, scoped to the calling tenant. */
  search(tenantId: string, query: string): SearchDocument[] {
    const bucket = this.docs.get(tenantId) ?? [];
    const needle = query.toLowerCase();
    return bucket.filter((doc) => doc.content.toLowerCase().includes(needle));
  }

  /** All docs across all tenants — verification helper only. */
  allDocs(): SearchDocument[] {
    return Array.from(this.docs.values()).flat();
  }

  clear(): void {
    this.docs.clear();
  }
}

// ---------------------------------------------------------------------------
// Tenant-namespaced cache (Redis-style)
// ---------------------------------------------------------------------------

export class TenantNamespacedCache {
  private readonly store = new Map<string, string>();

  static buildKey(tenantId: string, key: string): string {
    return `tenant:${tenantId}:${key}`;
  }

  set(tenantId: string, key: string, value: string): void {
    this.store.set(TenantNamespacedCache.buildKey(tenantId, key), value);
  }

  get(tenantId: string, key: string): string | undefined {
    return this.store.get(TenantNamespacedCache.buildKey(tenantId, key));
  }

  delete(tenantId: string, key: string): boolean {
    return this.store.delete(TenantNamespacedCache.buildKey(tenantId, key));
  }

  /** Drop every key for a tenant (decommission scenario). */
  flushTenant(tenantId: string): number {
    const prefix = `tenant:${tenantId}:`;
    let removed = 0;
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  rawKeys(): string[] {
    return [...this.store.keys()];
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Report engine with tenant-scoped output paths
// ---------------------------------------------------------------------------

export interface ReportRequest {
  tenantId: string;
  reportType: string;
  format: 'xlsx' | 'pdf' | 'csv';
  filters?: Record<string, unknown>;
}

export interface ReportResult {
  tenantId: string;
  recordCount: number;
  filePath: string;
  records: Array<Pick<IsolationRecord, 'id' | 'tenantId'>>;
}

export class TenantScopedReportEngine {
  private readonly data = new Map<string, IsolationRecord[]>();

  seed(tenantId: string, records: ReadonlyArray<{ id: string; name: string; code: string }>): void {
    const bucket = this.data.get(tenantId) ?? [];
    for (const r of records) {
      bucket.push({ ...r, tenantId });
    }
    this.data.set(tenantId, bucket);
  }

  generate(request: ReportRequest): ReportResult {
    const records = this.data.get(request.tenantId) ?? [];
    const filePath = `tenants/${request.tenantId}/reports/${request.reportType}.${request.format}`;
    return {
      tenantId: request.tenantId,
      recordCount: records.length,
      filePath,
      records: records.map(({ id, tenantId }) => ({ id, tenantId })),
    };
  }

  clear(): void {
    this.data.clear();
  }
}
