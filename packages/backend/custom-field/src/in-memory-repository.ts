/**
 * In-Memory Custom Field Repository
 *
 * In-memory implementation of the custom field repositories for testing.
 * Simulates JSONB storage with GIN index behavior via Map-based lookups.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  CustomFieldDefinition,
  CustomFieldDefinitionFilter,
  CustomFieldDefinitionRepository,
  CustomFieldEntityType,
  CustomFieldValue,
  CustomFieldValueRepository,
} from './custom-field-repository.js';

/**
 * In-memory implementation of CustomFieldDefinitionRepository.
 */
export class InMemoryCustomFieldDefinitionRepository implements CustomFieldDefinitionRepository {
  private definitions: Map<string, CustomFieldDefinition> = new Map();

  async create(
    data: Omit<CustomFieldDefinition, 'createdAt' | 'updatedAt'>,
  ): Promise<CustomFieldDefinition> {
    const now = new Date();
    const definition: CustomFieldDefinition = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.definitions.set(definition.id, definition);
    return definition;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<CustomFieldDefinition>,
  ): Promise<CustomFieldDefinition | null> {
    const existing = this.definitions.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: CustomFieldDefinition = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      updatedAt: new Date(),
    };
    this.definitions.set(id, updated);
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<CustomFieldDefinition | null> {
    const definition = this.definitions.get(id);
    if (!definition || definition.tenantId !== tenantId) {
      return null;
    }
    return definition;
  }

  async findByFieldKey(
    fieldKey: string,
    entityType: CustomFieldEntityType,
    tenantId: string,
  ): Promise<CustomFieldDefinition | null> {
    for (const definition of this.definitions.values()) {
      if (
        definition.fieldKey === fieldKey &&
        definition.entityType === entityType &&
        definition.tenantId === tenantId
      ) {
        return definition;
      }
    }
    return null;
  }

  async list(
    tenantId: string,
    filter: CustomFieldDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CustomFieldDefinition>> {
    let items = Array.from(this.definitions.values()).filter((d) => d.tenantId === tenantId);

    // Apply filters
    if (filter.entityType) {
      items = items.filter((d) => d.entityType === filter.entityType);
    }
    if (filter.isActive !== undefined) {
      items = items.filter((d) => d.isActive === filter.isActive);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(
        (d) =>
          d.label.toLowerCase().includes(searchLower) ||
          d.fieldKey.toLowerCase().includes(searchLower),
      );
    }

    // Sort by display order
    items.sort((a, b) => a.displayOrder - b.displayOrder);

    // Paginate
    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 20;
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (page - 1) * pageSize;
    const data = items.slice(start, start + pageSize);

    return {
      data,
      meta: { page, pageSize, totalItems, totalPages },
    };
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const existing = this.definitions.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return false;
    }
    // Soft delete: set isActive to false
    existing.isActive = false;
    existing.updatedAt = new Date();
    this.definitions.set(id, existing);
    return true;
  }

  /** Helper: clear all data (for testing) */
  clear(): void {
    this.definitions.clear();
  }
}

/**
 * In-memory implementation of CustomFieldValueRepository.
 * Uses a composite key of entityType:entityId:fieldDefinitionId for upsert behavior.
 */
export class InMemoryCustomFieldValueRepository implements CustomFieldValueRepository {
  private values: Map<string, CustomFieldValue> = new Map();

  private compositeKey(entityType: string, entityId: string, fieldDefinitionId: string): string {
    return `${entityType}:${entityId}:${fieldDefinitionId}`;
  }

  async setValue(
    data: Omit<CustomFieldValue, 'createdAt' | 'updatedAt'>,
  ): Promise<CustomFieldValue> {
    const key = this.compositeKey(data.entityType, data.entityId, data.fieldDefinitionId);
    const existing = this.values.get(key);
    const now = new Date();

    const value: CustomFieldValue = {
      ...data,
      id: existing?.id ?? data.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.values.set(key, value);
    return value;
  }

  async getValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<CustomFieldValue[]> {
    const results: CustomFieldValue[] = [];
    for (const value of this.values.values()) {
      if (
        value.tenantId === tenantId &&
        value.entityType === entityType &&
        value.entityId === entityId
      ) {
        results.push(value);
      }
    }
    return results;
  }

  async getValue(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
  ): Promise<CustomFieldValue | null> {
    const key = this.compositeKey(entityType, entityId, fieldDefinitionId);
    const value = this.values.get(key);
    if (!value || value.tenantId !== tenantId) {
      return null;
    }
    return value;
  }

  async deleteValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<number> {
    let count = 0;
    for (const [key, value] of this.values.entries()) {
      if (
        value.tenantId === tenantId &&
        value.entityType === entityType &&
        value.entityId === entityId
      ) {
        this.values.delete(key);
        count++;
      }
    }
    return count;
  }

  async deleteValue(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
  ): Promise<boolean> {
    const key = this.compositeKey(entityType, entityId, fieldDefinitionId);
    const value = this.values.get(key);
    if (!value || value.tenantId !== tenantId) {
      return false;
    }
    this.values.delete(key);
    return true;
  }

  /** Helper: clear all data (for testing) */
  clear(): void {
    this.values.clear();
  }
}
