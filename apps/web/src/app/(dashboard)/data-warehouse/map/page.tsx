/**
 * GIS map viewer (Server Component shell + placeholder).
 *
 * Validates: Requirement 15.1 — geospatial map of institution data.
 *
 * Renders a server-rendered list of geo features and a placeholder map
 * surface. The interactive Leaflet/MapLibre layer is intentionally
 * progressive-enhancement: a deferred client component plugs in once
 * the map library is wired into the bundle.
 */
import { MapPin } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { listGeoFeatures } from '@/lib/api/data-warehouse';

export const dynamic = 'force-dynamic';

export default async function DataWarehouseMapPage() {
  const features = await listGeoFeatures();

  return (
    <section aria-labelledby="map-heading" className="space-y-6">
      <header>
        <h1 id="map-heading" className="text-2xl font-semibold tracking-tight">
          GIS map viewer
        </h1>
        <p className="text-sm text-muted-foreground">
          Visualise institutions on a map and inspect enrolment density by region.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Map</CardTitle>
          <CardDescription>
            Interactive map (Leaflet/MapLibre) renders client-side. Markers below show
            the {features.length.toLocaleString()} institutions with geo coordinates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="img"
            aria-label="Map placeholder"
            className="flex h-80 items-center justify-center rounded-lg border border-dashed bg-secondary/40 text-sm text-muted-foreground"
          >
            <div className="flex flex-col items-center gap-2">
              <MapPin className="h-10 w-10" aria-hidden="true" />
              <span>Interactive map renders here.</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Mapped institutions</CardTitle>
          <CardDescription>
            {features.length.toLocaleString()} institutions geo-located.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No geo-located institutions available.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <li
                  key={feature.institutionId}
                  className="rounded-md border bg-card p-3 text-sm"
                >
                  <p className="font-medium">{feature.name}</p>
                  <p className="text-xs text-muted-foreground">{feature.type}</p>
                  <p className="mt-1 text-xs">
                    <code>
                      {feature.latitude.toFixed(4)}, {feature.longitude.toFixed(4)}
                    </code>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enrolment: {feature.enrolment.toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
