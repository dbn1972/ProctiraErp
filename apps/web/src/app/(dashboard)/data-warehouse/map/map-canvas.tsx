'use client';

/**
 * Leaflet map canvas for the data-warehouse GIS viewer.
 * Mounted only via next/dynamic (ssr: false).
 */
import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import type { DwGeoFeature } from '@/lib/api/data-warehouse';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const highlightIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [31, 50],
  iconAnchor: [15, 50],
  popupAnchor: [1, -40],
  shadowSize: [50, 50],
  className: 'dw-map-marker-focus',
});

L.Marker.prototype.options.icon = defaultIcon;

const DEFAULT_CENTER: [number, number] = [20.2961, 85.8245]; // Odisha / eastern India
const DEFAULT_ZOOM = 7;

interface MapCanvasProps {
  features: DwGeoFeature[];
  focusInstitutionId?: string | null;
}

function FitBounds({
  features,
  focusInstitutionId,
}: {
  features: DwGeoFeature[];
  focusInstitutionId?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (features.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    const focused = focusInstitutionId
      ? features.find((f) => f.institutionId === focusInstitutionId)
      : undefined;

    if (focused) {
      map.setView([focused.latitude, focused.longitude], 13, { animate: true });
      return;
    }

    if (features.length === 1) {
      const only = features[0]!;
      map.setView([only.latitude, only.longitude], 12);
      return;
    }

    const bounds = L.latLngBounds(
      features.map((f) => [f.latitude, f.longitude] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [features, focusInstitutionId, map]);

  return null;
}

export function DataWarehouseMapCanvas({ features, focusInstitutionId }: MapCanvasProps) {
  const center: [number, number] =
    features.length > 0
      ? [
          features.reduce((sum, f) => sum + f.latitude, 0) / features.length,
          features.reduce((sum, f) => sum + f.longitude, 0) / features.length,
        ]
      : DEFAULT_CENTER;

  return (
    <div className="relative h-[min(70vh,560px)] w-full overflow-hidden rounded-lg border border-border">
      <MapContainer
        center={center}
        zoom={features.length > 0 ? 9 : DEFAULT_ZOOM}
        className="h-full w-full [&_.leaflet-container]:bg-[#e8eef2]"
        scrollWheelZoom
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds features={features} focusInstitutionId={focusInstitutionId} />
        {features.map((feature) => {
          const focused = feature.institutionId === focusInstitutionId;
          return (
            <Marker
              key={feature.institutionId}
              position={[feature.latitude, feature.longitude]}
              icon={focused ? highlightIcon : defaultIcon}
              zIndexOffset={focused ? 1000 : 0}
            >
              <Popup>
                <div className="min-w-[180px] text-sm">
                  <p className="font-semibold text-foreground">{feature.name}</p>
                  <p className="text-xs text-muted-foreground">{feature.type}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {feature.latitude.toFixed(4)}, {feature.longitude.toFixed(4)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enrolment:{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {feature.enrolment.toLocaleString()}
                    </span>
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
