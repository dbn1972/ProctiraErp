/**
 * GIS map viewer (Server Component shell + placeholder) — v2.0 redesign.
 *
 * Validates: Requirement 15.1 — geospatial map of institution data.
 *
 * Renders a server-rendered list of geo features and a placeholder map
 * surface. The interactive Leaflet/MapLibre layer is intentionally
 * progressive-enhancement: a deferred client component plugs in once
 * the map library is wired into the bundle.
 *
 * v2.0 changes:
 * - Back link + text-3xl font-extrabold page head with subtitle
 * - Map placeholder + mapped-institutions list restyled per house
 *   conventions; data fetching and aria labels unchanged
 */
import Link from 'next/link';
import { ArrowLeft, MapPin } from 'lucide-react';

import {
  Button,
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
      {/* ── Back link ── */}
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/data-warehouse">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to data warehouse
        </Link>
      </Button>

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="map-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            GIS map viewer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visualise institutions on a map and inspect enrolment density by region.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mapped institutions</CardTitle>
          <CardDescription>
            {features.length.toLocaleString()} institutions geo-located.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <p className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              No geo-located institutions available.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <li
                  key={feature.institutionId}
                  className="rounded-lg border bg-card p-4 text-sm shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
                    >
                      <MapPin className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{feature.name}</p>
                      <p className="text-xs text-muted-foreground">{feature.type}</p>
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                    {feature.latitude.toFixed(4)}, {feature.longitude.toFixed(4)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enrolment:{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {feature.enrolment.toLocaleString()}
                    </span>
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
