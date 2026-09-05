/**
 * Infrastructure Hierarchy Service
 *
 * Business logic for managing infrastructure items (land, buildings, floors, rooms)
 * in a parent-child hierarchy. Each item belongs to an institution and records
 * numeric capacity (1–99,999) and condition status from configurable options.
 *
 * Hierarchy: Land → Building → Floor → Room
 *
 * @module infrastructure/service
 * @requirements 5.6
 */
import { NotFoundError, BusinessRuleError, type PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
import { toIsoDate, toIsoString } from '../date-utils.js';
  InfrastructureType,
  type InfrastructureTypeValue,
  type CreateLandInput,
  type CreateBuildingInput,
  type CreateFloorInput,
  type CreateRoomInput,
  type UpdateInfrastructureInput,
  type CreateInfrastructureRepairInput,
  type InfrastructureResponse,
  type InfrastructureHierarchyResponse,
  type InfrastructureRepairLogResponse,
} from './schemas.js';

/**
 * Represents an infrastructure item stored in the data layer.
 */
export interface InfrastructureRecord {
  id: string;
  tenantId: string;
  name: string;
  type: InfrastructureTypeValue;
  institutionId: string;
  parentId: string | null;
  capacity: number;
  condition: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Append-only repair log entry for an infrastructure item.
 */
export interface InfrastructureRepairLogRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  infrastructureItemId: string;
  repairDate: Date;
  notes: string;
  conditionAfter: string;
  cost: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Storage interface for infrastructure items.
 * Implementations can use in-memory stores (for testing) or database stores.
 */
export interface InfrastructureStore {
  create(record: InfrastructureRecord): Promise<InfrastructureRecord>;
  findById(tenantId: string, id: string): Promise<InfrastructureRecord | null>;
  findByInstitutionAndType(
    tenantId: string,
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }>;
  findByParent(
    tenantId: string,
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }>;
  findAllByInstitution(tenantId: string, institutionId: string): Promise<InfrastructureRecord[]>;
  update(
    tenantId: string,
    id: string,
    data: Partial<Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>>,
  ): Promise<InfrastructureRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  hasChildren(tenantId: string, id: string): Promise<boolean>;
  createRepairLog(record: InfrastructureRepairLogRecord): Promise<InfrastructureRepairLogRecord>;
  listRepairLogs(
    tenantId: string,
    infrastructureItemId: string,
  ): Promise<InfrastructureRepairLogRecord[]>;
}

/**
 * Store for configurable condition options.
 */
export interface ConditionOptionRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
}

export interface ConditionOptionStore {
  create(record: ConditionOptionRecord): Promise<ConditionOptionRecord>;
  findAll(tenantId: string): Promise<ConditionOptionRecord[]>;
  findByName(tenantId: string, name: string): Promise<ConditionOptionRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

/**
 * Maps an InfrastructureRecord to the API response format.
 */
function toResponse(record: InfrastructureRecord): InfrastructureResponse {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    institutionId: record.institutionId,
    parentId: record.parentId,
    capacity: record.capacity,
    condition: record.condition,
    description: record.description,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

function toRepairResponse(record: InfrastructureRepairLogRecord): InfrastructureRepairLogResponse {
  return {
    id: record.id,
    institutionId: record.institutionId,
    infrastructureItemId: record.infrastructureItemId,
    repairDate: toIsoDate(record.repairDate),
    notes: record.notes,
    conditionAfter: record.conditionAfter,
    cost: record.cost,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

/**
 * Child type for each infrastructure type.
 */
const CHILD_TYPE_MAP: Record<string, InfrastructureTypeValue | null> = {
  [InfrastructureType.LAND]: InfrastructureType.BUILDING,
  [InfrastructureType.BUILDING]: InfrastructureType.FLOOR,
  [InfrastructureType.FLOOR]: InfrastructureType.ROOM,
  [InfrastructureType.ROOM]: null,
};

export interface InfrastructureServiceOptions {
  store: InfrastructureStore;
  conditionStore: ConditionOptionStore;
}

/**
 * Infrastructure Hierarchy Service.
 *
 * Manages CRUD operations for land, buildings, floors, and rooms
 * in a parent-child hierarchy within an institution.
 */
export class InfrastructureService {
  private readonly store: InfrastructureStore;
  private readonly conditionStore: ConditionOptionStore;

  constructor(options: InfrastructureServiceOptions) {
    this.store = options.store;
    this.conditionStore = options.conditionStore;
  }

  /**
   * Validates that the condition value exists in the configurable options.
   */
  private async validateCondition(tenantId: string, condition: string): Promise<void> {
    const options = await this.conditionStore.findAll(tenantId);
    // If no condition options are configured, allow any non-empty value
    if (options.length === 0) return;

    const found = options.find((opt) => opt.name === condition);
    if (!found) {
      const validOptions = options.map((opt) => opt.name).join(', ');
      throw new BusinessRuleError(
        `Invalid condition '${condition}'. Valid options are: ${validOptions}`,
      );
    }
  }

  /**
   * Validates that the parent exists and is of the expected type.
   */
  private async validateParent(
    tenantId: string,
    parentId: string,
    expectedType: InfrastructureTypeValue,
    institutionId: string,
  ): Promise<void> {
    const parent = await this.store.findById(tenantId, parentId);
    if (!parent) {
      throw new NotFoundError(`Parent infrastructure item not found: ${parentId}`);
    }
    if (parent.type !== expectedType) {
      throw new BusinessRuleError(
        `Parent must be of type ${expectedType}, but found ${parent.type}`,
      );
    }
    if (parent.institutionId !== institutionId) {
      throw new BusinessRuleError(
        'Parent infrastructure item belongs to a different institution',
      );
    }
  }

  // ─── Land CRUD ───────────────────────────────────────────────────────────────

  async createLand(tenantId: string, input: CreateLandInput): Promise<InfrastructureResponse> {
    await this.validateCondition(tenantId, input.condition);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: InfrastructureType.LAND,
      institutionId: input.institutionId,
      parentId: null,
      capacity: input.capacity,
      condition: input.condition,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(record);
    return toResponse(created);
  }

  // ─── Building CRUD ───────────────────────────────────────────────────────────

  async createBuilding(
    tenantId: string,
    input: CreateBuildingInput,
  ): Promise<InfrastructureResponse> {
    await this.validateCondition(tenantId, input.condition);
    await this.validateParent(tenantId, input.landId, InfrastructureType.LAND, input.institutionId);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: InfrastructureType.BUILDING,
      institutionId: input.institutionId,
      parentId: input.landId,
      capacity: input.capacity,
      condition: input.condition,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(record);
    return toResponse(created);
  }

  // ─── Floor CRUD ──────────────────────────────────────────────────────────────

  async createFloor(tenantId: string, input: CreateFloorInput): Promise<InfrastructureResponse> {
    await this.validateCondition(tenantId, input.condition);
    await this.validateParent(
      tenantId,
      input.buildingId,
      InfrastructureType.BUILDING,
      input.institutionId,
    );

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: InfrastructureType.FLOOR,
      institutionId: input.institutionId,
      parentId: input.buildingId,
      capacity: input.capacity,
      condition: input.condition,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(record);
    return toResponse(created);
  }

  // ─── Room CRUD ───────────────────────────────────────────────────────────────

  async createRoom(tenantId: string, input: CreateRoomInput): Promise<InfrastructureResponse> {
    await this.validateCondition(tenantId, input.condition);
    await this.validateParent(tenantId, input.floorId, InfrastructureType.FLOOR, input.institutionId);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: InfrastructureType.ROOM,
      institutionId: input.institutionId,
      parentId: input.floorId,
      capacity: input.capacity,
      condition: input.condition,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(record);
    return toResponse(created);
  }

  // ─── Shared Operations ───────────────────────────────────────────────────────

  /**
   * Get a single infrastructure item by ID.
   */
  async getById(tenantId: string, id: string): Promise<InfrastructureResponse> {
    const record = await this.store.findById(tenantId, id);
    if (!record) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }
    return toResponse(record);
  }

  /**
   * Update an infrastructure item.
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateInfrastructureInput,
  ): Promise<InfrastructureResponse> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }

    if (input.condition !== undefined) {
      await this.validateCondition(tenantId, input.condition);
    }

    const updated = await this.store.update(tenantId, id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.description !== undefined && { description: input.description }),
      updatedAt: new Date(),
    });

    if (!updated) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }

    return toResponse(updated);
  }

  /**
   * Delete an infrastructure item.
   * Prevents deletion if the item has children.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }

    const childType = CHILD_TYPE_MAP[existing.type];
    if (childType) {
      const hasChildren = await this.store.hasChildren(tenantId, id);
      if (hasChildren) {
        throw new BusinessRuleError(
          `Cannot delete ${existing.type.toLowerCase()} '${existing.name}' because it has child items. Delete children first.`,
        );
      }
    }

    const deleted = await this.store.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }
  }

  /**
   * List lands for an institution.
   */
  async listLands(
    tenantId: string,
    institutionId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const { items, total } = await this.store.findByInstitutionAndType(
      tenantId,
      institutionId,
      InfrastructureType.LAND,
      options,
    );

    return {
      data: items.map(toResponse),
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  /**
   * List buildings under a specific land.
   */
  async listBuildings(
    tenantId: string,
    landId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(tenantId, landId);
    if (!parent || parent.type !== InfrastructureType.LAND) {
      throw new NotFoundError(`Land not found: ${landId}`);
    }

    const { items, total } = await this.store.findByParent(
      tenantId,
      landId,
      InfrastructureType.BUILDING,
      options,
    );

    return {
      data: items.map(toResponse),
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  /**
   * List floors under a specific building.
   */
  async listFloors(
    tenantId: string,
    buildingId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(tenantId, buildingId);
    if (!parent || parent.type !== InfrastructureType.BUILDING) {
      throw new NotFoundError(`Building not found: ${buildingId}`);
    }

    const { items, total } = await this.store.findByParent(
      tenantId,
      buildingId,
      InfrastructureType.FLOOR,
      options,
    );

    return {
      data: items.map(toResponse),
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  /**
   * List rooms under a specific floor.
   */
  async listRooms(
    tenantId: string,
    floorId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(tenantId, floorId);
    if (!parent || parent.type !== InfrastructureType.FLOOR) {
      throw new NotFoundError(`Floor not found: ${floorId}`);
    }

    const { items, total } = await this.store.findByParent(
      tenantId,
      floorId,
      InfrastructureType.ROOM,
      options,
    );

    return {
      data: items.map(toResponse),
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  /**
   * Get the full infrastructure hierarchy for an institution as a tree.
   */
  async getHierarchy(
    tenantId: string,
    institutionId: string,
  ): Promise<InfrastructureHierarchyResponse> {
    const allItems = await this.store.findAllByInstitution(tenantId, institutionId);

    const lands = allItems.filter((item) => item.type === InfrastructureType.LAND);
    const buildings = allItems.filter((item) => item.type === InfrastructureType.BUILDING);
    const floors = allItems.filter((item) => item.type === InfrastructureType.FLOOR);
    const rooms = allItems.filter((item) => item.type === InfrastructureType.ROOM);

    return {
      lands: lands.map((land) => ({
        id: land.id,
        name: land.name,
        capacity: land.capacity,
        condition: land.condition,
        description: land.description,
        buildings: buildings
          .filter((b) => b.parentId === land.id)
          .map((building) => ({
            id: building.id,
            name: building.name,
            capacity: building.capacity,
            condition: building.condition,
            description: building.description,
            floors: floors
              .filter((f) => f.parentId === building.id)
              .map((floor) => ({
                id: floor.id,
                name: floor.name,
                capacity: floor.capacity,
                condition: floor.condition,
                description: floor.description,
                rooms: rooms
                  .filter((r) => r.parentId === floor.id)
                  .map((room) => ({
                    id: room.id,
                    name: room.name,
                    capacity: room.capacity,
                    condition: room.condition,
                    description: room.description,
                  })),
              })),
          })),
      })),
    };
  }

  // ─── Condition Options Management ────────────────────────────────────────────

  /**
   * Add a configurable condition option.
   */
  async addConditionOption(
    tenantId: string,
    name: string,
    description?: string,
  ): Promise<ConditionOptionRecord> {
    const existing = await this.conditionStore.findByName(tenantId, name);
    if (existing) {
      throw new BusinessRuleError(`Condition option '${name}' already exists`);
    }

    return this.conditionStore.create({
      id: uuidv4(),
      tenantId,
      name,
      description: description ?? null,
    });
  }

  /**
   * List all configurable condition options.
   */
  async listConditionOptions(tenantId: string): Promise<ConditionOptionRecord[]> {
    return this.conditionStore.findAll(tenantId);
  }

  /**
   * Delete a condition option.
   */
  async deleteConditionOption(tenantId: string, id: string): Promise<void> {
    const deleted = await this.conditionStore.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundError(`Condition option not found: ${id}`);
    }
  }

  // ─── Repair Logs ─────────────────────────────────────────────────────────────

  /**
   * Log a repair for an infrastructure item and update its condition.
   */
  async logRepair(
    tenantId: string,
    institutionId: string,
    itemId: string,
    input: CreateInfrastructureRepairInput,
  ): Promise<InfrastructureRepairLogResponse> {
    const item = await this.store.findById(tenantId, itemId);
    if (!item || item.institutionId !== institutionId) {
      throw new NotFoundError(`Infrastructure item not found: ${itemId}`);
    }

    await this.validateCondition(tenantId, input.conditionAfter);

    const now = new Date();
    const repairDate = new Date(`${input.date}T00:00:00.000Z`);
    const record = await this.store.createRepairLog({
      id: uuidv4(),
      tenantId,
      institutionId,
      infrastructureItemId: itemId,
      repairDate,
      notes: input.notes,
      conditionAfter: input.conditionAfter,
      cost: input.cost ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await this.store.update(tenantId, itemId, {
      condition: input.conditionAfter,
      updatedAt: now,
    });

    return toRepairResponse(record);
  }

  /**
   * List repair logs for an infrastructure item.
   */
  async listRepairs(
    tenantId: string,
    institutionId: string,
    itemId: string,
  ): Promise<InfrastructureRepairLogResponse[]> {
    const item = await this.store.findById(tenantId, itemId);
    if (!item || item.institutionId !== institutionId) {
      throw new NotFoundError(`Infrastructure item not found: ${itemId}`);
    }

    const logs = await this.store.listRepairLogs(tenantId, itemId);
    return logs.map(toRepairResponse);
  }
}
