/**
 * GIS Service
 *
 * Manages GIS layers (Shapefile and GeoJSON) linked to area hierarchies.
 * Supports PostGIS geometry storage and spatial queries.
 * Implements Requirement 15.3: GIS visualization with Shapefile/GeoJSON map layers.
 */
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ConflictError } from '@proctira/common';

import type { GISLayer, GISLayerInput, UpdateGISLayerInput, GISFeature } from './gis-schemas.js';
import type { GISRepository } from './gis-repository.js';
import type { WarehouseRepository } from './warehouse-repository.js';

export interface GISServiceConfig {
  /** Maximum file size for layer uploads in bytes (default: 50MB) */
  maxLayerFileSize: number;
  /** Supported coordinate reference systems */
  supportedCRS: string[];
}

export class GISService {
  constructor(
    private readonly gisRepository: GISRepository,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly config: GISServiceConfig,
  ) {}

  /**
   * Create a new GIS layer linked to an area in the warehouse.
   */
  async createLayer(
    tenantId: string,
    warehouseId: string,
    input: GISLayerInput,
  ): Promise<GISLayer> {
    // Validate warehouse exists
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    // Validate area exists in the warehouse
    const area = await this.warehouseRepository.findAreaById(input.areaId, warehouseId, tenantId);
    if (!area) {
      throw new NotFoundError(`Area not found: ${input.areaId}`);
    }

    // Validate layer type
    if (input.layerType !== 'shapefile' && input.layerType !== 'geojson') {
      throw new Error(`Unsupported layer type: ${input.layerType}`);
    }

    // Validate file size
    if (input.data && input.data.length > this.config.maxLayerFileSize) {
      throw new Error(`Layer file size exceeds maximum of ${this.config.maxLayerFileSize} bytes`);
    }

    // Parse geometry data based on layer type
    const features = this.parseLayerData(input.layerType, input.data);

    const now = new Date();
    const layer: GISLayer = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      areaId: input.areaId,
      name: input.name,
      layerType: input.layerType,
      crs: input.crs || 'EPSG:4326',
      featureCount: features.length,
      metadata: input.metadata || {},
      features,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.gisRepository.createLayer(layer);
  }

  /**
   * Update an existing GIS layer.
   */
  async updateLayer(
    tenantId: string,
    warehouseId: string,
    layerId: string,
    input: UpdateGISLayerInput,
  ): Promise<GISLayer> {
    const existing = await this.gisRepository.findLayerById(layerId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`GIS layer not found: ${layerId}`);
    }

    const updates: Partial<GISLayer> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    // If new data is provided, re-parse features
    if (input.data !== undefined) {
      const layerType = input.layerType || existing.layerType;
      const features = this.parseLayerData(layerType, input.data);
      updates.features = features;
      updates.featureCount = features.length;
      if (input.layerType) updates.layerType = input.layerType;
    }

    if (input.crs !== undefined) updates.crs = input.crs;

    return this.gisRepository.updateLayer(layerId, warehouseId, tenantId, updates);
  }

  /**
   * Delete a GIS layer.
   */
  async deleteLayer(tenantId: string, warehouseId: string, layerId: string): Promise<void> {
    const existing = await this.gisRepository.findLayerById(layerId, warehouseId, tenantId);
    if (!existing) {
      throw new NotFoundError(`GIS layer not found: ${layerId}`);
    }
    await this.gisRepository.deleteLayer(layerId, warehouseId, tenantId);
  }

  /**
   * Get a GIS layer by ID.
   */
  async getLayer(tenantId: string, warehouseId: string, layerId: string): Promise<GISLayer> {
    const layer = await this.gisRepository.findLayerById(layerId, warehouseId, tenantId);
    if (!layer) {
      throw new NotFoundError(`GIS layer not found: ${layerId}`);
    }
    return layer;
  }

  /**
   * List GIS layers for a warehouse, optionally filtered by area.
   */
  async listLayers(
    tenantId: string,
    warehouseId: string,
    options: { areaId?: string; activeOnly?: boolean; page?: number; pageSize?: number },
  ): Promise<{ data: GISLayer[]; total: number }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    return this.gisRepository.listLayers(warehouseId, tenantId, {
      areaId: options.areaId,
      activeOnly: options.activeOnly,
      page,
      pageSize,
    });
  }

  /**
   * Get layers linked to a specific area and its descendants in the hierarchy.
   */
  async getLayersByAreaHierarchy(
    tenantId: string,
    warehouseId: string,
    areaId: string,
  ): Promise<GISLayer[]> {
    // Get the area and all descendant areas
    const area = await this.warehouseRepository.findAreaById(areaId, warehouseId, tenantId);
    if (!area) {
      throw new NotFoundError(`Area not found: ${areaId}`);
    }

    return this.gisRepository.findLayersByAreaHierarchy(warehouseId, tenantId, areaId);
  }

  /**
   * Parse layer data from raw input based on layer type.
   */
  private parseLayerData(layerType: 'shapefile' | 'geojson', data?: string): GISFeature[] {
    if (!data) {
      return [];
    }

    switch (layerType) {
      case 'geojson':
        return this.parseGeoJSON(data);
      case 'shapefile':
        return this.parseShapefile(data);
      default:
        return [];
    }
  }

  /**
   * Parse GeoJSON string into features.
   */
  private parseGeoJSON(data: string): GISFeature[] {
    try {
      let geojson: unknown;

      // Try parsing as raw JSON first, then as base64
      try {
        geojson = JSON.parse(data);
      } catch {
        const decoded = Buffer.from(data, 'base64').toString('utf-8');
        geojson = JSON.parse(decoded);
      }

      if (!geojson || typeof geojson !== 'object') {
        return [];
      }

      const geoObj = geojson as Record<string, unknown>;

      // Handle FeatureCollection
      if (geoObj.type === 'FeatureCollection' && Array.isArray(geoObj.features)) {
        return (geoObj.features as Record<string, unknown>[]).map((feature, index) => ({
          id: uuidv4(),
          type: ((feature.geometry as Record<string, unknown>)?.type as string) || 'Unknown',
          geometry: feature.geometry as Record<string, unknown>,
          properties: (feature.properties as Record<string, unknown>) || {},
          index,
        }));
      }

      // Handle single Feature
      if (geoObj.type === 'Feature') {
        return [
          {
            id: uuidv4(),
            type: ((geoObj.geometry as Record<string, unknown>)?.type as string) || 'Unknown',
            geometry: geoObj.geometry as Record<string, unknown>,
            properties: (geoObj.properties as Record<string, unknown>) || {},
            index: 0,
          },
        ];
      }

      // Handle bare geometry
      if (geoObj.type && geoObj.coordinates) {
        return [
          {
            id: uuidv4(),
            type: geoObj.type as string,
            geometry: geoObj as Record<string, unknown>,
            properties: {},
            index: 0,
          },
        ];
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * Parse Shapefile data (base64-encoded) into features.
   * In a production environment, this would use a library like shpjs.
   * For now, we parse a simplified representation.
   */
  private parseShapefile(data: string): GISFeature[] {
    try {
      // Shapefile data is expected as base64-encoded JSON representation
      // In production, this would use shpjs or similar to parse .shp/.dbf/.shx
      const decoded = Buffer.from(data, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);

      if (parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        return (parsed.features as Record<string, unknown>[]).map((feature, index) => ({
          id: uuidv4(),
          type: ((feature.geometry as Record<string, unknown>)?.type as string) || 'Unknown',
          geometry: feature.geometry as Record<string, unknown>,
          properties: (feature.properties as Record<string, unknown>) || {},
          index,
        }));
      }

      return [];
    } catch {
      return [];
    }
  }
}
