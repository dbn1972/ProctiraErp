/**
 * Tenant defence in depth for {@link WarehouseRepository} (PRC-L552).
 *
 * The repository contract takes the caller tenant as an argument and every
 * implementation is trusted to filter by it. This wrapper re-checks the
 * contract on every call so one implementation that forgets a predicate
 * cannot leak or rewrite another tenant's data:
 * - a missing/blank tenant fails closed before the inner repository runs;
 * - a create whose entity has no tenant is refused;
 * - an update may not change `tenantId` (no re-parenting);
 * - a single-row lookup that returns another tenant's row yields `null`;
 * - a list, query or update result containing another tenant's row throws.
 *
 * {@link DataWarehouseService} wraps whatever repository it is given.
 */
import { AppError } from '@proctira/common';
import type {
  Area,
  DataRecord,
  Indicator,
  Subgroup,
  TimePeriod,
  Unit,
  Warehouse,
} from './schemas.js';
import type { ListFilter, ListResult, WarehouseRepository } from './warehouse-repository.js';
export class WarehouseTenantScopeError extends AppError {
  constructor(message: string) {
    super(message, 'TENANT_SCOPE_VIOLATION', 500);
    this.name = 'WarehouseTenantScopeError';
  }
}
type Owned = { tenantId: string };
function requireTenant(tenantId: string): string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new AppError('Tenant context is required', 'TENANT_REQUIRED', 400);
  }
  return tenantId;
}
function requireOwnedEntity<T extends Owned>(entity: T): T {
  requireTenant(entity?.tenantId);
  return entity;
}
function noReparent<T extends Partial<Owned>>(tenantId: string, updates: T): T {
  if (updates && updates.tenantId !== undefined && updates.tenantId !== tenantId) {
    throw new WarehouseTenantScopeError('An update may not move a row to another tenant');
  }
  return updates;
}
function ownOrNull<T extends Owned>(tenantId: string, row: T | null): T | null {
  return row && row.tenantId === tenantId ? row : null;
}
function ownStrict<T extends Owned>(tenantId: string, row: T): T {
  if (!row || row.tenantId !== tenantId) {
    throw new WarehouseTenantScopeError('Repository returned a row outside the caller tenant');
  }
  return row;
}
function ownList<T extends Owned>(tenantId: string, result: ListResult<T>): ListResult<T> {
  for (const row of result.data) ownStrict(tenantId, row);
  return result;
}
class TenantGuardedWarehouseRepository implements WarehouseRepository {
  constructor(private readonly inner: WarehouseRepository) {}
  // ─── Warehouse ─────────────────────────────────────────────────────────────
  async createWarehouse(warehouse: Warehouse): Promise<Warehouse> {
    const owned = requireOwnedEntity(warehouse);
    return ownStrict(owned.tenantId, await this.inner.createWarehouse(owned));
  }
  async updateWarehouse(
    id: string,
    tenantId: string,
    updates: Partial<Warehouse>,
  ): Promise<Warehouse> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(tenantId, await this.inner.updateWarehouse(id, tenantId, updates));
  }
  async deleteWarehouse(id: string, tenantId: string): Promise<void> {
    await this.inner.deleteWarehouse(id, requireTenant(tenantId));
  }
  async findWarehouseById(id: string, tenantId: string): Promise<Warehouse | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findWarehouseById(id, tenantId));
  }
  async listWarehouses(
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Warehouse>> {
    requireTenant(tenantId);
    return ownList(tenantId, await this.inner.listWarehouses(tenantId, filter, page, pageSize));
  }
  // ─── Indicator ─────────────────────────────────────────────────────────────
  async createIndicator(indicator: Indicator): Promise<Indicator> {
    const owned = requireOwnedEntity(indicator);
    return ownStrict(owned.tenantId, await this.inner.createIndicator(owned));
  }
  async updateIndicator(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Indicator>,
  ): Promise<Indicator> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(
      tenantId,
      await this.inner.updateIndicator(id, warehouseId, tenantId, updates),
    );
  }
  async deleteIndicator(id: string, warehouseId: string, tenantId: string): Promise<void> {
    await this.inner.deleteIndicator(id, warehouseId, requireTenant(tenantId));
  }
  async findIndicatorById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Indicator | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findIndicatorById(id, warehouseId, tenantId));
  }
  async findIndicatorByGid(
    gid: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Indicator | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findIndicatorByGid(gid, warehouseId, tenantId));
  }
  async listIndicators(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Indicator>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.listIndicators(warehouseId, tenantId, filter, page, pageSize),
    );
  }
  // ─── Unit ──────────────────────────────────────────────────────────────────
  async createUnit(unit: Unit): Promise<Unit> {
    const owned = requireOwnedEntity(unit);
    return ownStrict(owned.tenantId, await this.inner.createUnit(owned));
  }
  async updateUnit(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Unit>,
  ): Promise<Unit> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(tenantId, await this.inner.updateUnit(id, warehouseId, tenantId, updates));
  }
  async deleteUnit(id: string, warehouseId: string, tenantId: string): Promise<void> {
    await this.inner.deleteUnit(id, warehouseId, requireTenant(tenantId));
  }
  async findUnitById(id: string, warehouseId: string, tenantId: string): Promise<Unit | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findUnitById(id, warehouseId, tenantId));
  }
  async findUnitByGid(gid: string, warehouseId: string, tenantId: string): Promise<Unit | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findUnitByGid(gid, warehouseId, tenantId));
  }
  async listUnits(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Unit>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.listUnits(warehouseId, tenantId, filter, page, pageSize),
    );
  }
  // ─── Subgroup ──────────────────────────────────────────────────────────────
  async createSubgroup(subgroup: Subgroup): Promise<Subgroup> {
    const owned = requireOwnedEntity(subgroup);
    return ownStrict(owned.tenantId, await this.inner.createSubgroup(owned));
  }
  async updateSubgroup(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Subgroup>,
  ): Promise<Subgroup> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(tenantId, await this.inner.updateSubgroup(id, warehouseId, tenantId, updates));
  }
  async deleteSubgroup(id: string, warehouseId: string, tenantId: string): Promise<void> {
    await this.inner.deleteSubgroup(id, warehouseId, requireTenant(tenantId));
  }
  async findSubgroupById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Subgroup | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findSubgroupById(id, warehouseId, tenantId));
  }
  async findSubgroupByGid(
    gid: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Subgroup | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findSubgroupByGid(gid, warehouseId, tenantId));
  }
  async listSubgroups(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Subgroup>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.listSubgroups(warehouseId, tenantId, filter, page, pageSize),
    );
  }
  // ─── Time Period ───────────────────────────────────────────────────────────
  async createTimePeriod(timePeriod: TimePeriod): Promise<TimePeriod> {
    const owned = requireOwnedEntity(timePeriod);
    return ownStrict(owned.tenantId, await this.inner.createTimePeriod(owned));
  }
  async updateTimePeriod(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<TimePeriod>,
  ): Promise<TimePeriod> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(
      tenantId,
      await this.inner.updateTimePeriod(id, warehouseId, tenantId, updates),
    );
  }
  async deleteTimePeriod(id: string, warehouseId: string, tenantId: string): Promise<void> {
    await this.inner.deleteTimePeriod(id, warehouseId, requireTenant(tenantId));
  }
  async findTimePeriodById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<TimePeriod | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findTimePeriodById(id, warehouseId, tenantId));
  }
  async findTimePeriodByLabel(
    label: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<TimePeriod | null> {
    requireTenant(tenantId);
    return ownOrNull(
      tenantId,
      await this.inner.findTimePeriodByLabel(label, warehouseId, tenantId),
    );
  }
  async listTimePeriods(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<TimePeriod>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.listTimePeriods(warehouseId, tenantId, filter, page, pageSize),
    );
  }
  // ─── Area ──────────────────────────────────────────────────────────────────
  async createArea(area: Area): Promise<Area> {
    const owned = requireOwnedEntity(area);
    return ownStrict(owned.tenantId, await this.inner.createArea(owned));
  }
  async updateArea(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Area>,
  ): Promise<Area> {
    requireTenant(tenantId);
    noReparent(tenantId, updates);
    return ownStrict(tenantId, await this.inner.updateArea(id, warehouseId, tenantId, updates));
  }
  async deleteArea(id: string, warehouseId: string, tenantId: string): Promise<void> {
    await this.inner.deleteArea(id, warehouseId, requireTenant(tenantId));
  }
  async findAreaById(id: string, warehouseId: string, tenantId: string): Promise<Area | null> {
    requireTenant(tenantId);
    return ownOrNull(tenantId, await this.inner.findAreaById(id, warehouseId, tenantId));
  }
  async findAreaByExternalId(
    areaId: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Area | null> {
    requireTenant(tenantId);
    return ownOrNull(
      tenantId,
      await this.inner.findAreaByExternalId(areaId, warehouseId, tenantId),
    );
  }
  async listAreas(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Area>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.listAreas(warehouseId, tenantId, filter, page, pageSize),
    );
  }
  // ─── Data Records ──────────────────────────────────────────────────────────
  async createDataRecord(record: DataRecord): Promise<DataRecord> {
    const owned = requireOwnedEntity(record);
    return ownStrict(owned.tenantId, await this.inner.createDataRecord(owned));
  }
  async createDataRecordsBatch(records: DataRecord[]): Promise<DataRecord[]> {
    const tenants = new Set(records.map((r) => requireOwnedEntity(r).tenantId));
    if (tenants.size > 1) {
      throw new WarehouseTenantScopeError('A record batch may not span tenants');
    }
    const [tenantId] = [...tenants];
    const created = await this.inner.createDataRecordsBatch(records);
    if (tenantId !== undefined) for (const row of created) ownStrict(tenantId, row);
    return created;
  }
  async findDataRecord(
    warehouseId: string,
    tenantId: string,
    indicatorId: string,
    unitId: string,
    subgroupId: string,
    areaId: string,
    timePeriodId: string,
  ): Promise<DataRecord | null> {
    requireTenant(tenantId);
    return ownOrNull(
      tenantId,
      await this.inner.findDataRecord(
        warehouseId,
        tenantId,
        indicatorId,
        unitId,
        subgroupId,
        areaId,
        timePeriodId,
      ),
    );
  }
  async queryData(
    warehouseId: string,
    tenantId: string,
    query: Parameters<WarehouseRepository['queryData']>[2],
    page: number,
    pageSize: number,
  ): Promise<ListResult<DataRecord>> {
    requireTenant(tenantId);
    return ownList(
      tenantId,
      await this.inner.queryData(warehouseId, tenantId, query, page, pageSize),
    );
  }
}
/** Wraps `repository` with the PRC-L552 tenant checks (idempotent). */
export function guardWarehouseRepository(repository: WarehouseRepository): WarehouseRepository {
  return repository instanceof TenantGuardedWarehouseRepository
    ? repository
    : new TenantGuardedWarehouseRepository(repository);
}
