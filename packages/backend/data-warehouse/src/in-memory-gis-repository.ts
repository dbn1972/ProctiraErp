/**
 * In-Memory GIS Repository
 *
 * In-memory implementation of GISRepository for testing and development.
 */
import type { GISLayer } from './gis-schemas.js';
import type { GISRepository, GISLayerListOptions, GISListResult } from './gis-repository.js';
import type { WarehouseRepository } from './warehouse-repository.js';

export class InMemoryGISRepository implements GISRepository {
  private layers: Map<string, GISLayer> = new Map();

  constructor(private readonly warehouseRepository?: WarehouseRepository) {}

  async createLayer(layer: GISLayer): Promise<GISLayer> {
    this.layers.set(layer.id, { ...layer, features: [...layer.features] });
    return { ...layer, features: [...layer.features] };
  }

  async updateLayer(id: string, warehouseId: string, tenantId: string, updates: Partial<GISLayer>): Promise<GISLayer> {
    const existing = this.layers.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`GIS layer not found: ${id}`);
    }
    const updated: GISLayer = { ...existing, ...updates, updatedAt: new Date() };
    this.layers.set(id, updated);
    return { ...updated };
  }

  async deleteLayer(id: string, warehouseId: string, tenantId: string): Promise<void> {
    const existing = this.layers.get(id);
    if (!existing || existing.warehouseId !== warehouseId || existing.tenantId !== tenantId) {
      throw new Error(`GIS layer not found: ${id}`);
    }
    this.layers.delete(id);
  }

  async findLayerById(id: string, warehouseId: string, tenantId: string): Promise<GISLayer | null> {
    const layer = this.layers.get(id);
    if (!layer || layer.warehouseId !== warehouseId || layer.tenantId !== tenantId) {
      return null;
    }
    return { ...layer, features: [...layer.features] };
  }

  async listLayers(warehouseId: string, tenantId: string, options: GISLayerListOptions): Promise<GISListResult> {
    let results = Array.from(this.layers.values()).filter(
      (l) => l.warehouseId === warehouseId && l.tenantId === tenantId,
    );

    if (options.areaId) {
      results = results.filter((l) => l.areaId === options.areaId);
    }

    if (options.activeOnly) {
      results = results.filter((l) => l.isActive);
    }

    const total = results.length;
    const offset = (options.page - 1) * options.pageSize;
    const data = results.slice(offset, offset + options.pageSize);
    return { data: data.map((l) => ({ ...l, features: [...l.features] })), total };
  }

  async findLayersByAreaHierarchy(warehouseId: string, tenantId: string, areaId: string): Promise<GISLayer[]> {
    // Get all areas to build hierarchy
    const allAreas = Array.from(this.layers.values())
      .filter((l) => l.warehouseId === warehouseId && l.tenantId === tenantId);

    // If we have a warehouse repository, use it to find descendant areas
    if (this.warehouseRepository) {
      const descendantAreaIds = await this.getDescendantAreaIds(warehouseId, tenantId, areaId);
      descendantAreaIds.add(areaId);

      return allAreas
        .filter((l) => descendantAreaIds.has(l.areaId) && l.isActive)
        .map((l) => ({ ...l, features: [...l.features] }));
    }

    // Fallback: just return layers for the specific area
    return allAreas
      .filter((l) => l.areaId === areaId && l.isActive)
      .map((l) => ({ ...l, features: [...l.features] }));
  }

  private async getDescendantAreaIds(warehouseId: string, tenantId: string, parentAreaId: string): Promise<Set<string>> {
    const result = new Set<string>();
    if (!this.warehouseRepository) return result;

    // Get all areas and build a tree
    const allAreas = await this.warehouseRepository.listAreas(warehouseId, tenantId, {}, 1, 10000);
    const childMap = new Map<string, string[]>();

    for (const area of allAreas.data) {
      if (area.parentId) {
        const children = childMap.get(area.parentId) || [];
        children.push(area.id);
        childMap.set(area.parentId, children);
      }
    }

    // BFS to find all descendants
    const queue = [parentAreaId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childMap.get(current) || [];
      for (const child of children) {
        result.add(child);
        queue.push(child);
      }
    }

    return result;
  }
}
