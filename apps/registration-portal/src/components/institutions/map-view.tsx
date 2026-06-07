'use client';

import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
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

L.Marker.prototype.options.icon = defaultIcon;

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
  const withCoords = institutions.filter(
    (inst): inst is InstitutionLocation & { latitude: number; longitude: number } =>
      inst.latitude !== null && inst.longitude !== null,
  );

  const center: [number, number] = withCoords.length > 0
    ? [
        withCoords.reduce((sum, i) => sum + i.latitude, 0) / withCoords.length,
        withCoords.reduce((sum, i) => sum + i.longitude, 0) / withCoords.length,
      ]
    : DEFAULT_CENTER;
  const zoom = withCoords.length > 0 ? 8 : DEFAULT_ZOOM;

  return (
    <div className="relative h-[500px] w-full">
      {loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/50">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
        </div>
      )}
      <MapContainer center={center} zoom={zoom} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {withCoords.map((institution) => (
          <Marker key={institution.id} position={[institution.latitude, institution.longitude]}>
            <Popup>
              <div className="min-w-[200px] text-sm">
                <h3 className="text-base font-semibold">{institution.name}</h3>
                {institution.typeName && <p className="text-gray-600">{institution.typeName}</p>}
                {institution.areaName && <p className="text-gray-600">{institution.areaName}</p>}
                {institution.address && (
                  <p className="mt-1 text-xs text-gray-500">{institution.address}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
