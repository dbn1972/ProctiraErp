/**
 * GISLayerViewer — map viewer with PostGIS-backed shapefile and GeoJSON layers.
 *
 * Mounts a map component displaying geographic layers from the Data Warehouse
 * Service. Supports layer selection and feature inspection.
 *
 * Task 60A.5 / Requirements 15.3
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Badge,
} from '@proctira/ui/components';
import {
  fetchGISLayers,
  fetchGISLayerFeatures,
  type GISLayer,
  type GISFeatureCollection,
} from '../api/data-warehouse-browser';

interface GISLayerViewerProps {
  /** Optional pre-selected layer ID */
  initialLayerId?: string;
}

export function GISLayerViewer({ initialLayerId }: GISLayerViewerProps) {
  const [layers, setLayers] = useState<GISLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>(initialLayerId ?? '');
  const [featureCollection, setFeatureCollection] = useState<GISFeatureCollection | null>(null);
  const [loadingLayers, setLoadingLayers] = useState(true);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  // Load available GIS layers
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoadingLayers(true);
      try {
        const data = await fetchGISLayers(controller.signal);
        setLayers(data);
        const firstLayer = data[0];
        if (!selectedLayerId && firstLayer) {
          setSelectedLayerId(firstLayer.id);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load GIS layers:', err);
        }
      } finally {
        setLoadingLayers(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  // Load features when layer changes
  useEffect(() => {
    if (!selectedLayerId) return;
    const controller = new AbortController();
    async function loadFeatures() {
      setLoadingFeatures(true);
      try {
        const data = await fetchGISLayerFeatures(selectedLayerId, controller.signal);
        setFeatureCollection(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load GIS features:', err);
        }
      } finally {
        setLoadingFeatures(false);
      }
    }
    void loadFeatures();
    return () => controller.abort();
  }, [selectedLayerId]);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">GIS Map Viewer</CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={selectedLayerId}
            onValueChange={setSelectedLayerId}
            disabled={loadingLayers}
          >
            <SelectTrigger className="w-[250px]" aria-label="Select GIS layer">
              <SelectValue placeholder="Select a layer…" />
            </SelectTrigger>
            <SelectContent>
              {layers.map((layer) => (
                <SelectItem key={layer.id} value={layer.id}>
                  {layer.name} ({layer.layerType.toUpperCase()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loadingLayers ? (
          <Skeleton className="h-[400px] w-full" />
        ) : layers.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center border rounded-md bg-muted/20">
            <p className="text-muted-foreground">
              No GIS layers available. Import shapefile or GeoJSON data to visualize.
            </p>
          </div>
        ) : (
          <>
            {/* Map container */}
            <div
              className="h-[400px] border rounded-md bg-muted/10 relative overflow-hidden"
              role="img"
              aria-label={`Map showing ${selectedLayer?.name ?? 'GIS'} layer`}
            >
              {loadingFeatures ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Skeleton className="h-full w-full" />
                </div>
              ) : featureCollection && featureCollection.features.length > 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* 
                    Map rendering placeholder. In production, this mounts a Leaflet
                    or MapLibre GL instance with the GeoJSON feature collection.
                    The actual map library integration depends on the MapViewer
                    component from task 27.2 being available.
                  */}
                  <div className="text-center space-y-2">
                    <div className="text-4xl">🗺️</div>
                    <p className="text-sm font-medium">
                      {selectedLayer?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {featureCollection.features.length} features loaded
                    </p>
                    <Badge variant="outline">
                      {selectedLayer?.layerType.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-muted-foreground text-sm">
                    No features available for this layer.
                  </p>
                </div>
              )}
            </div>

            {/* Layer info */}
            {selectedLayer && (
              <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Area: <strong>{selectedLayer.areaName}</strong>
                </span>
                <span>
                  Type: <Badge variant="outline">{selectedLayer.layerType}</Badge>
                </span>
                <span>
                  Features: <strong>{selectedLayer.featureCount}</strong>
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
