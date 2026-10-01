/**
 * Data Warehouse Service
 *
 * Core service for managing DevInfo/DI7 data warehouses including
 * indicators, units, subgroups, time periods, areas, and data records.
 */
import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { AuditEmitter, type AuditContext, type DataWarehouseAuditSink } from './audit.js';
import { importDataRecords, parseCsvImport, parseExcelDesImport } from './import-service.js';
import type {
  Warehouse,
  Indicator,
  Unit,
  Subgroup,
  TimePeriod,
  Area,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  CreateIndicatorInput,
  UpdateIndicatorInput,
  CreateUnitInput,
  UpdateUnitInput,
  CreateSubgroupInput,
  UpdateSubgroupInput,
  CreateTimePeriodInput,
  UpdateTimePeriodInput,
  CreateAreaInput,
  UpdateAreaInput,
  DataRecordInput,
  ImportResult,
  ImportFormat,
  ImportRowError,
} from './schemas.js';
import type { WarehouseRepository, ListFilter } from './warehouse-repository.js';

export interface DataWarehouseServiceConfig {
  /** Maximum records per import batch */
  maxImportBatchSize: number;
}

/** Parse an ISO date string; throws ValidationError when unparseable. */
function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) {
    throw new ValidationError('Validation failed', [
      { field, message: `${field} must be a valid ISO date`, rule: 'format' },
    ]);
  }
  return date;
}

function assertPeriodOrder(startDate: Date | null, endDate: Date | null): void {
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new ValidationError('Validation failed', [
      { field: 'endDate', message: 'endDate must be on or after startDate', rule: 'range' },
    ]);
  }
}

function assertChildLevel(parent: Area, level: number): void {
  if (level !== parent.level + 1) {
    throw new ValidationError('Validation failed', [
      {
        field: 'level',
        message: `level must be ${parent.level + 1} (parent level + 1)`,
        rule: 'range',
      },
    ]);
  }
}

export interface DataWarehouseServiceOptions {
  /** Receives one event per successful mutation (PRC-L452). */
  auditSink?: DataWarehouseAuditSink | null;
}

export class DataWarehouseService {
  private readonly audit: AuditEmitter;

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly config: DataWarehouseServiceConfig,
    options: DataWarehouseServiceOptions = {},
  ) {
    this.audit = new AuditEmitter(options.auditSink ?? null);
  }

  // ─── Warehouse Operations ───────────────────────────────────────────────────

  async createWarehouse(
    tenantId: string,
    input: CreateWarehouseInput,
    ctx: AuditContext = {},
  ): Promise<Warehouse> {
    const now = new Date();
    const warehouse: Warehouse = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      defaultLanguage: input.defaultLanguage ?? 'en',
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId: null, action: 'warehouse.create', resourceType: 'warehouse' },
      () => this.repository.createWarehouse(warehouse),
    );
  }

  async updateWarehouse(
    tenantId: string,
    warehouseId: string,
    input: UpdateWarehouseInput,
    ctx: AuditContext = {},
  ): Promise<Warehouse> {
    const existing = await this.repository.findWarehouseById(warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }
    const updates: Partial<Warehouse> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description ?? null;
    if (input.defaultLanguage !== undefined) updates.defaultLanguage = input.defaultLanguage;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId: null,
        action: 'warehouse.update',
        resourceType: 'warehouse',
        resourceId: warehouseId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateWarehouse(warehouseId, tenantId, updates),
    );
  }

  async deleteWarehouse(
    tenantId: string,
    warehouseId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    const existing = await this.repository.findWarehouseById(warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }
    await this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId: null,
        action: 'warehouse.delete',
        resourceType: 'warehouse',
        resourceId: warehouseId,
      },
      () => this.repository.deleteWarehouse(warehouseId, tenantId),
    );
  }

  async getWarehouse(tenantId: string, warehouseId: string): Promise<Warehouse> {
    const warehouse = await this.repository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }
    return warehouse;
  }

  async listWarehouses(tenantId: string, filter: ListFilter, page: number, pageSize: number) {
    return this.repository.listWarehouses(tenantId, filter, page, pageSize);
  }

  // ─── Indicator Operations ───────────────────────────────────────────────────

  async createIndicator(
    tenantId: string,
    warehouseId: string,
    input: CreateIndicatorInput,
    ctx: AuditContext = {},
  ): Promise<Indicator> {
    await this.getWarehouse(tenantId, warehouseId);

    // Check GID uniqueness within warehouse
    const existingByGid = await this.repository.findIndicatorByGid(
      input.gid,
      warehouseId,
      tenantId,
    );
    if (existingByGid) {
      throw new ConflictError(`Indicator with GID '${input.gid}' already exists in this warehouse`);
    }

    const now = new Date();
    const indicator: Indicator = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      name: input.name,
      gid: input.gid,
      shortName: input.shortName ?? null,
      keywords: input.keywords ?? null,
      info: input.info ?? null,
      highIsGood: input.highIsGood ?? false,
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'indicator.create', resourceType: 'indicator' },
      () => this.repository.createIndicator(indicator),
    );
  }

  async updateIndicator(
    tenantId: string,
    warehouseId: string,
    indicatorId: string,
    input: UpdateIndicatorInput,
    ctx: AuditContext = {},
  ): Promise<Indicator> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findIndicatorById(indicatorId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Indicator not found: ${indicatorId}`);
    }
    const updates: Partial<Indicator> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.shortName !== undefined) updates.shortName = input.shortName ?? null;
    if (input.keywords !== undefined) updates.keywords = input.keywords ?? null;
    if (input.info !== undefined) updates.info = input.info ?? null;
    if (input.highIsGood !== undefined) updates.highIsGood = input.highIsGood;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'indicator.update',
        resourceType: 'indicator',
        resourceId: indicatorId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateIndicator(indicatorId, warehouseId, tenantId, updates),
    );
  }

  async deleteIndicator(
    tenantId: string,
    warehouseId: string,
    indicatorId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findIndicatorById(indicatorId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Indicator not found: ${indicatorId}`);
    }
    await this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'indicator.delete',
        resourceType: 'indicator',
        resourceId: indicatorId,
      },
      () => this.repository.deleteIndicator(indicatorId, warehouseId, tenantId),
    );
  }

  async getIndicator(
    tenantId: string,
    warehouseId: string,
    indicatorId: string,
  ): Promise<Indicator> {
    await this.getWarehouse(tenantId, warehouseId);
    const indicator = await this.repository.findIndicatorById(indicatorId, warehouseId, tenantId);
    if (!indicator) {
      throw new NotFoundError(`Indicator not found: ${indicatorId}`);
    }
    return indicator;
  }

  async listIndicators(
    tenantId: string,
    warehouseId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);
    return this.repository.listIndicators(warehouseId, tenantId, filter, page, pageSize);
  }

  // ─── Unit Operations ────────────────────────────────────────────────────────

  async createUnit(
    tenantId: string,
    warehouseId: string,
    input: CreateUnitInput,
    ctx: AuditContext = {},
  ): Promise<Unit> {
    await this.getWarehouse(tenantId, warehouseId);

    const existingByGid = await this.repository.findUnitByGid(input.gid, warehouseId, tenantId);
    if (existingByGid) {
      throw new ConflictError(`Unit with GID '${input.gid}' already exists in this warehouse`);
    }

    const now = new Date();
    const unit: Unit = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      name: input.name,
      gid: input.gid,
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'unit.create', resourceType: 'unit' },
      () => this.repository.createUnit(unit),
    );
  }

  async updateUnit(
    tenantId: string,
    warehouseId: string,
    unitId: string,
    input: UpdateUnitInput,
    ctx: AuditContext = {},
  ): Promise<Unit> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findUnitById(unitId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Unit not found: ${unitId}`);
    }
    const updates: Partial<Unit> = {};
    if (input.name !== undefined) updates.name = input.name;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'unit.update',
        resourceType: 'unit',
        resourceId: unitId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateUnit(unitId, warehouseId, tenantId, updates),
    );
  }

  async deleteUnit(
    tenantId: string,
    warehouseId: string,
    unitId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findUnitById(unitId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Unit not found: ${unitId}`);
    }
    await this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'unit.delete', resourceType: 'unit', resourceId: unitId },
      () => this.repository.deleteUnit(unitId, warehouseId, tenantId),
    );
  }

  async getUnit(tenantId: string, warehouseId: string, unitId: string): Promise<Unit> {
    await this.getWarehouse(tenantId, warehouseId);
    const unit = await this.repository.findUnitById(unitId, warehouseId, tenantId);
    if (!unit) {
      throw new NotFoundError(`Unit not found: ${unitId}`);
    }
    return unit;
  }

  async listUnits(
    tenantId: string,
    warehouseId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);
    return this.repository.listUnits(warehouseId, tenantId, filter, page, pageSize);
  }

  // ─── Subgroup Operations ────────────────────────────────────────────────────

  async createSubgroup(
    tenantId: string,
    warehouseId: string,
    input: CreateSubgroupInput,
    ctx: AuditContext = {},
  ): Promise<Subgroup> {
    await this.getWarehouse(tenantId, warehouseId);

    const existingByGid = await this.repository.findSubgroupByGid(input.gid, warehouseId, tenantId);
    if (existingByGid) {
      throw new ConflictError(`Subgroup with GID '${input.gid}' already exists in this warehouse`);
    }

    const now = new Date();
    const subgroup: Subgroup = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      name: input.name,
      gid: input.gid,
      typeName: input.typeName ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'subgroup.create', resourceType: 'subgroup' },
      () => this.repository.createSubgroup(subgroup),
    );
  }

  async updateSubgroup(
    tenantId: string,
    warehouseId: string,
    subgroupId: string,
    input: UpdateSubgroupInput,
    ctx: AuditContext = {},
  ): Promise<Subgroup> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findSubgroupById(subgroupId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Subgroup not found: ${subgroupId}`);
    }
    const updates: Partial<Subgroup> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.typeName !== undefined) updates.typeName = input.typeName ?? null;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'subgroup.update',
        resourceType: 'subgroup',
        resourceId: subgroupId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateSubgroup(subgroupId, warehouseId, tenantId, updates),
    );
  }

  async deleteSubgroup(
    tenantId: string,
    warehouseId: string,
    subgroupId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findSubgroupById(subgroupId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Subgroup not found: ${subgroupId}`);
    }
    await this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'subgroup.delete',
        resourceType: 'subgroup',
        resourceId: subgroupId,
      },
      () => this.repository.deleteSubgroup(subgroupId, warehouseId, tenantId),
    );
  }

  async getSubgroup(tenantId: string, warehouseId: string, subgroupId: string): Promise<Subgroup> {
    await this.getWarehouse(tenantId, warehouseId);
    const subgroup = await this.repository.findSubgroupById(subgroupId, warehouseId, tenantId);
    if (!subgroup) {
      throw new NotFoundError(`Subgroup not found: ${subgroupId}`);
    }
    return subgroup;
  }

  async listSubgroups(
    tenantId: string,
    warehouseId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);
    return this.repository.listSubgroups(warehouseId, tenantId, filter, page, pageSize);
  }

  // ─── Time Period Operations ─────────────────────────────────────────────────

  async createTimePeriod(
    tenantId: string,
    warehouseId: string,
    input: CreateTimePeriodInput,
    ctx: AuditContext = {},
  ): Promise<TimePeriod> {
    await this.getWarehouse(tenantId, warehouseId);

    const existingByLabel = await this.repository.findTimePeriodByLabel(
      input.timePeriod,
      warehouseId,
      tenantId,
    );
    if (existingByLabel) {
      throw new ConflictError(`Time period '${input.timePeriod}' already exists in this warehouse`);
    }

    const startDate = input.startDate ? parseIsoDate(input.startDate, 'startDate') : null;
    const endDate = input.endDate ? parseIsoDate(input.endDate, 'endDate') : null;
    assertPeriodOrder(startDate, endDate);

    const now = new Date();
    const timePeriod: TimePeriod = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      timePeriod: input.timePeriod,
      startDate,
      endDate,
      periodicity: input.periodicity ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'time_period.create', resourceType: 'time_period' },
      () => this.repository.createTimePeriod(timePeriod),
    );
  }

  async updateTimePeriod(
    tenantId: string,
    warehouseId: string,
    timePeriodId: string,
    input: UpdateTimePeriodInput,
    ctx: AuditContext = {},
  ): Promise<TimePeriod> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findTimePeriodById(timePeriodId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Time period not found: ${timePeriodId}`);
    }
    const updates: Partial<TimePeriod> = {};
    if (input.startDate !== undefined)
      updates.startDate = input.startDate ? parseIsoDate(input.startDate, 'startDate') : null;
    if (input.endDate !== undefined)
      updates.endDate = input.endDate ? parseIsoDate(input.endDate, 'endDate') : null;
    // Validate the resulting period against existing values.
    assertPeriodOrder(
      updates.startDate !== undefined ? updates.startDate : existing.startDate,
      updates.endDate !== undefined ? updates.endDate : existing.endDate,
    );
    if (input.periodicity !== undefined) updates.periodicity = input.periodicity ?? null;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'time_period.update',
        resourceType: 'time_period',
        resourceId: timePeriodId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateTimePeriod(timePeriodId, warehouseId, tenantId, updates),
    );
  }

  async deleteTimePeriod(
    tenantId: string,
    warehouseId: string,
    timePeriodId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findTimePeriodById(timePeriodId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Time period not found: ${timePeriodId}`);
    }
    await this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'time_period.delete',
        resourceType: 'time_period',
        resourceId: timePeriodId,
      },
      () => this.repository.deleteTimePeriod(timePeriodId, warehouseId, tenantId),
    );
  }

  async getTimePeriod(
    tenantId: string,
    warehouseId: string,
    timePeriodId: string,
  ): Promise<TimePeriod> {
    await this.getWarehouse(tenantId, warehouseId);
    const tp = await this.repository.findTimePeriodById(timePeriodId, warehouseId, tenantId);
    if (!tp) {
      throw new NotFoundError(`Time period not found: ${timePeriodId}`);
    }
    return tp;
  }

  async listTimePeriods(
    tenantId: string,
    warehouseId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);
    return this.repository.listTimePeriods(warehouseId, tenantId, filter, page, pageSize);
  }

  // ─── Area Operations ────────────────────────────────────────────────────────

  async createArea(
    tenantId: string,
    warehouseId: string,
    input: CreateAreaInput,
    ctx: AuditContext = {},
  ): Promise<Area> {
    await this.getWarehouse(tenantId, warehouseId);

    // Check external area ID uniqueness within warehouse
    const existingByAreaId = await this.repository.findAreaByExternalId(
      input.areaId,
      warehouseId,
      tenantId,
    );
    if (existingByAreaId) {
      throw new ConflictError(`Area with ID '${input.areaId}' already exists in this warehouse`);
    }

    // Validate parent exists if specified, and that the level follows the parent
    if (input.parentId) {
      const parent = await this.repository.findAreaById(input.parentId, warehouseId, tenantId);
      if (!parent) {
        throw new NotFoundError(`Parent area not found: ${input.parentId}`);
      }
      assertChildLevel(parent, input.level);
    }

    const now = new Date();
    const area: Area = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      name: input.name,
      areaId: input.areaId,
      gid: input.gid,
      parentId: input.parentId ?? null,
      level: input.level,
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'area.create', resourceType: 'area' },
      () => this.repository.createArea(area),
    );
  }

  async updateArea(
    tenantId: string,
    warehouseId: string,
    areaId: string,
    input: UpdateAreaInput,
    ctx: AuditContext = {},
  ): Promise<Area> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findAreaById(areaId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Area not found: ${areaId}`);
    }

    const effectiveParentId = input.parentId !== undefined ? input.parentId : existing.parentId;
    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === areaId) {
        throw new ConflictError('An area cannot be its own parent');
      }
      const parent = await this.repository.findAreaById(input.parentId, warehouseId, tenantId);
      if (!parent) {
        throw new NotFoundError(`Parent area not found: ${input.parentId}`);
      }
      // Walk the ancestor chain of the new parent; reaching areaId means a cycle.
      const seen = new Set<string>([parent.id]);
      let cursor: Area | null = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === areaId) {
          throw new ConflictError('Parent area cannot be a descendant of this area');
        }
        if (seen.has(cursor.parentId)) break; // defensive: pre-existing corrupt cycle
        seen.add(cursor.parentId);
        cursor = await this.repository.findAreaById(cursor.parentId, warehouseId, tenantId);
      }
    }
    if (effectiveParentId && (input.parentId !== undefined || input.level !== undefined)) {
      const parent = await this.repository.findAreaById(effectiveParentId, warehouseId, tenantId);
      if (parent) assertChildLevel(parent, input.level ?? existing.level);
    }

    const updates: Partial<Area> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.parentId !== undefined) updates.parentId = input.parentId ?? null;
    if (input.level !== undefined) updates.level = input.level;
    return this.audit.wrap(
      ctx,
      {
        tenantId,
        warehouseId,
        action: 'area.update',
        resourceType: 'area',
        resourceId: areaId,
        counts: { fieldsChanged: Object.keys(updates).length },
      },
      () => this.repository.updateArea(areaId, warehouseId, tenantId, updates),
    );
  }

  async deleteArea(
    tenantId: string,
    warehouseId: string,
    areaId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.getWarehouse(tenantId, warehouseId);
    const existing = await this.repository.findAreaById(areaId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Area not found: ${areaId}`);
    }
    await this.audit.wrap(
      ctx,
      { tenantId, warehouseId, action: 'area.delete', resourceType: 'area', resourceId: areaId },
      () => this.repository.deleteArea(areaId, warehouseId, tenantId),
    );
  }

  async getArea(tenantId: string, warehouseId: string, areaId: string): Promise<Area> {
    await this.getWarehouse(tenantId, warehouseId);
    const area = await this.repository.findAreaById(areaId, warehouseId, tenantId);
    if (!area) {
      throw new NotFoundError(`Area not found: ${areaId}`);
    }
    return area;
  }

  async listAreas(
    tenantId: string,
    warehouseId: string,
    filter: ListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);
    return this.repository.listAreas(warehouseId, tenantId, filter, page, pageSize);
  }

  // ─── Data Import ────────────────────────────────────────────────────────────

  /**
   * Import data into the warehouse from various formats.
   * Validates IUS-area-timeperiod uniqueness and referential integrity.
   */
  async importData(
    tenantId: string,
    warehouseId: string,
    format: ImportFormat,
    options: {
      records?: DataRecordInput[];
      fileContent?: string;
      dbConnectionConfig?: {
        host: string;
        port: number;
        database: string;
        username: string;
        password: string;
        query: string;
      };
    },
    ctx: AuditContext = {},
  ): Promise<ImportResult> {
    await this.getWarehouse(tenantId, warehouseId);

    let records: DataRecordInput[];
    let rowErrors: Map<number, ImportRowError> | undefined;

    switch (format) {
      case 'csv': {
        if (options.fileContent) {
          const csvContent = Buffer.from(options.fileContent, 'base64').toString('utf-8');
          ({ records, rowErrors } = parseCsvImport(csvContent));
        } else if (options.records) {
          records = options.records;
        } else {
          return {
            totalRows: 0,
            successCount: 0,
            errorCount: 1,
            duplicateCount: 0,
            errors: [{ row: 0, field: null, message: 'No data provided for CSV import' }],
          };
        }
        break;
      }
      case 'excel_des': {
        if (options.fileContent) {
          ({ records, rowErrors } = parseExcelDesImport(options.fileContent));
        } else {
          return {
            totalRows: 0,
            successCount: 0,
            errorCount: 1,
            duplicateCount: 0,
            errors: [
              { row: 0, field: null, message: 'File content is required for Excel DES import' },
            ],
          };
        }
        break;
      }
      case 'db': {
        if (options.dbConnectionConfig) {
          // Database import would connect to the specified database and execute the query.
          // For now, return an error indicating this requires a live database connection.
          return {
            totalRows: 0,
            successCount: 0,
            errorCount: 1,
            duplicateCount: 0,
            errors: [
              {
                row: 0,
                field: null,
                message:
                  'Database import requires a live database connection (not yet implemented for in-memory mode)',
              },
            ],
          };
        } else {
          return {
            totalRows: 0,
            successCount: 0,
            errorCount: 1,
            duplicateCount: 0,
            errors: [
              {
                row: 0,
                field: null,
                message: 'Database connection configuration is required for db import',
              },
            ],
          };
        }
      }
      default:
        return {
          totalRows: 0,
          successCount: 0,
          errorCount: 1,
          duplicateCount: 0,
          errors: [
            { row: 0, field: null, message: `Unsupported import format: ${format as string}` },
          ],
        };
    }

    // Enforce batch size limit
    if (records.length > this.config.maxImportBatchSize) {
      return {
        totalRows: records.length,
        successCount: 0,
        errorCount: 1,
        duplicateCount: 0,
        errors: [
          {
            row: 0,
            field: null,
            message: `Import batch size ${records.length} exceeds maximum of ${this.config.maxImportBatchSize}`,
          },
        ],
      };
    }

    return this.audit.wrap(
      ctx,
      (result: ImportResult) => ({
        tenantId,
        warehouseId,
        action: 'data.import',
        resourceType: 'warehouse',
        resourceId: warehouseId,
        counts: {
          totalRows: result.totalRows,
          successCount: result.successCount,
          errorCount: result.errorCount,
          duplicateCount: result.duplicateCount,
        },
      }),
      () =>
        importDataRecords(
          { warehouseId, tenantId, repository: this.repository, rowErrors },
          records,
        ),
    );
  }

  // ─── Data Query ─────────────────────────────────────────────────────────────

  async queryData(
    tenantId: string,
    warehouseId: string,
    query: {
      indicatorIds?: string[];
      unitIds?: string[];
      subgroupIds?: string[];
      areaIds?: string[];
      timePeriods?: string[];
    },
    page: number,
    pageSize: number,
  ) {
    await this.getWarehouse(tenantId, warehouseId);

    // Resolve time period labels to IDs if provided
    let timePeriodIds: string[] | undefined;
    if (query.timePeriods && query.timePeriods.length > 0) {
      timePeriodIds = [];
      for (const label of query.timePeriods) {
        const tp = await this.repository.findTimePeriodByLabel(label, warehouseId, tenantId);
        if (tp) {
          timePeriodIds.push(tp.id);
        }
      }
    }

    return this.repository.queryData(
      warehouseId,
      tenantId,
      {
        indicatorIds: query.indicatorIds,
        unitIds: query.unitIds,
        subgroupIds: query.subgroupIds,
        areaIds: query.areaIds,
        timePeriodIds,
      },
      page,
      pageSize,
    );
  }
}
