/**
 * Circular + delivery-log store (G-922).
 */
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
  listCirculars(tenantId: string): Promise<CircularRecord[]>;
  findCircular(tenantId: string, id: string): Promise<CircularRecord | null>;
  updateCircular(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularRecord, 'status' | 'sentAt'>>,
  ): Promise<CircularRecord | null>;

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
  listDeliveryLogs(tenantId: string, filter?: DeliveryLogFilter): Promise<DeliveryLogRecord[]>;
  findDeliveryLog(tenantId: string, id: string): Promise<DeliveryLogRecord | null>;
  updateDeliveryLog(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        DeliveryLogRecord,
        'status' | 'providerRef' | 'errorMessage' | 'sentAt' | 'deliveredAt' | 'failedAt' | 'retriedAt'
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

  async listCirculars(tenantId: string): Promise<CircularRecord[]> {
    return [...this.circulars.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => clone(row));
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

  async createAck(record: CircularAckRecord): Promise<CircularAckRecord> {
    this.acks.set(record.id, clone(record));
    return clone(record);
  }

  async listAcks(tenantId: string, circularId: string): Promise<CircularAckRecord[]> {
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
  ): Promise<DeliveryLogRecord[]> {
    return [...this.logs.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.channel && row.channel !== filter.channel) return false;
        if (filter.status && row.status !== filter.status) return false;
        if (filter.sourceType && row.sourceType !== filter.sourceType) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => clone(row));
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
        'status' | 'providerRef' | 'errorMessage' | 'sentAt' | 'deliveredAt' | 'failedAt' | 'retriedAt'
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
