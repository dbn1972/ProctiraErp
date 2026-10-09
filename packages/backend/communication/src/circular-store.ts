/**
 * Circular + delivery-log store (G-922).
 */
import { DEFAULT_PAGE, sliceForPage, type PageRequest } from './pagination.js';

export type CircularAudienceType = 'all' | 'roles' | 'classes' | 'institution';
export type CircularStatus = 'draft' | 'sent';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed';
export type DeliverySourceType = 'campaign' | 'emergency' | 'circular';

export interface CircularRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audienceType: CircularAudienceType;
  audienceJson: Record<string, unknown>;
  requiresAck: boolean;
  channels: string[];
  status: CircularStatus;
  createdBy: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CircularAckRecord {
  id: string;
  tenantId: string;
  circularId: string;
  recipientId: string;
  recipientLabel: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface DeliveryLogRecord {
  id: string;
  tenantId: string;
  channel: string;
  recipientId: string;
  recipientLabel: string | null;
  status: DeliveryStatus;
  providerRef: string | null;
  sourceType: DeliverySourceType;
  sourceId: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  retriedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryLogFilter {
  channel?: string;
  status?: DeliveryStatus;
  sourceType?: DeliverySourceType;
}

export interface CircularStore {
  createCircular(record: CircularRecord): Promise<CircularRecord>;
  /** Newest first; returns up to `page.limit + 1` rows (PRC-M191). */
  listCirculars(tenantId: string, page?: PageRequest): Promise<CircularRecord[]>;
  /** PRC-M191: one GROUP BY for ack totals of many circulars (no N+1). */
  countAcksByCircular(
    tenantId: string,
    circularIds: string[],
  ): Promise<Map<string, { total: number; acknowledged: number }>>;
  findCircular(tenantId: string, id: string): Promise<CircularRecord | null>;
  updateCircular(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularRecord, 'status' | 'sentAt'>>,
  ): Promise<CircularRecord | null>;

  /**
   * PRC-M502: atomically claim a draft circular for sending. Transitions
   * status draft→sent in ONE conditional UPDATE and returns the claimed row.
   * Returns null when the circular is missing or NOT in 'draft' status (i.e.
   * a concurrent send already claimed it), so the caller can refuse to
   * double-deliver.
   */
  claimCircularForSend(tenantId: string, id: string, sentAt: Date): Promise<CircularRecord | null>;

  /**
   * PRC-M193: insert the circular and all of its ack rows in ONE transaction
   * (bulk insert, duplicates ignored). Nothing is persisted on failure.
   */
  createCircularWithAcks(
    record: CircularRecord,
    acks: CircularAckRecord[],
  ): Promise<CircularRecord>;

  createAck(record: CircularAckRecord): Promise<CircularAckRecord>;
  listAcks(tenantId: string, circularId: string): Promise<CircularAckRecord[]>;
  findAck(
    tenantId: string,
    circularId: string,
    recipientId: string,
  ): Promise<CircularAckRecord | null>;
  updateAck(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularAckRecord, 'acknowledgedAt'>>,
  ): Promise<CircularAckRecord | null>;

  createDeliveryLog(record: DeliveryLogRecord): Promise<DeliveryLogRecord>;
  /** Newest first; returns up to `page.limit + 1` rows (PRC-M191). */
  listDeliveryLogs(
    tenantId: string,
    filter?: DeliveryLogFilter,
    page?: PageRequest,
  ): Promise<DeliveryLogRecord[]>;
  findDeliveryLog(tenantId: string, id: string): Promise<DeliveryLogRecord | null>;
  updateDeliveryLog(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        DeliveryLogRecord,
        | 'status'
        | 'providerRef'
        | 'errorMessage'
        | 'sentAt'
        | 'deliveredAt'
        | 'failedAt'
        | 'retriedAt'
      >
    >,
  ): Promise<DeliveryLogRecord | null>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCircularStore implements CircularStore {
  private readonly circulars = new Map<string, CircularRecord>();
  private readonly acks = new Map<string, CircularAckRecord>();
  private readonly logs = new Map<string, DeliveryLogRecord>();

  async createCircular(record: CircularRecord): Promise<CircularRecord> {
    this.circulars.set(record.id, clone(record));
    return clone(record);
  }

  async listCirculars(
    tenantId: string,
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<CircularRecord[]> {
    const rows = [...this.circulars.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sliceForPage(rows, page).map((row) => clone(row));
  }

  /** Test probe: number of countAcksByCircular / listAcks calls. */
  ackQueries = 0;

  async countAcksByCircular(
    tenantId: string,
    circularIds: string[],
  ): Promise<Map<string, { total: number; acknowledged: number }>> {
    this.ackQueries += 1;
    const wanted = new Set(circularIds);
    const out = new Map<string, { total: number; acknowledged: number }>();
    for (const ack of this.acks.values()) {
      if (ack.tenantId !== tenantId || !wanted.has(ack.circularId)) continue;
      const cur = out.get(ack.circularId) ?? { total: 0, acknowledged: 0 };
      cur.total += 1;
      if (ack.acknowledgedAt) cur.acknowledged += 1;
      out.set(ack.circularId, cur);
    }
    return out;
  }

  async findCircular(tenantId: string, id: string): Promise<CircularRecord | null> {
    const row = this.circulars.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateCircular(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularRecord, 'status' | 'sentAt'>>,
  ): Promise<CircularRecord | null> {
    const row = this.circulars.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    const updated: CircularRecord = { ...row, ...patch, updatedAt: new Date() };
    this.circulars.set(id, updated);
    return clone(updated);
  }

  async claimCircularForSend(
    tenantId: string,
    id: string,
    sentAt: Date,
  ): Promise<CircularRecord | null> {
    const row = this.circulars.get(id);
    // Conditional transition: only a draft can be claimed (PRC-M502).
    if (!row || row.tenantId !== tenantId || row.status !== 'draft') return null;
    const updated: CircularRecord = { ...row, status: 'sent', sentAt, updatedAt: new Date() };
    this.circulars.set(id, updated);
    return clone(updated);
  }

  /** Test hook: throw while inserting acks (fault injection). */
  failAckInsert = false;

  async createCircularWithAcks(
    record: CircularRecord,
    acks: CircularAckRecord[],
  ): Promise<CircularRecord> {
    if (this.failAckInsert && acks.length > 0) throw new Error('injected ack failure');
    this.circulars.set(record.id, clone(record));
    const seen = new Set<string>();
    for (const ack of acks) {
      if (seen.has(ack.recipientId)) continue;
      seen.add(ack.recipientId);
      this.acks.set(ack.id, clone(ack));
    }
    return clone(record);
  }

  async createAck(record: CircularAckRecord): Promise<CircularAckRecord> {
    this.acks.set(record.id, clone(record));
    return clone(record);
  }

  async listAcks(tenantId: string, circularId: string): Promise<CircularAckRecord[]> {
    this.ackQueries += 1;
    return [...this.acks.values()]
      .filter((row) => row.tenantId === tenantId && row.circularId === circularId)
      .map((row) => clone(row));
  }

  async findAck(
    tenantId: string,
    circularId: string,
    recipientId: string,
  ): Promise<CircularAckRecord | null> {
    const row = [...this.acks.values()].find(
      (item) =>
        item.tenantId === tenantId &&
        item.circularId === circularId &&
        item.recipientId === recipientId,
    );
    return row ? clone(row) : null;
  }

  async updateAck(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularAckRecord, 'acknowledgedAt'>>,
  ): Promise<CircularAckRecord | null> {
    const row = this.acks.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    const updated: CircularAckRecord = { ...row, ...patch };
    this.acks.set(id, updated);
    return clone(updated);
  }

  async createDeliveryLog(record: DeliveryLogRecord): Promise<DeliveryLogRecord> {
    this.logs.set(record.id, clone(record));
    return clone(record);
  }

  async listDeliveryLogs(
    tenantId: string,
    filter: DeliveryLogFilter = {},
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<DeliveryLogRecord[]> {
    const rows = [...this.logs.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.channel && row.channel !== filter.channel) return false;
        if (filter.status && row.status !== filter.status) return false;
        if (filter.sourceType && row.sourceType !== filter.sourceType) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sliceForPage(rows, page).map((row) => clone(row));
  }

  async findDeliveryLog(tenantId: string, id: string): Promise<DeliveryLogRecord | null> {
    const row = this.logs.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateDeliveryLog(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        DeliveryLogRecord,
        | 'status'
        | 'providerRef'
        | 'errorMessage'
        | 'sentAt'
        | 'deliveredAt'
        | 'failedAt'
        | 'retriedAt'
      >
    >,
  ): Promise<DeliveryLogRecord | null> {
    const row = this.logs.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    const updated: DeliveryLogRecord = { ...row, ...patch, updatedAt: new Date() };
    this.logs.set(id, updated);
    return clone(updated);
  }
}
