/**
 * Durable Audit Store (PRC-L590)
 *
 * Moves the student in-package audit trail off the ephemeral
 * {@link InMemoryAuditStore} and onto the platform's durable, tamper-evident,
 * append-only audit chain (`@proctira/backend-audit`).
 *
 * The student package takes no new dependency on `@proctira/backend-audit`
 * (that would change its package.json / the lockfile, which this batch must
 * not do). Instead the durable chained store is injected as a port:
 * `apps/api-gateway/domain-plugins.ts` already depends on both this package and
 * `@proctira/backend-audit`, so it wires the real durable repository
 * (`appendAuditEntryOnClient` / `PgAuditRepository`) into this adapter. Unit and
 * property tests inject a chained stand-in.
 *
 * Because appends run on the durable store, every student audit entry is:
 * - persisted beyond process lifetime (not lost on restart), and
 * - part of the per-tenant hash chain (`chainSeq`/`prevHash`/`entryHash`), so
 *   loss or tampering is detectable.
 *
 * Requirements:
 * - 21.1: Record an audit entry for every create/update/delete.
 * - 21.3: Append-only, tamper-evident durable storage.
 */

import type { AuditStore } from './audit-store.js';
import type {
  AuditChange,
  AuditEntry,
  AuditOperation,
  AuditQueryFilter,
  CreateAuditEntryInput,
} from './types.js';

/**
 * A durable audit record as returned by the injected durable chained store.
 * Mirrors the subset of `@proctira/backend-audit`'s `AuditLogEntry` this
 * adapter needs, keeping the student package free of that dependency.
 */
export interface DurableAuditRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  ipAddress: string;
  changes: AuditChange[];
  /** ISO 8601 timestamp assigned by the caller/store. */
  timestamp: string;
  /** Tamper-evident per-tenant chain position (assigned by the durable store). */
  chainSeq: number | null;
  prevHash: string | null;
  entryHash: string;
}

/**
 * Input handed to the durable store for a single append. `id`/`timestamp` are
 * provided so the adapter and the durable store agree on identity and time;
 * the durable store assigns the chain fields.
 */
export interface DurableAuditAppendInput {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  ipAddress: string;
  changes: AuditChange[];
  timestamp: string;
}

/**
 * The injected durable-append port. The gateway implements this over the
 * same-transaction durable append (`appendAuditEntryOnClient`) or the
 * `PgAuditRepository`; the entry is written append-only into the hash chain.
 */
export type DurableAuditAppend = (input: DurableAuditAppendInput) => Promise<DurableAuditRecord>;

/**
 * Optional read ports. When the durable store exposes query/count/findById,
 * the gateway wires them so the student module can read its own trail back
 * from the durable store. Reads are not required to record audit entries, so
 * they are optional; when absent, read methods throw a clear error rather than
 * silently returning stale in-memory data.
 */
export interface DurableAuditReadPorts {
  query?: (
    filter: AuditQueryFilter,
    limit: number,
    offset: number,
  ) => Promise<DurableAuditRecord[]>;
  count?: (filter: AuditQueryFilter) => Promise<number>;
  findById?: (id: string) => Promise<DurableAuditRecord | null>;
}

export interface DurableAuditStoreOptions extends DurableAuditReadPorts {
  append: DurableAuditAppend;
  /** Identity + time sources (overridable in tests for determinism). */
  newId?: () => string;
  now?: () => Date;
}

function toAuditEntry(record: DurableAuditRecord): AuditEntry {
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    tenantId: record.tenantId,
    userId: record.userId,
    operation: record.operation,
    changes: record.changes,
    timestamp: record.timestamp,
    ipAddress: record.ipAddress,
    chainSeq: record.chainSeq,
    prevHash: record.prevHash,
    entryHash: record.entryHash,
  };
}

/**
 * {@link AuditStore} backed by the durable, chained audit store.
 */
export class DurableAuditStore implements AuditStore {
  private readonly appendPort: DurableAuditAppend;
  private readonly reads: DurableAuditReadPorts;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(options: DurableAuditStoreOptions) {
    this.appendPort = options.append;
    this.reads = { query: options.query, count: options.count, findById: options.findById };
    this.newId =
      options.newId ??
      (() => {
        // Lazy, standard UUID. `uuid` is already a student package dependency.
        return cryptoRandomUuid();
      });
    this.now = options.now ?? (() => new Date());
  }

  async append(input: CreateAuditEntryInput): Promise<AuditEntry> {
    const record = await this.appendPort({
      id: this.newId(),
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      userId: input.userId,
      ipAddress: input.ipAddress,
      changes: [...input.changes],
      timestamp: this.now().toISOString(),
    });
    return toAuditEntry(record);
  }

  async query(filter: AuditQueryFilter, limit = 100, offset = 0): Promise<AuditEntry[]> {
    if (!this.reads.query) {
      throw new Error('DurableAuditStore: no durable query port configured');
    }
    const rows = await this.reads.query(filter, limit, offset);
    return rows.map(toAuditEntry);
  }

  async count(filter: AuditQueryFilter): Promise<number> {
    if (!this.reads.count) {
      throw new Error('DurableAuditStore: no durable count port configured');
    }
    return this.reads.count(filter);
  }

  async findById(id: string): Promise<AuditEntry | null> {
    if (!this.reads.findById) {
      throw new Error('DurableAuditStore: no durable findById port configured');
    }
    const row = await this.reads.findById(id);
    return row ? toAuditEntry(row) : null;
  }
}

function cryptoRandomUuid(): string {
  // Node 20 exposes globalThis.crypto.randomUUID.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Deterministic-enough fallback for non-crypto contexts.
  return `aud-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
