/**
 * Warehouse Repository Interface
 *
 * Defines the contract for data warehouse persistence operations.
 * Implementations can use PostgreSQL, in-memory storage, etc.
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

export interface ListFilter {
  search?: string;
}

export interface ListResult<T> {
  data: T[];
  total: number;
}

/**
 * Repository interface for data warehouse CRUD operations.
 */
export interface WarehouseRepository {
  // Warehouse operations
  createWarehouse(warehouse: Warehouse): Promise<Warehouse>;
  updateWarehouse(id: string, tenantId: string, updates: Partial<Warehouse>): Promise<Warehouse>;
  deleteWarehouse(id: string, tenantId: string): Promise<void>;
  findWarehouseById(id: string, tenantId: string): Promise<Warehouse | null>;
  listWarehouses(
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Warehouse>>;

  // Indicator operations
  createIndicator(indicator: Indicator): Promise<Indicator>;
  updateIndicator(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Indicator>,
  ): Promise<Indicator>;
  deleteIndicator(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findIndicatorById(id: string, warehouseId: string, tenantId: string): Promise<Indicator | null>;
  findIndicatorByGid(gid: string, warehouseId: string, tenantId: string): Promise<Indicator | null>;
  listIndicators(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Indicator>>;

  // Unit operations
  createUnit(unit: Unit): Promise<Unit>;
  updateUnit(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Unit>,
  ): Promise<Unit>;
  deleteUnit(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findUnitById(id: string, warehouseId: string, tenantId: string): Promise<Unit | null>;
  findUnitByGid(gid: string, warehouseId: string, tenantId: string): Promise<Unit | null>;
  listUnits(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Unit>>;

  // Subgroup operations
  createSubgroup(subgroup: Subgroup): Promise<Subgroup>;
  updateSubgroup(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Subgroup>,
  ): Promise<Subgroup>;
  deleteSubgroup(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findSubgroupById(id: string, warehouseId: string, tenantId: string): Promise<Subgroup | null>;
  findSubgroupByGid(gid: string, warehouseId: string, tenantId: string): Promise<Subgroup | null>;
  listSubgroups(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Subgroup>>;

  // Time Period operations
  createTimePeriod(timePeriod: TimePeriod): Promise<TimePeriod>;
  updateTimePeriod(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<TimePeriod>,
  ): Promise<TimePeriod>;
  deleteTimePeriod(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findTimePeriodById(id: string, warehouseId: string, tenantId: string): Promise<TimePeriod | null>;
  findTimePeriodByLabel(
    label: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<TimePeriod | null>;
  listTimePeriods(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<TimePeriod>>;

  // Area operations
  createArea(area: Area): Promise<Area>;
  updateArea(
    id: string,
    warehouseId: string,
    tenantId: string,
    updates: Partial<Area>,
  ): Promise<Area>;
  deleteArea(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findAreaById(id: string, warehouseId: string, tenantId: string): Promise<Area | null>;
  findAreaByExternalId(areaId: string, warehouseId: string, tenantId: string): Promise<Area | null>;
  listAreas(
    warehouseId: string,
    tenantId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ): Promise<ListResult<Area>>;

  // Data Record operations
  createDataRecord(record: DataRecord): Promise<DataRecord>;
  createDataRecordsBatch(records: DataRecord[]): Promise<DataRecord[]>;
  findDataRecord(
    warehouseId: string,
    tenantId: string,
    indicatorId: string,
    unitId: string,
    subgroupId: string,
    areaId: string,
    timePeriodId: string,
  ): Promise<DataRecord | null>;
  queryData(
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
  ): Promise<ListResult<DataRecord>>;
}
