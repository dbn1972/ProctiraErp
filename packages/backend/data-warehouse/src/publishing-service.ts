/**
 * Publishing Service
 *
 * Manages data publishing to multiple output formats including
 * mobile apps, web portals, and API endpoints.
 * Implements Requirement 15.4.
 */
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError } from '@proctira/common';

import type {
  PublishTarget,
  PublishRequestInput,
  PublishResult,
  PublishRecord,
  PublishedPayload,
  PublishedDataRecord,
  PublishedGISLayer,
  PublishedMetadata,
  PublishedIndicatorMeta,
  PublishedAreaMeta,
} from './publishing-schemas.js';
import type { WarehouseRepository, ListFilter } from './warehouse-repository.js';
import type { GISRepository } from './gis-repository.js';
import type { TranslationRepository } from './translation-repository.js';
import type { Indicator, Unit, Subgroup, Area, DataRecord } from './schemas.js';

export interface PublishingServiceConfig {
  /** Base URL for API endpoint publishing */
  apiBaseUrl: string;
  /** Base URL for web portal publishing */
  webBaseUrl: string;
  /** Base URL for mobile app data endpoint */
  mobileBaseUrl: string;
}

export class PublishingService {
  private publishHistory: Map<string, PublishRecord> = new Map();

  constructor(
    private readonly warehouseRepository: WarehouseRepository,
    private readonly gisRepository: GISRepository | null,
    private readonly translationRepository: TranslationRepository | null,
    private readonly config: PublishingServiceConfig,
  ) {}

  /**
   * Publish warehouse data to the specified target format.
   */
  async publishData(
    tenantId: string,
    warehouseId: string,
    input: PublishRequestInput,
  ): Promise<PublishResult> {
    // Validate warehouse exists
    const warehouse = await this.warehouseRepository.findWarehouseById(warehouseId, tenantId);
    if (!warehouse) {
      throw new NotFoundError(`Warehouse not found: ${warehouseId}`);
    }

    const errors: string[] = [];
    const language = input.language || warehouse.defaultLanguage || 'en';

    // Gather data records based on filters
    const dataRecords = await this.gatherDataRecords(tenantId, warehouseId, input);

    // Gather metadata (indicators, units, subgroups, areas)
    const indicators = await this.gatherIndicators(tenantId, warehouseId, input.indicatorIds);
    const areas = await this.gatherAreas(tenantId, warehouseId, input.areaIds);

    // Build indicator lookup maps
    const indicatorMap = new Map(indicators.map((i) => [i.id, i]));
    const unitMap = await this.buildUnitMap(tenantId, warehouseId);
    const subgroupMap = await this.buildSubgroupMap(tenantId, warehouseId);
    const areaMap = new Map(areas.map((a) => [a.id, a]));

    // Build published data records with resolved names
    const publishedRecords: PublishedDataRecord[] = dataRecords.map((record) => {
      const indicator = indicatorMap.get(record.indicatorId);
      const unit = unitMap.get(record.unitId);
      const subgroup = subgroupMap.get(record.subgroupId);
      const area = areaMap.get(record.areaId);

      return {
        indicatorGid: indicator?.gid || 'unknown',
        indicatorName: indicator?.name || 'Unknown Indicator',
        unitName: unit?.name || 'Unknown Unit',
        subgroupName: subgroup?.name || 'Unknown Subgroup',
        areaName: area?.name || 'Unknown Area',
        areaId: area?.areaId || 'unknown',
        timePeriod: record.timePeriodId, // Will be resolved below
        value: record.dataValue,
        textValue: record.textualDataValue,
        source: record.source,
      };
    });

    // Gather GIS layers if requested
    let publishedLayers: PublishedGISLayer[] = [];
    if (input.includeGISLayers && this.gisRepository) {
      publishedLayers = await this.gatherGISLayers(tenantId, warehouseId, input.areaIds, areaMap);
    }

    // Build metadata
    const metadata: PublishedMetadata = {
      warehouseId,
      warehouseName: warehouse.name,
      language,
      publishedAt: new Date().toISOString(),
      target: input.target,
      indicators: indicators.map((i) => ({
        id: i.id,
        name: i.name,
        gid: i.gid,
        unit: unitMap.get(i.id)?.name || '',
      })),
      areas: areas.map((a) => ({
        id: a.id,
        name: a.name,
        areaId: a.areaId,
        level: a.level,
        parentId: a.parentId,
      })),
      timePeriods: input.timePeriods || [],
    };

    // Build the payload
    const payload: PublishedPayload = {
      metadata,
      data: publishedRecords,
      gisLayers: publishedLayers.length > 0 ? publishedLayers : undefined,
    };

    // Format payload based on target
    const formattedPayload = this.formatForTarget(input.target, payload);

    // Determine endpoint URL
    const endpoint = this.getEndpointUrl(input.target, warehouseId);

    const publishResult: PublishResult = {
      id: uuidv4(),
      warehouseId,
      tenantId,
      target: input.target,
      status: errors.length === 0 ? 'completed' : 'failed',
      recordCount: publishedRecords.length,
      layerCount: publishedLayers.length,
      publishedAt: new Date(),
      endpoint,
      payload: formattedPayload,
      errors,
    };

    // Store publish history
    const historyRecord: PublishRecord = {
      id: publishResult.id,
      warehouseId,
      tenantId,
      target: input.target,
      status: publishResult.status,
      recordCount: publishResult.recordCount,
      layerCount: publishResult.layerCount,
      publishedAt: publishResult.publishedAt,
      language,
      errors,
    };
    this.publishHistory.set(historyRecord.id, historyRecord);

    return publishResult;
  }

  /**
   * Get publish history for a warehouse.
   */
  async getPublishHistory(
    tenantId: string,
    warehouseId: string,
    options: { target?: PublishTarget; page?: number; pageSize?: number },
  ): Promise<{ data: PublishRecord[]; total: number }> {
    let records = Array.from(this.publishHistory.values()).filter(
      (r) => r.warehouseId === warehouseId && r.tenantId === tenantId,
    );

    if (options.target) {
      records = records.filter((r) => r.target === options.target);
    }

    // Sort by publishedAt descending
    records.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const total = records.length;
    const offset = (page - 1) * pageSize;
    const data = records.slice(offset, offset + pageSize);

    return { data, total };
  }

  private async gatherDataRecords(
    tenantId: string,
    warehouseId: string,
    input: PublishRequestInput,
  ): Promise<DataRecord[]> {
    // Resolve time period labels to IDs
    let timePeriodIds: string[] | undefined;
    if (input.timePeriods && input.timePeriods.length > 0) {
      timePeriodIds = [];
      for (const label of input.timePeriods) {
        const tp = await this.warehouseRepository.findTimePeriodByLabel(label, warehouseId, tenantId);
        if (tp) {
          timePeriodIds.push(tp.id);
        }
      }
    }

    const result = await this.warehouseRepository.queryData(
      warehouseId,
      tenantId,
      {
        indicatorIds: input.indicatorIds,
        areaIds: input.areaIds,
        timePeriodIds,
      },
      1,
      100000, // Get all matching records for publishing
    );

    return result.data;
  }

  private async gatherIndicators(
    tenantId: string,
    warehouseId: string,
    indicatorIds?: string[],
  ): Promise<Indicator[]> {
    const result = await this.warehouseRepository.listIndicators(warehouseId, tenantId, {}, 1, 10000);
    if (indicatorIds && indicatorIds.length > 0) {
      return result.data.filter((i) => indicatorIds.includes(i.id));
    }
    return result.data;
  }

  private async gatherAreas(
    tenantId: string,
    warehouseId: string,
    areaIds?: string[],
  ): Promise<Area[]> {
    const result = await this.warehouseRepository.listAreas(warehouseId, tenantId, {}, 1, 10000);
    if (areaIds && areaIds.length > 0) {
      return result.data.filter((a) => areaIds.includes(a.id));
    }
    return result.data;
  }

  private async buildUnitMap(tenantId: string, warehouseId: string): Promise<Map<string, Unit>> {
    const result = await this.warehouseRepository.listUnits(warehouseId, tenantId, {}, 1, 10000);
    return new Map(result.data.map((u) => [u.id, u]));
  }

  private async buildSubgroupMap(tenantId: string, warehouseId: string): Promise<Map<string, Subgroup>> {
    const result = await this.warehouseRepository.listSubgroups(warehouseId, tenantId, {}, 1, 10000);
    return new Map(result.data.map((s) => [s.id, s]));
  }

  private async gatherGISLayers(
    tenantId: string,
    warehouseId: string,
    areaIds: string[] | undefined,
    areaMap: Map<string, Area>,
  ): Promise<PublishedGISLayer[]> {
    if (!this.gisRepository) return [];

    const result = await this.gisRepository.listLayers(warehouseId, tenantId, {
      activeOnly: true,
      page: 1,
      pageSize: 10000,
    });

    let layers = result.data;
    if (areaIds && areaIds.length > 0) {
      layers = layers.filter((l) => areaIds.includes(l.areaId));
    }

    return layers.map((layer) => {
      const area = areaMap.get(layer.areaId);
      return {
        id: layer.id,
        name: layer.name,
        areaId: layer.areaId,
        areaName: area?.name || 'Unknown Area',
        layerType: layer.layerType,
        crs: layer.crs,
        featureCount: layer.featureCount,
        geojson: {
          type: 'FeatureCollection',
          features: layer.features.map((f) => ({
            type: 'Feature',
            geometry: f.geometry,
            properties: f.properties,
          })),
        },
      };
    });
  }

  /**
   * Format payload based on target platform requirements.
   */
  private formatForTarget(target: PublishTarget, payload: PublishedPayload): PublishedPayload {
    switch (target) {
      case 'mobile':
        // Mobile format: compact, minimal metadata, optimized for bandwidth
        return {
          ...payload,
          data: payload.data.map((d) => ({
            ...d,
            // Keep essential fields only for mobile
          })),
        };
      case 'web':
        // Web format: full metadata, includes GIS layers
        return payload;
      case 'api':
        // API format: structured for programmatic consumption
        return payload;
      default:
        return payload;
    }
  }

  /**
   * Get the endpoint URL for the published data.
   */
  private getEndpointUrl(target: PublishTarget, warehouseId: string): string {
    switch (target) {
      case 'mobile':
        return `${this.config.mobileBaseUrl}/data/${warehouseId}`;
      case 'web':
        return `${this.config.webBaseUrl}/dashboards/${warehouseId}`;
      case 'api':
        return `${this.config.apiBaseUrl}/v1/warehouses/${warehouseId}/published`;
      default:
        return '';
    }
  }
}
