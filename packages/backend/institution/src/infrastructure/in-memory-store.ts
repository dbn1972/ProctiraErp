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
  InfrastructureRepairLogRecord,
  ConditionOptionStore,
  ConditionOptionRecord,
} from './service.js';
import type { InfrastructureTypeValue } from './schemas.js';

/**
 * In-memory implementation of InfrastructureStore for testing.
 */
export class InMemoryInfrastructureStore implements InfrastructureStore {
  private items: Map<string, InfrastructureRecord> = new Map();
  private repairLogs: Map<string, InfrastructureRepairLogRecord> = new Map();

  async create(record: InfrastructureRecord): Promise<InfrastructureRecord> {
    this.items.set(record.id, { ...record });
    return { ...record };
  }

  async findById(tenantId: string, id: string): Promise<InfrastructureRecord | null> {
    const item = this.items.get(id);
    if (!item || item.tenantId !== tenantId) return null;
    return { ...item };
  }

  async findByInstitutionAndType(
    tenantId: string,
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    let filtered = Array.from(this.items.values()).filter(
      (item) =>
        item.tenantId === tenantId &&
        item.institutionId === institutionId &&
        item.type === type,
    );

    filtered = this.sortItems(filtered, options.sortBy, options.sortOrder);

    const total = filtered.length;
    const start = (options.page - 1) * options.pageSize;
    const items = filtered.slice(start, start + options.pageSize);

    return { items: items.map((i) => ({ ...i })), total };
  }

  async findByParent(
    tenantId: string,
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    let filtered = Array.from(this.items.values()).filter(
      (item) =>
        item.tenantId === tenantId && item.parentId === parentId && item.type === type,
    );

    filtered = this.sortItems(filtered, options.sortBy, options.sortOrder);

    const total = filtered.length;
    const start = (options.page - 1) * options.pageSize;
    const items = filtered.slice(start, start + options.pageSize);

    return { items: items.map((i) => ({ ...i })), total };
  }

  async findAllByInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<InfrastructureRecord[]> {
    return Array.from(this.items.values())
      .filter((item) => item.tenantId === tenantId && item.institutionId === institutionId)
      .map((i) => ({ ...i }));
  }

  async update(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ): Promise<InfrastructureRecord | null> {
    const existing = this.items.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    const updated: InfrastructureRecord = {
      ...existing,
      ...data,
    };
    this.items.set(id, updated);
    return { ...updated };
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = this.items.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    return this.items.delete(id);
  }

  async hasChildren(tenantId: string, id: string): Promise<boolean> {
    for (const item of this.items.values()) {
      if (item.tenantId === tenantId && item.parentId === id) return true;
    }
    return false;
  }

  async createRepairLog(
    record: InfrastructureRepairLogRecord,
  ): Promise<InfrastructureRepairLogRecord> {
    this.repairLogs.set(record.id, { ...record });
    return { ...record };
  }

  async listRepairLogs(
    tenantId: string,
    infrastructureItemId: string,
  ): Promise<InfrastructureRepairLogRecord[]> {
    return Array.from(this.repairLogs.values())
      .filter(
        (log) =>
          log.tenantId === tenantId && log.infrastructureItemId === infrastructureItemId,
      )
      .sort((a, b) => b.repairDate.getTime() - a.repairDate.getTime())
      .map((log) => ({ ...log }));
  }

  /** Clear all items (test helper). */
  clear(): void {
    this.items.clear();
    this.repairLogs.clear();
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

  async findAll(tenantId: string): Promise<ConditionOptionRecord[]> {
    return Array.from(this.options.values())
      .filter((o) => o.tenantId === tenantId)
      .map((o) => ({ ...o }));
  }

  async findByName(tenantId: string, name: string): Promise<ConditionOptionRecord | null> {
    for (const option of this.options.values()) {
      if (option.tenantId === tenantId && option.name === name) return { ...option };
    }
    return null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = this.options.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    return this.options.delete(id);
  }

  /** Clear all options (test helper). */
  clear(): void {
    this.options.clear();
  }
}
