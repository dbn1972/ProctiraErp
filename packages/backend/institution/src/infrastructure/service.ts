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
import {
  NotFoundError,
  BusinessRuleError,
  ConflictError,
  type PaginatedResult,
} from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  FACILITY_CONDITIONS,
  InfrastructureType,
  type InfrastructureTypeValue,
  type CreateLandInput,
  type CreateBuildingInput,
  type CreateFloorInput,
  type CreateRoomInput,
  type UpdateInfrastructureInput,
  type InfrastructureResponse,
  type InfrastructureHierarchyResponse,
} from './schemas.js';

/**
 * Represents an infrastructure item stored in the data layer.
 */
export interface InfrastructureRecord {
  id: string;
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
 * Storage interface for infrastructure items.
 * Implementations can use in-memory stores (for testing) or database stores.
 */
export interface InfrastructureStore {
  create(record: InfrastructureRecord): Promise<InfrastructureRecord>;
  findById(id: string): Promise<InfrastructureRecord | null>;
  findByInstitutionAndType(
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }>;
  findByParent(
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }>;
  findAllByInstitution(institutionId: string): Promise<InfrastructureRecord[]>;
  update(
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ): Promise<InfrastructureRecord | null>;
  delete(id: string): Promise<boolean>;
  hasChildren(id: string): Promise<boolean>;
  createRepairRequest(record: RepairRequestRecord): Promise<RepairRequestRecord>;
  listRepairRequests(institutionId: string): Promise<RepairRequestRecord[]>;
  /** PRC-L124: tenant-scoped lookup of one repair request. */
  findRepairRequest(id: string): Promise<RepairRequestRecord | null>;
  /**
   * PRC-L124: set a repair request's status. Conditional on `fromStatus` so a
   * concurrent close/reopen cannot be lost; returns null when it did not match.
   */
  updateRepairRequestStatus(
    id: string,
    fromStatus: RepairRequestRecord['status'],
    toStatus: RepairRequestRecord['status'],
  ): Promise<RepairRequestRecord | null>;
}

export interface RepairRequestRecord {
  id: string;
  institutionId: string;
  infrastructureId: string;
  summary: string;
  status: 'open' | 'closed';
  createdAt: Date;
}

/**
 * Store for configurable condition options.
 */
export interface ConditionOptionRecord {
  id: string;
  name: string;
  description: string | null;
}

export interface ConditionOptionStore {
  create(record: ConditionOptionRecord): Promise<ConditionOptionRecord>;
  findAll(): Promise<ConditionOptionRecord[]>;
  findByName(name: string): Promise<ConditionOptionRecord | null>;
  delete(id: string): Promise<boolean>;
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
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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
  private async validateCondition(condition: string): Promise<void> {
    if (!(FACILITY_CONDITIONS as readonly string[]).includes(condition)) {
      throw new BusinessRuleError(
        `Invalid condition '${condition}'. Valid options are: ${FACILITY_CONDITIONS.join(', ')}`,
      );
    }
    const options = await this.conditionStore.findAll();
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
    parentId: string,
    expectedType: InfrastructureTypeValue,
    institutionId: string,
  ): Promise<void> {
    const parent = await this.store.findById(parentId);
    if (!parent) {
      throw new NotFoundError(`Parent infrastructure item not found: ${parentId}`);
    }
    if (parent.type !== expectedType) {
      throw new BusinessRuleError(
        `Parent must be of type ${expectedType}, but found ${parent.type}`,
      );
    }
    if (parent.institutionId !== institutionId) {
      throw new BusinessRuleError('Parent infrastructure item belongs to a different institution');
    }
  }

  // ─── Land CRUD ───────────────────────────────────────────────────────────────

  async createLand(input: CreateLandInput): Promise<InfrastructureResponse> {
    await this.validateCondition(input.condition);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
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

  async createBuilding(input: CreateBuildingInput): Promise<InfrastructureResponse> {
    await this.validateCondition(input.condition);
    await this.validateParent(input.landId, InfrastructureType.LAND, input.institutionId);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
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

  async createFloor(input: CreateFloorInput): Promise<InfrastructureResponse> {
    await this.validateCondition(input.condition);
    await this.validateParent(input.buildingId, InfrastructureType.BUILDING, input.institutionId);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
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

  async createRoom(input: CreateRoomInput): Promise<InfrastructureResponse> {
    await this.validateCondition(input.condition);
    await this.validateParent(input.floorId, InfrastructureType.FLOOR, input.institutionId);

    const now = new Date();
    const record: InfrastructureRecord = {
      id: uuidv4(),
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
  async getById(id: string): Promise<InfrastructureResponse> {
    const record = await this.store.findById(id);
    if (!record) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }
    return toResponse(record);
  }

  /**
   * Update an infrastructure item.
   */
  async update(id: string, input: UpdateInfrastructureInput): Promise<InfrastructureResponse> {
    const existing = await this.store.findById(id);
    if (!existing) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }

    if (input.condition !== undefined) {
      await this.validateCondition(input.condition);
    }

    const updated = await this.store.update(id, {
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
  async delete(id: string): Promise<void> {
    const existing = await this.store.findById(id);
    if (!existing) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }

    const childType = CHILD_TYPE_MAP[existing.type];
    if (childType) {
      const hasChildren = await this.store.hasChildren(id);
      if (hasChildren) {
        throw new BusinessRuleError(
          `Cannot delete ${existing.type.toLowerCase()} '${existing.name}' because it has child items. Delete children first.`,
        );
      }
    }

    const deleted = await this.store.delete(id);
    if (!deleted) {
      throw new NotFoundError(`Infrastructure item not found: ${id}`);
    }
  }

  /**
   * List lands for an institution.
   */
  async listLands(
    institutionId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const { items, total } = await this.store.findByInstitutionAndType(
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
    landId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(landId);
    if (!parent || parent.type !== InfrastructureType.LAND) {
      throw new NotFoundError(`Land not found: ${landId}`);
    }

    const { items, total } = await this.store.findByParent(
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
    buildingId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(buildingId);
    if (!parent || parent.type !== InfrastructureType.BUILDING) {
      throw new NotFoundError(`Building not found: ${buildingId}`);
    }

    const { items, total } = await this.store.findByParent(
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
    floorId: string,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<PaginatedResult<InfrastructureResponse>> {
    const parent = await this.store.findById(floorId);
    if (!parent || parent.type !== InfrastructureType.FLOOR) {
      throw new NotFoundError(`Floor not found: ${floorId}`);
    }

    const { items, total } = await this.store.findByParent(
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
  async getHierarchy(institutionId: string): Promise<InfrastructureHierarchyResponse> {
    const allItems = await this.store.findAllByInstitution(institutionId);

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

  async logRepairRequest(input: {
    institutionId: string;
    infrastructureId: string;
    summary: string;
  }): Promise<RepairRequestRecord> {
    const item = await this.store.findById(input.infrastructureId);
    if (!item || item.institutionId !== input.institutionId) {
      throw new NotFoundError('Facility not found');
    }
    const summary = input.summary.trim();
    if (!summary) {
      throw new BusinessRuleError('A repair summary is required');
    }
    return this.store.createRepairRequest({
      id: uuidv4(),
      institutionId: input.institutionId,
      infrastructureId: input.infrastructureId,
      summary,
      status: 'open',
      createdAt: new Date(),
    });
  }

  listRepairRequests(institutionId: string): Promise<RepairRequestRecord[]> {
    return this.store.listRepairRequests(institutionId);
  }
  /**
   * PRC-L124: close (or reopen) a repair request. 404 when it does not belong
   * to the given institution (no cross-institution probing); 409 when it is
   * already in the requested status or changed concurrently.
   */
  async setRepairRequestStatus(input: {
    id: string;
    institutionId: string;
    status: RepairRequestRecord['status'];
  }): Promise<RepairRequestRecord> {
    const existing = await this.store.findRepairRequest(input.id);
    if (!existing || existing.institutionId !== input.institutionId) {
      throw new NotFoundError('Repair request not found');
    }
    if (existing.status === input.status) {
      throw new ConflictError(`Repair request is already ${input.status}`);
    }
    const updated = await this.store.updateRepairRequestStatus(
      input.id,
      existing.status,
      input.status,
    );
    if (!updated) {
      throw new ConflictError('Repair request was modified concurrently; reload and retry');
    }
    return updated;
  }

  // ─── Condition Options Management ────────────────────────────────────────────

  /**
   * Add a configurable condition option.
   */
  async addConditionOption(name: string, description?: string): Promise<ConditionOptionRecord> {
    const existing = await this.conditionStore.findByName(name);
    if (existing) {
      throw new BusinessRuleError(`Condition option '${name}' already exists`);
    }

    return this.conditionStore.create({
      id: uuidv4(),
      name,
      description: description ?? null,
    });
  }

  /**
   * List all configurable condition options.
   */
  async listConditionOptions(): Promise<ConditionOptionRecord[]> {
    return this.conditionStore.findAll();
  }

  /**
   * Delete a condition option.
   */
  async deleteConditionOption(id: string): Promise<void> {
    const deleted = await this.conditionStore.delete(id);
    if (!deleted) {
      throw new NotFoundError(`Condition option not found: ${id}`);
    }
  }
}
