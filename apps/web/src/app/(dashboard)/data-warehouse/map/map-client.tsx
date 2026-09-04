'use client';

/**
 * Client shell for the GIS map — dynamic Leaflet import + optional client refresh.
 */
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';

import type { DwGeoFeature } from '@/lib/api/data-warehouse';

const MapCanvas = dynamic(
  () => import('./map-canvas').then((mod) => mod.DataWarehouseMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-[min(70vh,560px)] items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 text-sm text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-2">
          <MapPin className="h-8 w-8 animate-pulse" aria-hidden="true" />
          <span>Loading map…</span>
        </div>
      </div>
    ),
  },
);

interface DataWarehouseMapClientProps {
  features: DwGeoFeature[];
  focusInstitutionId?: string | null;
}

export function DataWarehouseMapClient({
  features,
  focusInstitutionId,
}: DataWarehouseMapClientProps) {
  if (features.length === 0) {
    return (
      <div
        role="img"
        aria-label="No mapped institutions"
        className="flex h-[min(70vh,560px)] items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 text-sm text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <MapPin className="h-10 w-10" aria-hidden="true" />
          <span>No geo-located institutions to display.</span>
          <span className="text-xs">
            Import GIS features or set latitude/longitude on institution profiles.
          </span>
        </div>
      </div>
    );
  }

  return (
    <MapCanvas features={features} focusInstitutionId={focusInstitutionId} />
  );
}
