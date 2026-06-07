/**
 * Publishing Schemas
 *
 * Typebox schemas for data publishing to multiple output formats.
 * Supports mobile apps, web portals, and API endpoints.
 * Implements Requirement 15.4.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Publishing Target Types ──────────────────────────────────────────────────

export const PublishTargetSchema = Type.Union([
  Type.Literal('mobile'),
  Type.Literal('web'),
  Type.Literal('api'),
]);

export type PublishTarget = Static<typeof PublishTargetSchema>;

// ─── Publish Request Schema ───────────────────────────────────────────────────

export const PublishRequestSchema = Type.Object({
  target: PublishTargetSchema,
  indicatorIds: Type.Optional(Type.Array(UuidString())),
  areaIds: Type.Optional(Type.Array(UuidString())),
  timePeriods: Type.Optional(Type.Array(Type.String())),
  includeGISLayers: Type.Optional(Type.Boolean({ default: false })),
  includeMetadata: Type.Optional(Type.Boolean({ default: true })),
  language: Type.Optional(Type.String({ minLength: 2, maxLength: 10, default: 'en' })),
});

export type PublishRequestInput = Static<typeof PublishRequestSchema>;

// ─── Publish Result ───────────────────────────────────────────────────────────

export interface PublishResult {
  id: string;
  warehouseId: string;
  tenantId: string;
  target: PublishTarget;
  status: 'completed' | 'failed';
  recordCount: number;
  layerCount: number;
  publishedAt: Date;
  endpoint?: string;
  payload: PublishedPayload;
  errors: string[];
}

export interface PublishedPayload {
  metadata: PublishedMetadata;
  data: PublishedDataRecord[];
  gisLayers?: PublishedGISLayer[];
}

export interface PublishedMetadata {
  warehouseId: string;
  warehouseName: string;
  language: string;
  publishedAt: string;
  target: string;
  indicators: PublishedIndicatorMeta[];
  areas: PublishedAreaMeta[];
  timePeriods: string[];
}

export interface PublishedIndicatorMeta {
  id: string;
  name: string;
  gid: string;
  unit: string;
}

export interface PublishedAreaMeta {
  id: string;
  name: string;
  areaId: string;
  level: number;
  parentId: string | null;
}

export interface PublishedDataRecord {
  indicatorGid: string;
  indicatorName: string;
  unitName: string;
  subgroupName: string;
  areaName: string;
  areaId: string;
  timePeriod: string;
  value: number | null;
  textValue: string | null;
  source: string | null;
}

export interface PublishedGISLayer {
  id: string;
  name: string;
  areaId: string;
  areaName: string;
  layerType: string;
  crs: string;
  featureCount: number;
  geojson: Record<string, unknown>;
}

// ─── Publish History Schema ───────────────────────────────────────────────────

export interface PublishRecord {
  id: string;
  warehouseId: string;
  tenantId: string;
  target: PublishTarget;
  status: 'completed' | 'failed';
  recordCount: number;
  layerCount: number;
  publishedAt: Date;
  language: string;
  errors: string[];
}

export const PublishHistoryQuerySchema = Type.Object({
  target: Type.Optional(PublishTargetSchema),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

export type PublishHistoryQuery = Static<typeof PublishHistoryQuerySchema>;
