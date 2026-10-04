/**
 * Data Warehouse audit events (PRC-L452).
 *
 * Every successful mutation emits exactly one event carrying tenant, actor,
 * action, resource identifiers and aggregate counts. Events never include
 * row payloads (data values, translation text, geometry, file content).
 */

export type DataWarehouseAuditAction =
  | `${'warehouse' | 'indicator' | 'unit' | 'subgroup' | 'time_period' | 'area'}.${'create' | 'update' | 'delete'}`
  | 'data.import'
  | `gis_layer.${'create' | 'update' | 'delete'}`
  | 'translation.set'
  | 'translation.batch_set'
  | 'translation.import'
  | 'data.publish';

export interface DataWarehouseAuditEvent {
  tenantId: string;
  actorId: string | null;
  action: DataWarehouseAuditAction;
  resourceType: string;
  resourceId: string | null;
  warehouseId: string | null;
  /** Aggregate counts only (e.g. rows imported); no row-level content. */
  counts?: Record<string, number>;
  occurredAt: Date;
}

export type DataWarehouseAuditSink = (event: DataWarehouseAuditEvent) => void | Promise<void>;

/** Caller identity passed from routes into mutating service calls. */
export interface AuditContext {
  actorId?: string | null;
}

export type AuditEventInput = Omit<
  DataWarehouseAuditEvent,
  'actorId' | 'occurredAt' | 'resourceId'
> & {
  resourceId?: string | null;
};

export class AuditEmitter {
  constructor(private readonly sink: DataWarehouseAuditSink | null = null) {}

  async emit(ctx: AuditContext | undefined, event: AuditEventInput): Promise<void> {
    if (!this.sink) return;
    await this.sink({
      ...event,
      resourceId: event.resourceId ?? null,
      actorId: ctx?.actorId ?? null,
      occurredAt: new Date(),
    });
  }

  /**
   * Run a mutation and emit one event after it succeeds. When resourceId is
   * omitted, it is taken from the result's `id`.
   */
  async wrap<T>(
    ctx: AuditContext | undefined,
    event: AuditEventInput | ((result: T) => AuditEventInput),
    op: () => Promise<T>,
  ): Promise<T> {
    const result = await op();
    const resolved = typeof event === 'function' ? event(result) : event;
    const id =
      resolved.resourceId ??
      (result && typeof result === 'object' && 'id' in result
        ? String((result as { id: unknown }).id)
        : null);
    await this.emit(ctx, { ...resolved, resourceId: id });
    return result;
  }
}
