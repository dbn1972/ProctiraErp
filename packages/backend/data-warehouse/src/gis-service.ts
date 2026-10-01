/**
 * GIS Service
 *
 * Manages GIS layers (Shapefile and GeoJSON) linked to area hierarchies.
 * Supports PostGIS geometry storage and spatial queries.
 * Implements Requirement 15.3: GIS visualization with Shapefile/GeoJSON map layers.
 */
import { AppError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { GISRepository } from './gis-repository.js';
import type { GISLayer, GISLayerInput, UpdateGISLayerInput, GISFeature } from './gis-schemas.js';
import type { WarehouseRepository } from './warehouse-repository.js';

export interface GISServiceConfig {
  /** Maximum file size for layer uploads in bytes (default: 50MB) */
  maxLayerFileSize: number;
  /** Supported coordinate reference systems */
  supportedCRS: string[];
}

function invalidLayerData(message: string, field = 'data'): ValidationError {
  return new ValidationError('Validation failed', [{ field, message, rule: 'format' }]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireGeometry(feature: Record<string, unknown>, index: number): Record<string, unknown> {
  const geometry = feature.geometry;
  if (!isRecord(geometry) || typeof geometry.type !== 'string') {
    throw invalidLayerData(`Feature ${index} has no valid geometry`, `data.features.${index}`);
  }
  return geometry;
}

function toFeature(feature: Record<string, unknown>, index: number): GISFeature {
  const geometry = requireGeometry(feature, index);
  return {
    id: uuidv4(),
    type: geometry.type as string,
    geometry,
    properties: isRecord(feature.properties) ? feature.properties : {},
    index,
  };
}

/** Convert parsed GeoJSON into features; rejects unsupported shapes. */
function toFeatures(input: unknown, allowFeatureOrGeometry: boolean): GISFeature[] {
  if (!isRecord(input)) throw invalidLayerData('Layer data must be a GeoJSON object');
  if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
    return input.features.map((feature: unknown, index) => {
      if (!isRecord(feature)) {
        throw invalidLayerData(`Feature ${index} is not an object`, `data.features.${index}`);
      }
      return toFeature(feature, index);
    });
  }
  if (allowFeatureOrGeometry && input.type === 'Feature') {
    return [toFeature(input, 0)];
  }
  if (allowFeatureOrGeometry && typeof input.type === 'string' && input.coordinates) {
    return [toFeature({ geometry: input }, 0)];
  }
  throw invalidLayerData('Unsupported GeoJSON structure');
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
      throw new ValidationError('Validation failed', [
        {
          field: 'layerType',
          message: `Unsupported layer type: ${String(input.layerType)}`,
          rule: 'enum',
        },
      ]);
    }

    // Validate file size
    if (input.data && input.data.length > this.config.maxLayerFileSize) {
      throw new AppError(
        `Layer file size exceeds maximum of ${this.config.maxLayerFileSize} bytes`,
        'PAYLOAD_TOO_LARGE',
        413,
      );
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
   * Parse GeoJSON (raw JSON or base64 JSON) into features.
   * Throws ValidationError on unparseable input or features without geometry.
   */
  private parseGeoJSON(data: string): GISFeature[] {
    let geojson: unknown;
    try {
      geojson = JSON.parse(data);
    } catch {
      try {
        geojson = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
      } catch {
        throw invalidLayerData('Layer data is not valid GeoJSON');
      }
    }
    return toFeatures(geojson, true);
  }

  /**
   * Parse Shapefile data (base64-encoded JSON FeatureCollection representation).
   * Binary .shp/.dbf parsing is not implemented (see PRC-L457).
   */
  private parseShapefile(data: string): GISFeature[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
    } catch {
      throw invalidLayerData('Shapefile data could not be parsed');
    }
    return toFeatures(parsed, false);
  }
}
