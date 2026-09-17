'use client';

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { InstitutionLocation } from '@/lib/api';

// Fix Leaflet's default marker URL resolution under Webpack/Next.js bundling
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MapViewProps {
  institutions: InstitutionLocation[];
  loading: boolean;
}

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

/**
 * Leaflet map view rendering institution markers.
 * Used by the school finder page; mounted client-side only via `next/dynamic`.
 */
export function MapView({ institutions, loading }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const markerLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    markerLayerRef.current = markerLayer;

    return () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
      if (markerLayerRef.current === markerLayer) markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;

    const withCoords = institutions.filter(
      (inst): inst is InstitutionLocation & { latitude: number; longitude: number } =>
        inst.latitude !== null && inst.longitude !== null,
    );

    markerLayer.clearLayers();

    for (const institution of withCoords) {
      const popupContent = document.createElement('div');
      popupContent.className = 'min-w-[200px] text-sm';

      const name = document.createElement('h3');
      name.className = 'text-base font-semibold';
      name.textContent = institution.name;
      popupContent.append(name);

      const details = [
        [institution.typeName, 'text-gray-600'],
        [institution.areaName, 'text-gray-600'],
        [institution.address, 'mt-1 text-xs text-gray-500'],
      ] as const;

      for (const [text, className] of details) {
        if (!text) continue;
        const paragraph = document.createElement('p');
        paragraph.className = className;
        paragraph.textContent = text;
        popupContent.append(paragraph);
      }

      L.marker([institution.latitude, institution.longitude], { icon: defaultIcon })
        .bindPopup(popupContent)
        .addTo(markerLayer);
    }

    const center: [number, number] =
      withCoords.length > 0
        ? [
            withCoords.reduce((sum, institution) => sum + institution.latitude, 0) /
              withCoords.length,
            withCoords.reduce((sum, institution) => sum + institution.longitude, 0) /
              withCoords.length,
          ]
        : DEFAULT_CENTER;
    const zoom = withCoords.length > 0 ? 8 : DEFAULT_ZOOM;
    map.setView(center, zoom);
  }, [institutions]);

  return (
    <div className="relative h-[500px] w-full">
      {loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/50">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
        </div>
      )}
      <div ref={mapContainerRef} className="h-full w-full" />
    </div>
  );
}
