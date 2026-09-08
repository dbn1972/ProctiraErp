/**
 * In-Memory Infrastructure Store
 *
 * Used for unit testing without database dependencies.
 * Implements InfrastructureStore and ConditionOptionStore interfaces.
 *
 * @module infrastructure/in-memory-store
 */
import type {
  InfrastructureStore,
  InfrastructureRecord,
  ConditionOptionStore,
  ConditionOptionRecord,
} from './service.js';
import type { InfrastructureTypeValue } from './schemas.js';

/**
 * In-memory implementation of InfrastructureStore for testing.
 */
export class InMemoryInfrastructureStore implements InfrastructureStore {
  private items: Map<string, InfrastructureRecord> = new Map();

  async create(record: InfrastructureRecord): Promise<InfrastructureRecord> {
    this.items.set(record.id, { ...record });
    return { ...record };
  }

  async findById(id: string): Promise<InfrastructureRecord | null> {
    const item = this.items.get(id);
    return item ? { ...item } : null;
  }

  async findByInstitutionAndType(
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    let filtered = Array.from(this.items.values()).filter(
      (item) => item.institutionId === institutionId && item.type === type,
    );

    // Sort
    filtered = this.sortItems(filtered, options.sortBy, options.sortOrder);

    // Paginate
    const total = filtered.length;
    const start = (options.page - 1) * options.pageSize;
    const items = filtered.slice(start, start + options.pageSize);

    return { items: items.map((i) => ({ ...i })), total };
  }

  async findByParent(
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    let filtered = Array.from(this.items.values()).filter(
      (item) => item.parentId === parentId && item.type === type,
    );

    // Sort
    filtered = this.sortItems(filtered, options.sortBy, options.sortOrder);

    // Paginate
    const total = filtered.length;
    const start = (options.page - 1) * options.pageSize;
    const items = filtered.slice(start, start + options.pageSize);

    return { items: items.map((i) => ({ ...i })), total };
  }

  async findAllByInstitution(institutionId: string): Promise<InfrastructureRecord[]> {
    return Array.from(this.items.values())
      .filter((item) => item.institutionId === institutionId)
      .map((i) => ({ ...i }));
  }

  async update(
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ): Promise<InfrastructureRecord | null> {
    const existing = this.items.get(id);
    if (!existing) return null;

    const updated: InfrastructureRecord = {
      ...existing,
      ...data,
    };
    this.items.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async hasChildren(id: string): Promise<boolean> {
    for (const item of this.items.values()) {
      if (item.parentId === id) return true;
    }
    return false;
  }

  /** Clear all items (test helper). */
  clear(): void {
    this.items.clear();
  }

  private sortItems(
    items: InfrastructureRecord[],
    sortBy: string,
    sortOrder: 'asc' | 'desc',
  ): InfrastructureRecord[] {
    return [...items].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortBy === 'capacity') {
        aVal = a.capacity;
        bVal = b.capacity;
      } else if (sortBy === 'createdAt') {
        aVal = a.createdAt.getTime();
        bVal = b.createdAt.getTime();
      } else {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }
}

/**
 * In-memory implementation of ConditionOptionStore for testing.
 */
export class InMemoryConditionOptionStore implements ConditionOptionStore {
  private options: Map<string, ConditionOptionRecord> = new Map();

  async create(record: ConditionOptionRecord): Promise<ConditionOptionRecord> {
    this.options.set(record.id, { ...record });
    return { ...record };
  }

  async findAll(): Promise<ConditionOptionRecord[]> {
    return Array.from(this.options.values()).map((o) => ({ ...o }));
  }

  async findByName(name: string): Promise<ConditionOptionRecord | null> {
    for (const option of this.options.values()) {
      if (option.name === name) return { ...option };
    }
    return null;
  }

  async delete(id: string): Promise<boolean> {
    return this.options.delete(id);
  }

  /** Clear all options (test helper). */
  clear(): void {
    this.options.clear();
  }
}
