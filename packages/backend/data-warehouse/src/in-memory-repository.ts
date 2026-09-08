/**
 * In-Memory Warehouse Repository
 *
 * In-memory implementation of WarehouseRepository for testing and development.
 */
import type {
  Warehouse,
  Indicator,
  Unit,
  Subgroup,
  TimePeriod,
  Area,
  DataRecord,
} from './schemas.js';
import type { WarehouseRepository, ListFilter, ListResult } from './warehouse-repository.js';

export class InMemoryWarehouseRepository implements WarehouseRepository {
  private warehouses: Map<string, Warehouse> = new Map();
  private indicators: Map<string, Indicator> = new Map();
  private units: Map<string, Unit> = new Map();
  private subgroups: Map<string, Subgroup> = new Map();
  private timePeriods: Map<string, TimePeriod> = new Map();
  private areas: Map<string, Area> = new Map();
  private dataRecords: Map<string, DataRecord> = new Map();

  // ─── Warehouse Operations ───────────────────────────────────────────────────

  async createWarehouse(warehouse: Warehouse): Promise<Warehouse> {
    this.warehouses.set(warehouse.id, { ...warehouse });
    return { ...warehouse };
  }

  async updateWarehouse(
    id: string,
    tenantId: string,
    updates: Partial<Warehouse>,
  ): Promise<Warehouse> {
    const existing = this.warehouses.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Warehouse not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.warehouses.set(id, updated);
    return { ...updated };
  }

  async deleteWarehouse(id: string, tenantId: string): Promise<void> {
    const existing = this.warehouses.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Warehouse not found: ${id}`);
    }
    this.warehouses.delete(id);
  }

  async findWarehouseById(id: string, tenantId: string): Promise<Warehouse | null> {
    const warehouse = this.warehouses.get(id);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      return null;
    }
    return { ...warehouse };
  }

  async listWarehouses(
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Warehouse>> {
    let results = Array.from(this.warehouses.values()).filter((w) => w.tenantId === tenantId);
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (w) =>
          w.name.toLowerCase().includes(search) ||
          (w.description && w.description.toLowerCase().includes(search)),
      );
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((w) => ({ ...w })), total };
  }

  // ─── Indicator Operations ───────────────────────────────────────────────────

  async createIndicator(indicator: Indicator): Promise<Indicator> {
    this.indicators.set(indicator.id, { ...indicator });
    return { ...indicator };
  }

  async updateIndicator(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Indicator>,
  ): Promise<Indicator> {
    const existing = this.indicators.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Indicator not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.indicators.set(id, updated);
    return { ...updated };
  }

  async deleteIndicator(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.indicators.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Indicator not found: ${id}`);
    }
    this.indicators.delete(id);
  }

  async findIndicatorById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Indicator | null> {
    const indicator = this.indicators.get(id);
    if (!indicator || indicator.warehouseId !== warehouseId || indicator.tenantId !== tenantId) {
      return null;
    }
    return { ...indicator };
  }

  async findIndicatorByGid(
    gid: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Indicator | null> {
    const indicator = Array.from(this.indicators.values()).find(
      (i) => i.gid === gid && i.warehouseId === warehouseId && i.tenantId === tenantId,
    );
    return indicator ? { ...indicator } : null;
  }

  async listIndicators(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Indicator>> {
    let results = Array.from(this.indicators.values()).filter(
      (i) => i.warehouseId === warehouseId && i.tenantId === tenantId,
    );
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((i) => i.name.toLowerCase().includes(search));
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((i) => ({ ...i })), total };
  }

  // ─── Unit Operations ────────────────────────────────────────────────────────

  async createUnit(unit: Unit): Promise<Unit> {
    this.units.set(unit.id, { ...unit });
    return { ...unit };
  }

  async updateUnit(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Unit>,
  ): Promise<Unit> {
    const existing = this.units.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Unit not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.units.set(id, updated);
    return { ...updated };
  }

  async deleteUnit(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.units.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Unit not found: ${id}`);
    }
    this.units.delete(id);
  }

  async findUnitById(id: string, warehouseId: string, tenantId: string): Promise<Unit | null> {
    const unit = this.units.get(id);
    if (!unit || unit.warehouseId !== warehouseId || unit.tenantId !== tenantId) {
      return null;
    }
    return { ...unit };
  }

  async findUnitByGid(gid: string, warehouseId: string, tenantId: string): Promise<Unit | null> {
    const unit = Array.from(this.units.values()).find(
      (u) => u.gid === gid && u.warehouseId === warehouseId && u.tenantId === tenantId,
    );
    return unit ? { ...unit } : null;
  }

  async listUnits(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Unit>> {
    let results = Array.from(this.units.values()).filter(
      (u) => u.warehouseId === warehouseId && u.tenantId === tenantId,
    );
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((u) => u.name.toLowerCase().includes(search));
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((u) => ({ ...u })), total };
  }

  // ─── Subgroup Operations ────────────────────────────────────────────────────

  async createSubgroup(subgroup: Subgroup): Promise<Subgroup> {
    this.subgroups.set(subgroup.id, { ...subgroup });
    return { ...subgroup };
  }

  async updateSubgroup(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Subgroup>,
  ): Promise<Subgroup> {
    const existing = this.subgroups.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Subgroup not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.subgroups.set(id, updated);
    return { ...updated };
  }

  async deleteSubgroup(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.subgroups.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Subgroup not found: ${id}`);
    }
    this.subgroups.delete(id);
  }

  async findSubgroupById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Subgroup | null> {
    const subgroup = this.subgroups.get(id);
    if (!subgroup || subgroup.warehouseId !== warehouseId || subgroup.tenantId !== tenantId) {
      return null;
    }
    return { ...subgroup };
  }

  async findSubgroupByGid(
    gid: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Subgroup | null> {
    const subgroup = Array.from(this.subgroups.values()).find(
      (s) => s.gid === gid && s.warehouseId === warehouseId && s.tenantId === tenantId,
    );
    return subgroup ? { ...subgroup } : null;
  }

  async listSubgroups(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Subgroup>> {
    let results = Array.from(this.subgroups.values()).filter(
      (s) => s.warehouseId === warehouseId && s.tenantId === tenantId,
    );
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((s) => s.name.toLowerCase().includes(search));
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((s) => ({ ...s })), total };
  }

  // ─── Time Period Operations ─────────────────────────────────────────────────

  async createTimePeriod(timePeriod: TimePeriod): Promise<TimePeriod> {
    this.timePeriods.set(timePeriod.id, { ...timePeriod });
    return { ...timePeriod };
  }

  async updateTimePeriod(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<TimePeriod>,
  ): Promise<TimePeriod> {
    const existing = this.timePeriods.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`TimePeriod not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.timePeriods.set(id, updated);
    return { ...updated };
  }

  async deleteTimePeriod(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.timePeriods.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`TimePeriod not found: ${id}`);
    }
    this.timePeriods.delete(id);
  }

  async findTimePeriodById(
    id: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<TimePeriod | null> {
    const tp = this.timePeriods.get(id);
    if (!tp || tp.warehouseId !== warehouseId || tp.tenantId !== tenantId) {
      return null;
    }
    return { ...tp };
  }

  async findTimePeriodByLabel(
    label: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<TimePeriod | null> {
    const tp = Array.from(this.timePeriods.values()).find(
      (t) => t.timePeriod === label && t.warehouseId === warehouseId && t.tenantId === tenantId,
    );
    return tp ? { ...tp } : null;
  }

  async listTimePeriods(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<TimePeriod>> {
    let results = Array.from(this.timePeriods.values()).filter(
      (t) => t.warehouseId === warehouseId && t.tenantId === tenantId,
    );
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((t) => t.timePeriod.toLowerCase().includes(search));
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((t) => ({ ...t })), total };
  }

  // ─── Area Operations ────────────────────────────────────────────────────────

  async createArea(area: Area): Promise<Area> {
    this.areas.set(area.id, { ...area });
    return { ...area };
  }

  async updateArea(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Area>,
  ): Promise<Area> {
    const existing = this.areas.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Area not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.areas.set(id, updated);
    return { ...updated };
  }

  async deleteArea(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.areas.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`Area not found: ${id}`);
    }
    this.areas.delete(id);
  }

  async findAreaById(id: string, warehouseId: string, tenantId: string): Promise<Area | null> {
    const area = this.areas.get(id);
    if (!area || area.warehouseId !== warehouseId || area.tenantId !== tenantId) {
      return null;
    }
    return { ...area };
  }

  async findAreaByExternalId(
    areaId: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<Area | null> {
    const area = Array.from(this.areas.values()).find(
      (a) => a.areaId === areaId && a.warehouseId === warehouseId && a.tenantId === tenantId,
    );
    return area ? { ...area } : null;
  }

  async listAreas(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Area>> {
    let results = Array.from(this.areas.values()).filter(
      (a) => a.warehouseId === warehouseId && a.tenantId === tenantId,
    );
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter((a) => a.name.toLowerCase().includes(search));
    }
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((a) => ({ ...a })), total };
  }

  // ─── Data Record Operations ─────────────────────────────────────────────────

  async createDataRecord(record: DataRecord): Promise<DataRecord> {
    this.dataRecords.set(record.id, { ...record });
    return { ...record };
  }

  async createDataRecordsBatch(records: DataRecord[]): Promise<DataRecord[]> {
    const created: DataRecord[] = [];
    for (const record of records) {
      this.dataRecords.set(record.id, { ...record });
      created.push({ ...record });
    }
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
    const record = Array.from(this.dataRecords.values()).find(
      (r) =>
        r.warehouseId === warehouseId &&
        r.tenantId === tenantId &&
        r.indicatorId === indicatorId &&
        r.unitId === unitId &&
        r.subgroupId === subgroupId &&
        r.areaId === areaId &&
        r.timePeriodId === timePeriodId,
    );
    return record ? { ...record } : null;
  }

  async queryData(
    warehouseId: string,
    tenantId: string,
    query: {
      indicatorIds?: string[];
      unitIds?: string[];
      subgroupIds?: string[];
      areaIds?: string[];
      timePeriodIds?: string[];
    },
    page: number,
    pageSize: number,
  ): Promise<ListResult<DataRecord>> {
    let results = Array.from(this.dataRecords.values()).filter(
      (r) => r.warehouseId === warehouseId && r.tenantId === tenantId,
    );

    if (query.indicatorIds && query.indicatorIds.length > 0) {
      results = results.filter((r) => query.indicatorIds!.includes(r.indicatorId));
    }
    if (query.unitIds && query.unitIds.length > 0) {
      results = results.filter((r) => query.unitIds!.includes(r.unitId));
    }
    if (query.subgroupIds && query.subgroupIds.length > 0) {
      results = results.filter((r) => query.subgroupIds!.includes(r.subgroupId));
    }
    if (query.areaIds && query.areaIds.length > 0) {
      results = results.filter((r) => query.areaIds!.includes(r.areaId));
    }
    if (query.timePeriodIds && query.timePeriodIds.length > 0) {
      results = results.filter((r) => query.timePeriodIds!.includes(r.timePeriodId));
    }

    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((r) => ({ ...r })), total };
  }
}
