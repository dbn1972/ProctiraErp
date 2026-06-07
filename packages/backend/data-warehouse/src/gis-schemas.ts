/**
 * GIS Schemas
 *
 * Typebox schemas for GIS layer management with PostGIS support.
 * Supports Shapefile (SHP) and GeoJSON map layers linked to area hierarchies.
 * Implements Requirement 15.3.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── GIS Layer Types ──────────────────────────────────────────────────────────

export const GISLayerTypeSchema = Type.Union([
  Type.Literal('shapefile'),
  Type.Literal('geojson'),
]);

export type GISLayerType = Static<typeof GISLayerTypeSchema>;

// ─── GIS Feature ──────────────────────────────────────────────────────────────

export interface GISFeature {
  id: string;
  type: string;
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  index: number;
}

// ─── GIS Layer Entity ─────────────────────────────────────────────────────────

export interface GISLayer {
  id: string;
  warehouseId: string;
  tenantId: string;
  areaId: string;
  name: string;
  layerType: 'shapefile' | 'geojson';
  crs: string;
  featureCount: number;
  metadata: Record<string, string>;
  features: GISFeature[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create GIS Layer Schema ──────────────────────────────────────────────────

export const CreateGISLayerSchema = Type.Object({
  areaId: UuidString(),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  layerType: GISLayerTypeSchema,
  data: Type.Optional(Type.String({ description: 'Base64-encoded layer data or raw GeoJSON string' })),
  crs: Type.Optional(Type.String({ maxLength: 50, default: 'EPSG:4326', description: 'Coordinate Reference System' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type GISLayerInput = Static<typeof CreateGISLayerSchema>;

// ─── Update GIS Layer Schema ──────────────────────────────────────────────────

export const UpdateGISLayerSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  layerType: Type.Optional(GISLayerTypeSchema),
  data: Type.Optional(Type.String({ description: 'Base64-encoded layer data or raw GeoJSON string' })),
  crs: Type.Optional(Type.String({ maxLength: 50 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
  isActive: Type.Optional(Type.Boolean()),
});

export type UpdateGISLayerInput = Static<typeof UpdateGISLayerSchema>;

// ─── GIS Layer List Query Schema ──────────────────────────────────────────────

export const GISLayerListQuerySchema = Type.Object({
  areaId: Type.Optional(UuidString()),
  activeOnly: Type.Optional(Type.Boolean({ default: true })),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

export type GISLayerListQuery = Static<typeof GISLayerListQuerySchema>;

// ─── GIS Layer Params Schema ──────────────────────────────────────────────────

export const GISLayerParamsSchema = Type.Object({
  warehouseId: UuidString(),
  layerId: UuidString(),
});

export type GISLayerParams = Static<typeof GISLayerParamsSchema>;
