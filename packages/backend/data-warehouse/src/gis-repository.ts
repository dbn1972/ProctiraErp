/**
 * GIS Repository Interface
 *
 * Defines the contract for GIS layer persistence operations.
 * Implementations can use PostGIS, in-memory storage, etc.
 */
import type { GISLayer } from './gis-schemas.js';

export interface GISLayerListOptions {
  areaId?: string;
  activeOnly?: boolean;
  page: number;
  pageSize: number;
}

export interface GISListResult {
  data: GISLayer[];
  total: number;
}

/**
 * Repository interface for GIS layer CRUD operations.
 */
export interface GISRepository {
  createLayer(layer: GISLayer): Promise<GISLayer>;
  updateLayer(id: string, warehouseId: string, tenantId: string, updates: Partial<GISLayer>): Promise<GISLayer>;
  deleteLayer(id: string, warehouseId: string, tenantId: string): Promise<void>;
  findLayerById(id: string, warehouseId: string, tenantId: string): Promise<GISLayer | null>;
  listLayers(warehouseId: string, tenantId: string, options: GISLayerListOptions): Promise<GISListResult>;
  findLayersByAreaHierarchy(warehouseId: string, tenantId: string, areaId: string): Promise<GISLayer[]>;
}
