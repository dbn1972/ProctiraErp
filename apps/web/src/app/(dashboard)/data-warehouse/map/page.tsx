/**
 * GIS map viewer — interactive Leaflet map (Design System v2.0).
 *
 * Cite: redesign/web/data-warehouse-map.html
 *
 * Validates: Requirement 15.1 — geospatial map of institution data.
 *
 * - Fetches geo features from GET /data-warehouse/map/features
 * - Falls back to institution profile lat/lng when GIS is empty
 * - Supports ?institutionId= to focus / highlight a school
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
import {
  listGeoFeatures,
  listInstitutionMapMarkers,
  type DwGeoFeature,
} from '@/lib/api/data-warehouse';
import { cn } from '@/lib/utils';

import { DataWarehouseMapClient } from './map-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { institutionId?: string };
}

function mergeFeatures(
  gis: DwGeoFeature[],
  fromProfiles: DwGeoFeature[],
): DwGeoFeature[] {
  if (gis.length > 0) {
    const byId = new Map(gis.map((f) => [f.institutionId, f]));
    for (const profile of fromProfiles) {
      if (!byId.has(profile.institutionId)) {
        byId.set(profile.institutionId, profile);
      }
    }
    return Array.from(byId.values());
  }
  return fromProfiles;
}

export default async function DataWarehouseMapPage({ searchParams }: PageProps) {
  const focusInstitutionId = searchParams?.institutionId?.trim() || null;

  const [gisFeatures, profileMarkers] = await Promise.all([
    listGeoFeatures(),
    listInstitutionMapMarkers({ pageSize: 500 }),
  ]);

  const features = mergeFeatures(gisFeatures, profileMarkers);
  const sourceLabel =
    gisFeatures.length > 0
      ? 'GIS features'
      : profileMarkers.length > 0
        ? 'institution profiles'
        : 'no sources';

  return (
    <section aria-labelledby="map-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/data-warehouse">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to data warehouse
        </Link>
      </Button>

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
            {focusInstitutionId ? ' Focusing on the selected institution.' : ''}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Map</CardTitle>
          <CardDescription>
            {features.length.toLocaleString()} markers from {sourceLabel}. Pan and zoom to
            explore; click a pin for details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataWarehouseMapClient
            features={features}
            focusInstitutionId={focusInstitutionId}
          />
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
              {features.map((feature) => {
                const focused = feature.institutionId === focusInstitutionId;
                return (
                  <li
                    key={feature.institutionId}
                    id={focused ? `institution-${feature.institutionId}` : undefined}
                    className={cn(
                      'rounded-lg border bg-card p-4 text-sm shadow-sm transition-colors',
                      focused && 'border-teal-500 ring-2 ring-teal-500/30',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          focused
                            ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300'
                            : 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400',
                        )}
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
                    {focused ? (
                      <p className="mt-2 text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                        Focused from institution overview
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
